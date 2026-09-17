import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AuditLog } from './types';

const ACTION_LABEL: Record<AuditLog['action'], string> = {
  create: 'Tambah',
  update: 'Ubah',
  delete: 'Hapus',
  login: 'Login',
  login_failed: 'Login Gagal',
  logout: 'Logout',
};

const ACTION_COLOR: Record<AuditLog['action'], [number, number, number]> = {
  create: [5, 150, 105],
  update: [217, 119, 6],
  delete: [220, 38, 38],
  login: [27, 127, 189],
  login_failed: [220, 38, 38],
  logout: [100, 116, 139],
};

const ENTITY_LABELS: Record<string, string> = {
  machines: 'Mesin',
  parameters: 'Parameter',
  schedules: 'Schedule',
  schedule_parameters: 'Schedule Parameter',
  profiles: 'User',
  monitoring_rounds: 'Round Monitoring',
  monitoring_values: 'Nilai Monitoring',
  work_requests: 'Titipan Pekerjaan',
  report_recipients: 'Email Report',
  auth: 'Autentikasi',
};

function pickLabel(row: Record<string, any> | null): string {
  if (!row) return '';
  return row.name || row.title || row.full_name || row.machine_name || row.parameter_name || row.email || row.username || '';
}

function summarize(log: AuditLog): string {
  if (log.action === 'update' && log.old_data && log.new_data) {
    const parts: string[] = [];
    const keys = new Set([...Object.keys(log.old_data), ...Object.keys(log.new_data)]);
    for (const key of keys) {
      if (['created_at', 'updated_at', 'id'].includes(key)) continue;
      const a = log.old_data[key];
      const b = log.new_data[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        parts.push(`${key}: ${String(a ?? '\u2014')} \u2192 ${String(b ?? '\u2014')}`);
      }
    }
    return parts.join('; ') || '\u2014';
  }
  if (log.action === 'login_failed') {
    return `Username: ${log.new_data?.username || '\u2014'}`;
  }
  const label = pickLabel(log.new_data) || pickLabel(log.old_data);
  return label || '\u2014';
}

interface AuditPdfFilters {
  actionFilter: string;
  entityFilter: string;
  dateFrom: string;
  dateTo: string;
}

export function generateAuditPDF(logs: AuditLog[], filters: AuditPdfFilters) {
  const doc = new jsPDF('l', 'mm', 'a4');
  const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight(), m = 8;

  function drawHeader() {
    doc.setFillColor(18, 79, 121); doc.rect(0, 0, w, 18, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('PT. INTERBAT - AUDIT TRAIL LOG', m, 8);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
    const filterParts = [
      filters.actionFilter !== 'all' ? `Aksi: ${ACTION_LABEL[filters.actionFilter as AuditLog['action']] || filters.actionFilter}` : null,
      filters.entityFilter !== 'all' ? `Jenis Data: ${ENTITY_LABELS[filters.entityFilter] || filters.entityFilter}` : null,
      filters.dateFrom ? `Dari: ${filters.dateFrom}` : null,
      filters.dateTo ? `Sampai: ${filters.dateTo}` : null,
    ].filter(Boolean);
    doc.text(filterParts.length ? filterParts.join(' | ') : 'Semua aktivitas', m, 14);
  }

  drawHeader();

  const head = [['Waktu', 'User', 'Aksi', 'Jenis Data', 'Detail Perubahan']];
  const body = logs.map((log) => [
    new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
    log.user_name || 'System',
    ACTION_LABEL[log.action],
    ENTITY_LABELS[log.entity_type] || log.entity_type,
    summarize(log),
  ]);
  const actionCol = logs.map((l) => l.action);

  autoTable(doc, {
    startY: 23,
    head, body,
    theme: 'grid',
    margin: { left: m, right: m, top: 22 },
    styles: { fontSize: 7, cellPadding: 1.6, overflow: 'linebreak' },
    headStyles: { fillColor: [18, 79, 121], textColor: 255, fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 30 }, 1: { cellWidth: 32 }, 2: { cellWidth: 22 }, 3: { cellWidth: 32 },
    },
    didParseCell: (c) => {
      if (c.section === 'body' && c.column.index === 2) {
        const color = ACTION_COLOR[actionCol[c.row.index]];
        if (color) { c.cell.styles.textColor = color; c.cell.styles.fontStyle = 'bold'; }
      }
    },
    didDrawPage: () => {
      if (doc.internal.getCurrentPageInfo().pageNumber > 1) drawHeader();
    },
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(6.5); doc.setTextColor(120, 130, 140);
    doc.text(`Total ${logs.length} aktivitas | Generated ${new Date().toLocaleString('id-ID')} | Page ${i}/${pages}`, w / 2, h - 4, { align: 'center' });
  }

  doc.save(`audit-trail-${new Date().toISOString().split('T')[0]}.pdf`);
}
