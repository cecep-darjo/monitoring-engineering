import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SHIFT_LABELS, ROUND_WINDOWS, type MonitoringRound, type MonitoringValue, type MonitoringPhoto, type Parameter, type WorkRequest, type WorkRequestPhoto } from './types';

interface ReportData {
  date: string;
  rounds: MonitoringRound[];
  values: MonitoringValue[];
  photos: MonitoringPhoto[];
  photoUrls: Record<string, string>;
  parameters: Parameter[];
  workRequests: WorkRequest[];
  workRequestPhotos: WorkRequestPhoto[];
  workRequestPhotoUrls: Record<string, string>;
  schedules: { id: string; machine_id: string; shift_number: number; round_number: number }[];
  scheduleParameters: { schedule_id: string; parameter_id: string; sort_order: number; depends_on_parameter_id: string | null; depends_on_value: string | null }[];
  machineFilter: string | null;
  shiftFilter: number | null;
}

const STATUS_COLOR: Record<string, [number, number, number]> = {
  normal: [5, 150, 105],
  warning: [217, 119, 6],
  abnormal: [220, 38, 38],
};

const ALL_SLOTS: { shift: number; round: number }[] = [
  { shift: 1, round: 1 }, { shift: 1, round: 2 },
  { shift: 2, round: 1 }, { shift: 2, round: 2 },
  { shift: 3, round: 1 }, { shift: 3, round: 2 },
];

function slotLabel(shift: number, round: number): string {
  const w = ROUND_WINDOWS[shift][round];
  const time = `${String(w.start).padStart(2, '0')}.00`;
  return `${time}\n(${SHIFT_LABELS[shift].toUpperCase()} R${round})`;
}

function keteranganFor(param?: Parameter): string {
  if (!param) return 'Catat';
  return param.type === 'boolean' || param.type === 'option' ? 'Cek' : 'Catat';
}

function parameterSpecFor(param?: Parameter): string {
  if (!param) return '-';
  if (param.type === 'boolean') return 'OK / NO *)';
  if (param.type === 'option') return param.options?.length ? param.options.join(' / ') + ' *)' : '-';
  if (param.unit) return param.unit;
  return '-';
}

async function toDataUrl(url: string): Promise<{ dataUrl: string; format: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const format = blob.type.includes('png') ? 'PNG' : 'JPEG';
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { dataUrl, format };
  } catch {
    return null;
  }
}

function getImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.width, h: img.height });
    img.onerror = () => resolve({ w: 4, h: 3 });
    img.src = dataUrl;
  });
}

