import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Machine, Parameter } from './types';

export interface TrendPoint {
  roundId: string;
  label: string;         // short x-axis label, e.g. "12 Sep S1R1"
  date: string;           // monitoring_date
  shift: number;
  round: number;
  value: number;
  status: 'normal' | 'warning' | 'abnormal';
  notes: string | null;
}

interface TrendPdfData {
  machine: Machine;
  parameter: Parameter;
  dateFrom: string;
  dateTo: string;
  points: TrendPoint[];
}

const STATUS_COLOR: Record<string, [number, number, number]> = {
  normal: [5, 150, 105],
  warning: [217, 119, 6],
  abnormal: [220, 38, 38],
};

export function generateTrendPDF(data: TrendPdfData) {
  const { machine, parameter, dateFrom, dateTo, points } = data;
  const doc = new jsPDF('l', 'mm', 'a4');
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(), m = 10;

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

  function drawHeader() {
    doc.setFillColor(18, 79, 121); doc.rect(0, 0, w, 20, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('PT. INTERBAT - TREND PARAMETER REPORT', m, 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.text(`Mesin: ${machine.name}  |  Parameter: ${parameter.name}${parameter.unit ? ' (' + parameter.unit + ')' : ''}  |  Periode: ${fmtDate(dateFrom)} - ${fmtDate(dateTo)}`, m, 15.5);
  }
  drawHeader();

  const normalCount = points.filter(p => p.status === 'normal').length;
  const warningCount = points.filter(p => p.status === 'warning').length;
  const abnormalCount = points.filter(p => p.status === 'abnormal').length;
  const total = points.length;
  const deviatingCount = warningCount + abnormalCount;

  let y = 27;

  // --- Summary boxes ---
  const boxW = (w - m * 2 - 3 * 4) / 4;
  const summary = [
    { label: 'Total Pembacaan', value: String(total), color: [51, 65, 85] as [number, number, number] },
    { label: 'Normal', value: String(normalCount), color: STATUS_COLOR.normal },
    { label: 'Warning', value: String(warningCount), color: STATUS_COLOR.warning },
    { label: 'Abnormal', value: String(abnormalCount), color: STATUS_COLOR.abnormal },
  ];
  summary.forEach((s, i) => {
    const x = m + i * (boxW + 4);
    doc.setDrawColor(226, 232, 240); doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, boxW, 18, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...s.color);
    doc.text(s.value, x + 4, y + 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(100, 116, 139);
    doc.text(s.label, x + 4, y + 15.5);
  });
  y += 24;

  // --- Chart ---
  const chartX = m, chartY = y, chartW = w - m * 2, chartH = 75;
  doc.setDrawColor(226, 232, 240);
  doc.rect(chartX, chartY, chartW, chartH);

  if (points.length > 0) {
    const values = points.map(p => p.value);
    const minVal = parameter.min_value !== null && parameter.min_value !== undefined ? Math.min(parameter.min_value, ...values) : Math.min(...values);
    const maxVal = parameter.max_value !== null && parameter.max_value !== undefined ? Math.max(parameter.max_value, ...values) : Math.max(...values);
    const pad = (maxVal - minVal) * 0.15 || 1;
    const yMin = minVal - pad, yMax = maxVal + pad;
    const plotLeft = chartX + 14, plotRight = chartX + chartW - 4, plotTop = chartY + 4, plotBottom = chartY + chartH - 12;
    const plotW = plotRight - plotLeft, plotH = plotBottom - plotTop;

    const xFor = (i: number) => points.length === 1 ? plotLeft + plotW / 2 : plotLeft + (i / (points.length - 1)) * plotW;
    const yFor = (v: number) => plotBottom - ((v - yMin) / (yMax - yMin)) * plotH;

    // Normal range band
    if (parameter.min_value !== null && parameter.min_value !== undefined && parameter.max_value !== null && parameter.max_value !== undefined) {
      doc.setFillColor(236, 253, 245);
      const bandTop = yFor(parameter.max_value), bandBottom = yFor(parameter.min_value);
      doc.rect(plotLeft, bandTop, plotW, bandBottom - bandTop, 'F');
      doc.setDrawColor(167, 243, 208); doc.setLineDashPattern([1, 1], 0);
      doc.line(plotLeft, bandTop, plotRight, bandTop);
      doc.line(plotLeft, bandBottom, plotRight, bandBottom);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(5.5); doc.setTextColor(5, 150, 105);
      doc.text(`Max Normal: ${parameter.max_value}`, plotRight, bandTop - 1, { align: 'right' });
      doc.text(`Min Normal: ${parameter.min_value}`, plotRight, bandBottom + 3, { align: 'right' });
    }

    // Y-axis labels (4 ticks)
    doc.setFontSize(6); doc.setTextColor(100, 116, 139);
    for (let t = 0; t <= 4; t++) {
      const val = yMin + (t / 4) * (yMax - yMin);
      const yy = yFor(val);
      doc.text(val.toFixed(1), chartX + 12, yy + 1, { align: 'right' });
      doc.setDrawColor(241, 245, 249);
      doc.line(plotLeft, yy, plotRight, yy);
    }

    // Line connecting points
    doc.setDrawColor(27, 127, 189); doc.setLineWidth(0.4);
    for (let i = 0; i < points.length - 1; i++) {
      doc.line(xFor(i), yFor(points[i].value), xFor(i + 1), yFor(points[i + 1].value));
    }
    // Points, colored by status
    points.forEach((p, i) => {
      const color = STATUS_COLOR[p.status];
      doc.setFillColor(...color);
      doc.circle(xFor(i), yFor(p.value), 0.9, 'F');
    });

    // X-axis labels — thin out if too many points to avoid overlap
    doc.setFontSize(5.5); doc.setTextColor(100, 116, 139);
    const maxLabels = 12;
    const step = Math.max(1, Math.ceil(points.length / maxLabels));
    for (let i = 0; i < points.length; i += step) {
      doc.text(points[i].label, xFor(i), plotBottom + 5, { align: 'center', angle: 0 });
    }
  } else {
    doc.setFontSize(9); doc.setTextColor(150);
    doc.text('Tidak ada data pada periode ini.', chartX + chartW / 2, chartY + chartH / 2, { align: 'center' });
  }
  y = chartY + chartH + 8;

  // --- Kesimpulan ---
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(18, 79, 121);
  doc.text('KESIMPULAN', m, y);
  y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(51, 65, 85);
  const pct = total > 0 ? ((deviatingCount / total) * 100).toFixed(1) : '0';
  let conclusion: string;
  if (total === 0) {
    conclusion = `Tidak ada data pembacaan untuk parameter "${parameter.name}" pada mesin ${machine.name} selama periode ${fmtDate(dateFrom)} - ${fmtDate(dateTo)}.`;
  } else if (deviatingCount === 0) {
    conclusion = `Selama periode ${fmtDate(dateFrom)} - ${fmtDate(dateTo)}, seluruh ${total} pembacaan parameter "${parameter.name}" pada mesin ${machine.name} berada dalam batas normal. Tidak ditemukan penyimpangan.`;
  } else {
    const worst = [...points].sort((a, b) => {
      const rank = (s: string) => (s === 'abnormal' ? 2 : s === 'warning' ? 1 : 0);
      return rank(b.status) - rank(a.status);
    })[0];
    conclusion = `Selama periode ${fmtDate(dateFrom)} - ${fmtDate(dateTo)}, tercatat ${deviatingCount} dari ${total} pembacaan (${pct}%) berada di luar batas normal untuk parameter "${parameter.name}" pada mesin ${machine.name} — terdiri dari ${warningCount} kondisi warning dan ${abnormalCount} abnormal. Penyimpangan paling signifikan tercatat pada ${worst.label} dengan nilai ${worst.value}${parameter.unit ? ' ' + parameter.unit : ''} (status ${worst.status}). Disarankan pengecekan lebih lanjut pada mesin ini.`;
  }
  const lines = doc.splitTextToSize(conclusion, w - m * 2);
  doc.text(lines, m, y);
  y += lines.length * 4 + 6;

  // --- Deviating readings table ---
  const deviating = points.filter(p => p.status !== 'normal');
  if (deviating.length > 0) {
    if (y > h - 40) { doc.addPage(); drawHeader(); y = 27; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(18, 79, 121);
    doc.text('Detail Pembacaan Menyimpang', m, y);
    y += 3;
    autoTable(doc, {
      startY: y,
      head: [['Tanggal', 'Shift', 'Round', 'Nilai', 'Status', 'Catatan']],
      body: deviating.map(p => [fmtDate(p.date), `Shift ${p.shift}`, `R${p.round}`, `${p.value}${parameter.unit ? ' ' + parameter.unit : ''}`, p.status, p.notes || '-']),
      theme: 'grid',
      margin: { left: m, right: m },
      styles: { fontSize: 7, cellPadding: 1.6 },
      headStyles: { fillColor: [18, 79, 121], textColor: 255, fontSize: 7 },
      didParseCell: (c) => {
        if (c.section === 'body' && c.column.index === 4) {
          const status = deviating[c.row.index].status;
          c.cell.styles.textColor = STATUS_COLOR[status];
          c.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(6.5); doc.setTextColor(120, 130, 140);
    doc.text(`Generated ${new Date().toLocaleString('id-ID')} | Page ${i}/${pages}`, w / 2, h - 4, { align: 'center' });
  }

  doc.save(`trend-${machine.code}-${parameter.name.replace(/\s+/g, '_')}-${dateFrom}_${dateTo}.pdf`);
}
