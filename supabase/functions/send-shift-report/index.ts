import { createClient } from "npm:@supabase/supabase-js@2";
import { jsPDF } from "npm:jspdf@2.5.2";
import autoTableImport from "npm:jspdf-autotable@3.8.2";

// Deno's npm CJS/ESM interop sometimes wraps the default export differently
// than bundlers do in the browser, so resolve whichever shape we actually got.
const autoTable: any = (autoTableImport as any)?.default ?? autoTableImport;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const STORAGE_BUCKET = "monitoring-photos";
const SHIFT_LABELS: Record<number, string> = { 1: "Shift 1 (Pagi)", 2: "Shift 2 (Sore)", 3: "Shift 3 (Malam)" };
const ROUND_WINDOWS: Record<number, Record<number, { start: number; end: number }>> = {
  1: { 1: { start: 7, end: 11 }, 2: { start: 11, end: 15 } },
  2: { 1: { start: 15, end: 19 }, 2: { start: 19, end: 23 } },
  3: { 1: { start: 23, end: 3 }, 2: { start: 3, end: 7 } },
};
const ALL_SLOTS = [
  { shift: 1, round: 1 }, { shift: 1, round: 2 },
  { shift: 2, round: 1 }, { shift: 2, round: 2 },
  { shift: 3, round: 1 }, { shift: 3, round: 2 },
];
const STATUS_COLOR: Record<string, [number, number, number]> = {
  normal: [5, 150, 105], warning: [217, 119, 6], abnormal: [220, 38, 38],
};


function runAutoTable(doc: any, options: any) {
  if (typeof autoTable === "function") {
    autoTable(doc, options);
  } else if (typeof doc.autoTable === "function") {
    doc.autoTable(options);
  } else {
    throw new Error("jspdf-autotable could not be resolved in this runtime");
  }
}

// Converting bytes to base64 one character at a time (bin += String.fromCharCode(buf[i]))
// is extremely CPU/memory heavy for larger files (many photos, or the final PDF) and was
// the cause of edge function resource-limit errors (546) on busy report days. Processing
// in chunks keeps memory flat and is dramatically faster.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000; // 32KB per chunk
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

// Simple timing helper so a future CPU/resource-limit failure shows exactly which
// phase was slow, instead of a bare "CPU Time exceeded" with no breakdown.
function time(label: string): () => void {
  const start = performance.now();
  return () => console.log(`[timing] ${label}: ${(performance.now() - start).toFixed(0)}ms`);
}

// Runs async tasks with a concurrency cap, so many photo downloads overlap instead of
// running one at a time (which was the main source of the report taking so long).
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const MAX_PHOTOS_PER_SECTION = 20; // bounds worst-case CPU/time as photo volume grows

function slotLabel(shift: number, round: number): string {
  const wnd = ROUND_WINDOWS[shift][round];
  const timeLabel = `${String(wnd.start).padStart(2, "0")}.00`;
  return `${timeLabel}\n(${SHIFT_LABELS[shift].toUpperCase()} R${round})`;
}
function keteranganFor(type?: string): string {
  return type === "boolean" || type === "option" ? "Cek" : "Catat";
}
function parameterSpecFor(p?: { type?: string; unit?: string | null; options?: string[] }): string {
  if (!p) return "-";
  if (p.type === "boolean") return "OK / NO *)";
  if (p.type === "option") return p.options?.length ? p.options.join(" / ") + " *)" : "-";
  if (p.unit) return p.unit;
  return "-";
}

// Jakarta = UTC+7, no DST.
function jakartaNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 7 * 60 * 60 * 1000);
}
function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}