export async function generateReportPDF(data: ReportData) {
  const { date, rounds, values, photos, photoUrls, parameters, workRequests, workRequestPhotos, workRequestPhotoUrls, schedules, scheduleParameters, machineFilter, shiftFilter } = data;
  const doc = new jsPDF('l', 'mm', 'a4');
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(), m = 8;
  const bottomLimit = h - 12;
  const normal = values.filter(v => v.status === 'normal').length;
  const warning = values.filter(v => v.status === 'warning').length;
  const abnormal = values.filter(v => v.status === 'abnormal').length;
  const formatted = new Date(date + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  const paramById = new Map(parameters.map(p => [p.id, p]));

  function drawHeader() {
    doc.setFillColor(18, 79, 121); doc.rect(0, 0, w, 18, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('PT. INTERBAT - EQUIPMENT MONITORING REPORT', m, 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    doc.text(`Tanggal: ${formatted}${machineFilter ? ' | Mesin: ' + machineFilter : ''}${shiftFilter ? ' | ' + SHIFT_LABELS[shiftFilter] : ''}`, m, 14);
    doc.setTextColor(51, 65, 85); doc.setFontSize(7.5);
    doc.text(`Total round: ${rounds.length}  |  Reading: ${values.length}  |  Normal: ${normal}  |  Warning: ${warning}  |  Abnormal: ${abnormal}`, m, 23);
  }

  drawHeader();
  let cursorY = 27;

  const slots = shiftFilter ? ALL_SLOTS.filter(s => s.shift === shiftFilter) : ALL_SLOTS;

  // round lookup: machine_id -> "shift-round" -> round
  const roundBySlot = new Map<string, MonitoringRound>();
  for (const r of rounds) roundBySlot.set(`${r.machine_id}|${r.shift_number}|${r.round_number}`, r);

  const scheduleBySlot = new Map(schedules.map((s) => [`${s.machine_id}|${s.shift_number}|${s.round_number}`, s] as const));
  const scheduleParamsByScheduleId = new Map<string, ReportData['scheduleParameters']>();
  for (const sp of scheduleParameters) {
    if (!scheduleParamsByScheduleId.has(sp.schedule_id)) scheduleParamsByScheduleId.set(sp.schedule_id, []);
    scheduleParamsByScheduleId.get(sp.schedule_id)!.push(sp);
  }
  for (const arr of scheduleParamsByScheduleId.values()) {
    arr.sort((a, b) => a.sort_order - b.sort_order);
  }

  // Slot dianggap "terjadwal" hanya jika schedule tersebut punya minimal 1 parameter aktif.
  const scheduledSlotsWithParams = new Set<string>();
  for (const [slotKey, schedule] of scheduleBySlot.entries()) {
    if ((scheduleParamsByScheduleId.get(schedule.id) || []).length > 0) {
      scheduledSlotsWithParams.add(slotKey);
    }
  }

  const valuesByRoundId = new Map<string, MonitoringValue[]>();
  for (const v of values) {
    if (!valuesByRoundId.has(v.round_id)) valuesByRoundId.set(v.round_id, []);
    valuesByRoundId.get(v.round_id)!.push(v);
  }

  // Group machines in first-seen order
  const machineOrder: string[] = [];
  const machineIdByName = new Map<string, string>();
  for (const r of [...rounds].sort((a, b) => a.machine_name.localeCompare(b.machine_name))) {
    if (!machineOrder.includes(r.machine_name)) {
      machineOrder.push(r.machine_name);
      machineIdByName.set(r.machine_name, r.machine_id);
    }
  }

  function ensureSpace(needed: number) {
    if (cursorY + needed > bottomLimit) {
      doc.addPage();
      drawHeader();
      cursorY = 27;
    }
  }

  for (const machineName of machineOrder) {
    const machineId = machineIdByName.get(machineName)!;

    // Parameters to show = configured in schedule (ordered), plus any historic values found.
    const paramOrder: string[] = [];
    const seenParamIds = new Set<string>();
    for (const slot of slots) {
      const schedule = scheduleBySlot.get(`${machineId}|${slot.shift}|${slot.round}`);
      if (!schedule) continue;
      const configured = scheduleParamsByScheduleId.get(schedule.id) || [];
      for (const sp of configured) {
        if (seenParamIds.has(sp.parameter_id)) continue;
        seenParamIds.add(sp.parameter_id);
        paramOrder.push(sp.parameter_id);
      }
    }
    for (const slot of slots) {
      const round = roundBySlot.get(`${machineId}|${slot.shift}|${slot.round}`);
      if (!round) continue;
      for (const v of valuesByRoundId.get(round.id) || []) {
        if (seenParamIds.has(v.parameter_id)) continue;
        seenParamIds.add(v.parameter_id);
        paramOrder.push(v.parameter_id);
      }
    }
    if (paramOrder.length === 0) continue;

    ensureSpace(12);
    doc.setFillColor(234, 244, 252);
    doc.rect(m, cursorY, w - m * 2, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(18, 79, 121);
    doc.text(machineName, m + 2, cursorY + 4.2);
    cursorY += 8;

    const head = [['ITEM DESCRIPTION', 'Keterangan', 'PARAMETER', ...slots.map(s => slotLabel(s.shift, s.round)), 'NOTE']];
    const body: string[][] = [];
    // statusGrid[row][slotColIndex] = status | 'na' | 'meta' (meta rows, e.g. technician name, are never status-colored)
    const statusGrid: string[][] = [];

    // "Teknisi" row: shows who performed each round, so the PIC per shift/round is visible at a glance.
    const techRow = ['Teknisi Monitoring', '-', '-'];
    const techRowStatus: string[] = [];
    for (const slot of slots) {
      const key = `${machineId}|${slot.shift}|${slot.round}`;
      const round = roundBySlot.get(key);
      if (round) {
        techRow.push(round.technician_name);
        techRowStatus.push('meta');
      } else if (scheduledSlotsWithParams.has(key)) {
        techRow.push('Tidak Dilakukan');
        techRowStatus.push('missed');
      } else {
        techRow.push('N/A');
        techRowStatus.push('na');
      }
    }
    techRow.push('');
    body.push(techRow);
    statusGrid.push(techRowStatus);

    for (const paramId of paramOrder) {
      const param = paramById.get(paramId);
      const name = param?.name || (values.find(v => v.parameter_id === paramId)?.parameter_name) || '-';
      const row = [name, keteranganFor(param), parameterSpecFor(param)];
      const rowStatus: string[] = [];
      const notesSet = new Set<string>();

      for (const slot of slots) {
        const key = `${machineId}|${slot.shift}|${slot.round}`;
        const round = roundBySlot.get(key);
        const roundValues = round ? (valuesByRoundId.get(round.id) || []) : [];
        const val = roundValues.find(v => v.parameter_id === paramId);
        const schedule = scheduleBySlot.get(key);
        const scheduleParam = schedule
          ? (scheduleParamsByScheduleId.get(schedule.id) || []).find((sp) => sp.parameter_id === paramId)
          : undefined;

        let isExpectedParam = false;
        if (scheduleParam) {
          if (!round) {
            // Round belum dilakukan, anggap semua parameter terjadwal sebagai "harusnya diisi".
            isExpectedParam = true;
          } else if (!scheduleParam.depends_on_parameter_id) {
            isExpectedParam = true;
          } else {
            const triggerVal = roundValues.find((v) => v.parameter_id === scheduleParam.depends_on_parameter_id)?.value;
            isExpectedParam = triggerVal === scheduleParam.depends_on_value;
          }
        }

        if (val && val.value && val.value.trim()) {
          row.push(val.value);
          rowStatus.push(val.status);
          if (val.notes && val.notes.trim()) notesSet.add(val.notes.trim());
        } else if (isExpectedParam) {
          row.push('Tidak Dilakukan');
          rowStatus.push('missed');
        } else {
          row.push('N/A');
          rowStatus.push('na');
        }
      }
      row.push(Array.from(notesSet).join('; '));
      body.push(row);
      statusGrid.push(rowStatus);
    }

    ensureSpace(14);
    autoTable(doc, {
      startY: cursorY,
      head, body,
      theme: 'grid',
      margin: { left: m, right: m },
      styles: { fontSize: 6.3, cellPadding: 1.3, overflow: 'linebreak', valign: 'middle' },
      headStyles: { fillColor: [18, 79, 121], textColor: 255, fontSize: 6, cellPadding: 1.4, halign: 'center' },
      columnStyles: {
        0: { cellWidth: 42 }, 1: { cellWidth: 16, halign: 'center' }, 2: { cellWidth: 26 },
        [3 + slots.length]: { cellWidth: 44 },
      },
      didParseCell: (c) => {
        const slotStart = 3;
        if (c.section === 'body' && c.column.index >= slotStart && c.column.index < slotStart + slots.length) {
          const status = statusGrid[c.row.index][c.column.index - slotStart];
          if (status === 'na') {
            c.cell.styles.fillColor = [241, 245, 249];
            c.cell.styles.textColor = [148, 163, 184];
            c.cell.styles.fontStyle = 'italic';
          } else if (status === 'missed') {
            c.cell.styles.fillColor = [254, 243, 199];
            c.cell.styles.textColor = [180, 83, 9];
            c.cell.styles.fontStyle = 'bold';
          } else if (status === 'meta') {
            c.cell.styles.fillColor = [234, 244, 252];
            c.cell.styles.textColor = [12, 58, 89];
            c.cell.styles.fontStyle = 'bold';
          } else if (STATUS_COLOR[status]) {
            c.cell.styles.textColor = STATUS_COLOR[status];
            c.cell.styles.fontStyle = 'bold';
          }
        }
        if (c.section === 'body' && c.row.index === 0) {
          // Teknisi row: also style the leading label columns
          c.cell.styles.fillColor = c.cell.styles.fillColor || [234, 244, 252];
          c.cell.styles.fontStyle = 'bold';
        }
      },
    });
    // @ts-expect-error jspdf-autotable augments doc at runtime
    cursorY = doc.lastAutoTable.finalY + 5;
  }

  // ---- Photos: separated from the parameter table, all collected at the end of the report ----
  if (photos.length) {
    doc.addPage();
    drawHeader();
    cursorY = 27;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(18, 79, 121);
    doc.text('LAMPIRAN FOTO', m, cursorY);
    cursorY += 6;

    const roundInfoById = new Map(rounds.map(r => [r.id, r]));
    const cellW = 40, cellH = 30, gap = 4;
    let x = m, rowMaxH = 0;

    for (const photo of photos) {
      const round = roundInfoById.get(photo.round_id);
      const param = photo.parameter_id ? paramById.get(photo.parameter_id) : undefined;
      const url = photoUrls[photo.id];
      const loaded = url ? await toDataUrl(url) : null;
      let drawW = cellW, drawH = cellH, offX = 0, offY = 0;
      if (loaded) {
        const { w: iw, h: ih } = await getImageSize(loaded.dataUrl);
        const ratio = iw / ih || 1.33;
        if (ratio > cellW / cellH) { drawW = cellW; drawH = cellW / ratio; }
        else { drawH = cellH; drawW = cellH * ratio; }
        offX = (cellW - drawW) / 2;
        offY = (cellH - drawH) / 2;
      }

      const caption = [
        round ? `${round.machine_name}` : '',
        round ? `Shift ${round.shift_number} R${round.round_number}` : '',
        param?.name || '',
      ].filter(Boolean);
      const capLines = doc.splitTextToSize(caption.join(' \u2022 '), cellW);
      const blockH = cellH + 3 + capLines.length * 2.6 + 4;

      if (x + cellW > w - m) { x = m; cursorY += rowMaxH; rowMaxH = 0; }
      if (cursorY + blockH > bottomLimit) {
        doc.addPage(); drawHeader(); cursorY = 27; x = m; rowMaxH = 0;
      }

      // Border around the whole photo cell, so the image is framed consistently.
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.2);
      doc.rect(x, cursorY, cellW, cellH);

      if (loaded) {
        try { doc.addImage(loaded.dataUrl, loaded.format, x + offX, cursorY + offY, drawW, drawH); }
        catch { /* border already drawn; leave cell empty on failure */ }
      } else {
        doc.setFillColor(245, 245, 245);
        doc.rect(x + 0.3, cursorY + 0.3, cellW - 0.6, cellH - 0.6, 'F');
        doc.setFontSize(5.5); doc.setTextColor(150);
        doc.text('N/A', x + cellW / 2, cursorY + cellH / 2, { align: 'center' });
      }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
      doc.text(capLines, x, cursorY + cellH + 3, { maxWidth: cellW });

      rowMaxH = Math.max(rowMaxH, blockH);
      x += cellW + gap;
    }
  }

  // ---- Titipan Pekerjaan: always the very last section of the report ----
  if (workRequests.length) {
    doc.addPage();
    drawHeader();
    cursorY = 27;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(18, 79, 121);
    doc.text('TITIPAN PEKERJAAN', m, cursorY);
    cursorY += 7;

    const photosByRequest = new Map<string, WorkRequestPhoto[]>();
    for (const p of workRequestPhotos) {
      if (!photosByRequest.has(p.work_request_id)) photosByRequest.set(p.work_request_id, []);
      photosByRequest.get(p.work_request_id)!.push(p);
    }

    for (const wr of workRequests) {
      const time = new Date(wr.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      ensureSpace(16);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(15, 23, 42);
      doc.text(wr.title, m, cursorY);
      cursorY += 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); doc.setTextColor(100, 116, 139);
      doc.text(`Diminta oleh: ${wr.requested_by}   |   Teknisi: ${wr.technician_name}   |   Jam: ${time}`, m, cursorY);
      cursorY += 4;

      doc.setFontSize(7); doc.setTextColor(51, 65, 85);
      const descLines = doc.splitTextToSize(wr.description, w - m * 2);
      ensureSpace(descLines.length * 3.4);
      doc.text(descLines, m, cursorY);
      cursorY += descLines.length * 3.4 + 2;

      const reqPhotos = photosByRequest.get(wr.id) || [];
      if (reqPhotos.length) {
        const cellW = 34, cellH = 26, gap = 3;
        let x = m, rowMaxH = 0;
        ensureSpace(cellH + 4);
        for (const photo of reqPhotos) {
          const url = workRequestPhotoUrls[photo.id];
          const loaded = url ? await toDataUrl(url) : null;
          let drawW = cellW, drawH = cellH, offX = 0, offY = 0;
          if (loaded) {
            const { w: iw, h: ih } = await getImageSize(loaded.dataUrl);
            const ratio = iw / ih || 1.33;
            if (ratio > cellW / cellH) { drawW = cellW; drawH = cellW / ratio; }
            else { drawH = cellH; drawW = cellH * ratio; }
            offX = (cellW - drawW) / 2;
            offY = (cellH - drawH) / 2;
          }
          if (x + cellW > w - m) { x = m; cursorY += rowMaxH + 2; rowMaxH = 0; ensureSpace(cellH + 4); }

          doc.setDrawColor(203, 213, 225);
          doc.setLineWidth(0.2);
          doc.rect(x, cursorY, cellW, cellH);

          if (loaded) {
            try { doc.addImage(loaded.dataUrl, loaded.format, x + offX, cursorY + offY, drawW, drawH); }
            catch { /* border already drawn; leave cell empty on failure */ }
          } else {
            doc.setFillColor(245, 245, 245);
            doc.rect(x + 0.3, cursorY + 0.3, cellW - 0.6, cellH - 0.6, 'F');
          }
          rowMaxH = Math.max(rowMaxH, cellH);
          x += cellW + gap;
        }
        cursorY += rowMaxH + 3;
      }

      ensureSpace(4);
      doc.setDrawColor(226, 232, 240);
      doc.line(m, cursorY, w - m, cursorY);
      cursorY += 4;
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(6.5); doc.setTextColor(120, 130, 140); doc.text(`Generated ${new Date().toLocaleString('id-ID')} | Page ${i}/${pages}`, w / 2, h - 4, { align: 'center' }); }
  doc.save(`monitoring-report-${date}${shiftFilter ? '-shift' + shiftFilter : ''}.pdf`);
}