async function buildReportPdf(
  supabaseAdmin: ReturnType<typeof createClient>,
  targetDate: string
): Promise<Uint8Array | null> {
  const totalTimer = time("buildReportPdf total");
  let stepTimer = time("fetch-rounds-values-photos-parameters");
  const { data: rounds } = await supabaseAdmin
    .from("monitoring_rounds")
    .select("*")
    .eq("monitoring_date", targetDate)
    .order("shift_number")
    .order("round_number");
  if (!rounds || rounds.length === 0) return null;

  const roundIds = rounds.map((r: any) => r.id);
  const [{ data: values }, { data: photos }, { data: parameters }, { data: schedules }] = await Promise.all([
    supabaseAdmin.from("monitoring_values").select("*").in("round_id", roundIds),
    supabaseAdmin.from("monitoring_photos").select("*").in("round_id", roundIds),
    supabaseAdmin.from("parameters").select("*"),
    supabaseAdmin.from("schedules").select("machine_id, shift_number, round_number").eq("is_active", true),
  ]);
  const valuesArr = values || [];
  const photosArr = photos || [];
  const paramById = new Map((parameters || []).map((p: any) => [p.id, p]));
  const scheduledSlots = new Set((schedules || []).map((s: any) => `${s.machine_id}|${s.shift_number}|${s.round_number}`));
  stepTimer();

  const doc = new jsPDF("l", "mm", "a4");
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(), m = 8;
  const bottomLimit = h - 12;
  const normal = valuesArr.filter((v: any) => v.status === "normal").length;
  const warning = valuesArr.filter((v: any) => v.status === "warning").length;
  const abnormal = valuesArr.filter((v: any) => v.status === "abnormal").length;
  const formatted = new Date(targetDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  function drawHeader() {
    doc.setFillColor(18, 79, 121); doc.rect(0, 0, w, 18, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text("PT. INTERBAT - EQUIPMENT MONITORING REPORT", m, 8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    doc.text(`Tanggal: ${formatted} | Laporan Harian Otomatis (24 jam)`, m, 14);
    doc.setTextColor(51, 65, 85); doc.setFontSize(7.5);
    doc.text(`Total round: ${rounds.length}  |  Reading: ${valuesArr.length}  |  Normal: ${normal}  |  Warning: ${warning}  |  Abnormal: ${abnormal}`, m, 23);
  }

  drawHeader();
  let cursorY = 27;

  const roundBySlot = new Map<string, any>();
  for (const r of rounds) roundBySlot.set(`${r.machine_id}|${r.shift_number}|${r.round_number}`, r);
  const valuesByRoundId = new Map<string, any[]>();
  for (const v of valuesArr) {
    if (!valuesByRoundId.has(v.round_id)) valuesByRoundId.set(v.round_id, []);
    valuesByRoundId.get(v.round_id)!.push(v);
  }

  const machineOrder: string[] = [];
  const machineIdByName = new Map<string, string>();
  for (const r of [...rounds].sort((a: any, b: any) => a.machine_name.localeCompare(b.machine_name))) {
    if (!machineOrder.includes(r.machine_name)) {
      machineOrder.push(r.machine_name);
      machineIdByName.set(r.machine_name, r.machine_id);
    }
  }

  function ensureSpace(needed: number) {
    if (cursorY + needed > bottomLimit) {
      doc.addPage(); drawHeader(); cursorY = 27;
    }
  }

  stepTimer = time("build-machine-tables");
  for (const machineName of machineOrder) {
    const machineId = machineIdByName.get(machineName)!;
    const paramOrder: string[] = [];
    for (const slot of ALL_SLOTS) {
      const round = roundBySlot.get(`${machineId}|${slot.shift}|${slot.round}`);
      if (!round) continue;
      for (const v of valuesByRoundId.get(round.id) || []) {
        if (!paramOrder.includes(v.parameter_id)) paramOrder.push(v.parameter_id);
      }
    }
    if (paramOrder.length === 0) continue;

    ensureSpace(12);
    doc.setFillColor(234, 244, 252);
    doc.rect(m, cursorY, w - m * 2, 6, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(18, 79, 121);
    doc.text(machineName, m + 2, cursorY + 4.2);
    cursorY += 8;

    const head = [["ITEM DESCRIPTION", "Keterangan", "PARAMETER", ...ALL_SLOTS.map((s) => slotLabel(s.shift, s.round)), "NOTE"]];
    const body: string[][] = [];
    const statusGrid: string[][] = [];

    // "Teknisi" row: shows who performed each round, so the PIC per shift/round is visible at a glance.
    const techRow = ["Teknisi Monitoring", "-", "-"];
    const techRowStatus: string[] = [];
    for (const slot of ALL_SLOTS) {
      const key = `${machineId}|${slot.shift}|${slot.round}`;
      const round = roundBySlot.get(key);
      if (round) {
        techRow.push(round.technician_name);
        techRowStatus.push("meta");
      } else if (scheduledSlots.has(key)) {
        techRow.push("Tidak Dilakukan");
        techRowStatus.push("missed");
      } else {
        techRow.push("N/A");
        techRowStatus.push("na");
      }
    }
    techRow.push("");
    body.push(techRow);
    statusGrid.push(techRowStatus);

    for (const paramId of paramOrder) {
      const param: any = paramById.get(paramId);
      const name = param?.name || valuesArr.find((v: any) => v.parameter_id === paramId)?.parameter_name || "-";
      const row = [name, keteranganFor(param?.type), parameterSpecFor(param)];
      const rowStatus: string[] = [];
      const notesSet = new Set<string>();
      for (const slot of ALL_SLOTS) {
        const key = `${machineId}|${slot.shift}|${slot.round}`;
        const round = roundBySlot.get(key);
        const val = round ? (valuesByRoundId.get(round.id) || []).find((v: any) => v.parameter_id === paramId) : undefined;
        if (val) {
          row.push(val.value && val.value.trim() ? val.value : "\u2014");
          rowStatus.push(val.status);
          if (val.notes && val.notes.trim()) notesSet.add(val.notes.trim());
        } else if (scheduledSlots.has(key)) {
          row.push("Tidak Dilakukan");
          rowStatus.push("missed");
        } else {
          row.push("N/A");
          rowStatus.push("na");
        }
      }
      row.push(Array.from(notesSet).join("; "));
      body.push(row);
      statusGrid.push(rowStatus);
    }

    ensureSpace(14);
    runAutoTable(doc, {
      startY: cursorY,
      head, body,
      theme: "grid",
      margin: { left: m, right: m },
      styles: { fontSize: 6.3, cellPadding: 1.3, overflow: "linebreak", valign: "middle" },
      headStyles: { fillColor: [18, 79, 121], textColor: 255, fontSize: 6, cellPadding: 1.4, halign: "center" },
      columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 16, halign: "center" }, 2: { cellWidth: 26 }, 9: { cellWidth: 44 } },
      didParseCell: (c: any) => {
        const slotStart = 3;
        if (c.section === "body" && c.column.index >= slotStart && c.column.index < slotStart + ALL_SLOTS.length) {
          const status = statusGrid[c.row.index][c.column.index - slotStart];
          if (status === "na") {
            c.cell.styles.fillColor = [241, 245, 249]; c.cell.styles.textColor = [148, 163, 184]; c.cell.styles.fontStyle = "italic";
          } else if (status === "missed") {
            c.cell.styles.fillColor = [254, 243, 199]; c.cell.styles.textColor = [180, 83, 9]; c.cell.styles.fontStyle = "bold";
          } else if (status === "meta") {
            c.cell.styles.fillColor = [234, 244, 252]; c.cell.styles.textColor = [12, 58, 89]; c.cell.styles.fontStyle = "bold";
          } else if (STATUS_COLOR[status]) {
            c.cell.styles.textColor = STATUS_COLOR[status]; c.cell.styles.fontStyle = "bold";
          }
        }
        if (c.section === "body" && c.row.index === 0) {
          c.cell.styles.fillColor = c.cell.styles.fillColor || [234, 244, 252];
          c.cell.styles.fontStyle = "bold";
        }
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 5;
  }
  stepTimer();

  if (photosArr.length) {
    doc.addPage(); drawHeader(); cursorY = 27;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(18, 79, 121);
    doc.text("LAMPIRAN FOTO", m, cursorY);
    cursorY += 6;

    const roundInfoById = new Map(rounds.map((r: any) => [r.id, r]));
    const thumbW = 40, thumbH = 30, gap = 4;
    let x = m, rowMaxH = 0;

    const photosToRender = photosArr.slice(0, MAX_PHOTOS_PER_SECTION);
    const skippedCount = photosArr.length - photosToRender.length;

    // Download + base64-encode every photo concurrently (bounded) instead of one at a
    // time — this was the single biggest contributor to the function running long.
    stepTimer = time(`download-lampiran-photos (${photosToRender.length})`);
    const dataUrlByPhotoId = new Map<string, string | null>();
    await mapWithConcurrency(photosToRender, 6, async (photo: any) => {
      let dataUrl: string | null = null;
      try {
        const { data: fileBlob } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(photo.storage_path);
        if (fileBlob) {
          const buf = new Uint8Array(await fileBlob.arrayBuffer());
          const b64 = bytesToBase64(buf);
          const ext = (photo.storage_path.split(".").pop() || "jpg").toLowerCase();
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          dataUrl = `data:${mime};base64,${b64}`;
        }
      } catch { /* skip missing photo */ }
      dataUrlByPhotoId.set(photo.id, dataUrl);
    });
    stepTimer();

    stepTimer = time("draw-lampiran-photos");
    for (const photo of photosToRender) {
      const round: any = roundInfoById.get(photo.round_id);
      const param: any = photo.parameter_id ? paramById.get(photo.parameter_id) : undefined;
      const dataUrl = dataUrlByPhotoId.get(photo.id) ?? null;

      const caption = [round?.machine_name, round ? `Shift ${round.shift_number} R${round.round_number}` : "", param?.name || ""].filter(Boolean).join(" \u2022 ");
      const capLines = doc.splitTextToSize(caption, thumbW);
      const blockH = thumbH + 3 + capLines.length * 2.6 + 4;

      if (x + thumbW > w - m) { x = m; cursorY += rowMaxH; rowMaxH = 0; }
      if (cursorY + blockH > bottomLimit) { doc.addPage(); drawHeader(); cursorY = 27; x = m; rowMaxH = 0; }

      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);
      doc.rect(x, cursorY, thumbW, thumbH);

      if (dataUrl) {
        try { doc.addImage(dataUrl, dataUrl.includes("png") ? "PNG" : "JPEG", x, cursorY, thumbW, thumbH); }
        catch { /* border already drawn; leave cell empty on failure */ }
      } else {
        doc.setFillColor(245, 245, 245);
        doc.rect(x + 0.3, cursorY + 0.3, thumbW - 0.6, thumbH - 0.6, "F");
        doc.setFontSize(5.5); doc.setTextColor(150);
        doc.text("N/A", x + thumbW / 2, cursorY + thumbH / 2, { align: "center" });
      }
      doc.setFont("helvetica", "normal"); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
      doc.text(capLines, x, cursorY + thumbH + 3, { maxWidth: thumbW });

      rowMaxH = Math.max(rowMaxH, blockH);
      x += thumbW + gap;
    }
    if (skippedCount > 0) {
      doc.setFontSize(6.5); doc.setTextColor(150);
      doc.text(`+${skippedCount} foto lainnya tidak ditampilkan (lihat di aplikasi).`, m, cursorY + rowMaxH + 4);
    }
    stepTimer();
  }

  // ---- Titipan Pekerjaan: always the very last section of the report ----
  stepTimer = time("fetch-work-requests");
  const dayStartUtc = new Date(`${targetDate}T00:00:00+07:00`).toISOString();
  const dayEndUtc = new Date(new Date(`${targetDate}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data: workRequests } = await supabaseAdmin
    .from("work_requests")
    .select("*")
    .gte("created_at", dayStartUtc)
    .lt("created_at", dayEndUtc)
    .order("created_at");
  stepTimer();

  if (workRequests && workRequests.length) {
    const wrIds = workRequests.map((wr: any) => wr.id);
    const { data: wrPhotos } = wrIds.length
      ? await supabaseAdmin.from("work_request_photos").select("*").in("work_request_id", wrIds)
      : { data: [] as any[] };
    const photosByRequest = new Map<string, any[]>();
    for (const p of wrPhotos || []) {
      if (!photosByRequest.has(p.work_request_id)) photosByRequest.set(p.work_request_id, []);
      photosByRequest.get(p.work_request_id)!.push(p);
    }

    // Prefetch every work-request photo concurrently (bounded, capped) up front, same
    // reasoning as the LAMPIRAN FOTO section above.
    const allWrPhotos = (wrPhotos || []).slice(0, MAX_PHOTOS_PER_SECTION);
    stepTimer = time(`download-titipan-photos (${allWrPhotos.length})`);
    const wrDataUrlByPhotoId = new Map<string, string | null>();
    await mapWithConcurrency(allWrPhotos, 6, async (photo: any) => {
      let dataUrl: string | null = null;
      try {
        const { data: fileBlob } = await supabaseAdmin.storage.from(STORAGE_BUCKET).download(photo.storage_path);
        if (fileBlob) {
          const buf = new Uint8Array(await fileBlob.arrayBuffer());
          const ext = (photo.storage_path.split(".").pop() || "jpg").toLowerCase();
          const mime = ext === "png" ? "image/png" : "image/jpeg";
          dataUrl = `data:${mime};base64,${bytesToBase64(buf)}`;
        }
      } catch { /* skip missing photo */ }
      wrDataUrlByPhotoId.set(photo.id, dataUrl);
    });
    stepTimer();

    stepTimer = time("draw-titipan-pekerjaan");
    doc.addPage(); drawHeader(); cursorY = 27;
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(18, 79, 121);
    doc.text("TITIPAN PEKERJAAN", m, cursorY);
    cursorY += 7;

    for (const wr of workRequests) {
      const timeLabel = new Date(wr.created_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      ensureSpace(16);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
      doc.text(wr.title, m, cursorY);
      cursorY += 4;
      doc.setFont("helvetica", "normal"); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
      doc.text(`Diminta oleh: ${wr.requested_by}   |   Teknisi: ${wr.technician_name}   |   Jam: ${timeLabel}`, m, cursorY);
      cursorY += 4;

      doc.setFontSize(7); doc.setTextColor(51, 65, 85);
      const descLines = doc.splitTextToSize(wr.description, w - m * 2);
      ensureSpace(descLines.length * 3.4);
      doc.text(descLines, m, cursorY);
      cursorY += descLines.length * 3.4 + 2;

      const reqPhotos = photosByRequest.get(wr.id) || [];
      if (reqPhotos.length) {
        const thumbH = 26, maxThumbW = 34, gap = 3;
        let x = m, rowMaxH = 0;
        ensureSpace(thumbH + 4);
        for (const photo of reqPhotos) {
          const dataUrl = wrDataUrlByPhotoId.get(photo.id) ?? null;

          if (x + maxThumbW > w - m) { x = m; cursorY += rowMaxH + 2; rowMaxH = 0; ensureSpace(thumbH + 4); }

          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.2);
          doc.rect(x, cursorY, maxThumbW, thumbH);

          if (dataUrl) {
            try { doc.addImage(dataUrl, dataUrl.includes("png") ? "PNG" : "JPEG", x, cursorY, maxThumbW, thumbH); }
            catch { /* border already drawn; leave cell empty on failure */ }
          } else {
            doc.setFillColor(245, 245, 245);
            doc.rect(x + 0.3, cursorY + 0.3, maxThumbW - 0.6, thumbH - 0.6, "F");
          }
          rowMaxH = Math.max(rowMaxH, thumbH);
          x += maxThumbW + gap;
        }
        cursorY += rowMaxH + 3;
      }

      ensureSpace(4);
      doc.setDrawColor(226, 232, 240);
      doc.line(m, cursorY, w - m, cursorY);
      cursorY += 4;
    }
    stepTimer();
  }

  stepTimer = time("pdf-output");
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(6.5); doc.setTextColor(120, 130, 140);
    doc.text(`Generated ${new Date().toLocaleString("id-ID")} | Page ${i}/${pages}`, w / 2, h - 4, { align: "center" });
  }
  const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  stepTimer();
  totalTimer();
  return bytes;
}

async function sendEmailWithAttachment(apiKey: string, fromEmail: string, fromName: string, to: string[], subject: string, html: string, pdfBytes: Uint8Array, filename: string) {
  const base64 = bytesToBase64(pdfBytes);

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: to.map((email) => ({ email })),
      subject,
      htmlContent: html,
      attachment: [{ content: base64, name: filename }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  let step = "init";
  try {
    let overrideDate: string | undefined;
    let requestedBy: string | undefined;
    try {
      const body = await req.json();
      overrideDate = body?.date;
      requestedBy = body?.requestedBy;
    } catch { /* no body / GET trigger, that's fine */ }

    step = "create-admin-client";
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Manual trigger from the app UI includes requestedBy — verify that caller is an
    // active admin. Scheduled (Cron) invocations omit it and are trusted server-side.
    if (requestedBy) {
      step = "verify-admin";
      const { data: requester } = await supabaseAdmin
        .from("profiles")
        .select("role, is_active")
        .eq("id", requestedBy)
        .maybeSingle();
      if (!requester || requester.role !== "admin" || !requester.is_active) {
        return new Response(JSON.stringify({ error: "Only an active admin can send the report manually" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Default target = "yesterday" in Asia/Jakarta, since Shift 3 Round 2 (03:00-07:00)
    // is recorded under the previous day's monitoring_date and this runs right after 07:00 WIB.
    const targetDate = overrideDate || toDateStr(new Date(jakartaNow().getTime() - 24 * 60 * 60 * 1000));

    step = "fetch-recipients";
    const { data: recipients, error: recipientsErr } = await supabaseAdmin
      .from("report_recipients")
      .select("email")
      .eq("is_active", true);
    if (recipientsErr) throw new Error(`fetch-recipients: ${recipientsErr.message}`);

    if (!recipients || recipients.length === 0) {
      return new Response(JSON.stringify({ skipped: "no active recipients" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    step = "build-pdf";
    const pdfBytes = await buildReportPdf(supabaseAdmin, targetDate);
    if (!pdfBytes) {
      return new Response(JSON.stringify({ skipped: `no monitoring data for ${targetDate}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    step = "check-secrets";
    const brevoKey = Deno.env.get("BREVO_API_KEY");
    if (!brevoKey) {
      return new Response(JSON.stringify({ error: "BREVO_API_KEY is not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const fromEmail = Deno.env.get("REPORT_FROM_EMAIL");
    if (!fromEmail) {
      return new Response(JSON.stringify({ error: "REPORT_FROM_EMAIL is not configured (must be a Brevo-verified sender)" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const fromName = Deno.env.get("REPORT_FROM_NAME") || "Equipment Monitoring";

    step = "send-email";
    const sendEmailTimer = time("send-email");
    const formatted = new Date(targetDate + "T00:00:00").toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const result = await sendEmailWithAttachment(
      brevoKey,
      fromEmail,
      fromName,
      recipients.map((r: any) => r.email),
      `Equipment Monitoring Report - ${formatted}`,
      `<p>Terlampir laporan monitoring equipment untuk tanggal <b>${formatted}</b> (24 jam, Shift 1-3), dikirim otomatis setelah Shift 3 selesai.</p>`,
      pdfBytes,
      `monitoring-report-${targetDate}.pdf`
    );
    sendEmailTimer();

    if (!result.ok) {
      console.error("send-shift-report: brevo send failed", result.status, result.body);
      return new Response(JSON.stringify({ error: "Failed to send email", detail: result.body }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, date: targetDate, sentTo: recipients.length }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`send-shift-report failed at step "${step}":`, err);
    return new Response(
      JSON.stringify({ error: err?.message || "Internal server error", step, stack: String(err?.stack || "").slice(0, 1500) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
