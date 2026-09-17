import { useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  Filter,
  ChevronDown,
  ChevronUp,
  LogIn,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  ShieldAlert,
  Loader2,
  FileDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { AuditLog } from '@/lib/types';
import { generateAuditPDF } from '@/lib/auditPdfReport';

const ACTION_META: Record<AuditLog['action'], { label: string; color: string; icon: typeof Plus }> = {
  create: { label: 'Tambah', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Plus },
  update: { label: 'Ubah', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: Pencil },
  delete: { label: 'Hapus', color: 'bg-red-50 text-red-700 border-red-200', icon: Trash2 },
  login: { label: 'Login', color: 'bg-teal-50 text-teal-700 border-teal-200', icon: LogIn },
  login_failed: { label: 'Login Gagal', color: 'bg-red-50 text-red-700 border-red-200', icon: ShieldAlert },
  logout: { label: 'Logout', color: 'bg-slate-100 text-slate-600 border-slate-200', icon: LogOut },
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

const PAGE_SIZE = 30;

export default function AuditTrail() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');

  const [actionFilter, setActionFilter] = useState<string>('all');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    setPage(0);
    load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, entityFilter, dateFrom, dateTo]);

  async function load(pageNum: number, replace: boolean) {
    setLoading(true);
    let query = supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .range(pageNum * PAGE_SIZE, pageNum * PAGE_SIZE + PAGE_SIZE - 1);

    if (actionFilter !== 'all') query = query.eq('action', actionFilter);
    if (entityFilter !== 'all') query = query.eq('entity_type', entityFilter);
    if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00+07:00`);
    if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59+07:00`);

    const { data } = await query;
    const rows = (data || []) as AuditLog[];
    setLogs((prev) => (replace ? rows : [...prev, ...rows]));
    setHasMore(rows.length === PAGE_SIZE);
    setLoading(false);
  }

  function loadMore() {
    const next = page + 1;
    setPage(next);
    load(next, false);
  }

  const EXPORT_CAP = 2000;

  function todayStr() {
    return new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD, local date
  }

  function openExportModal() {
    setExportFrom(dateFrom || todayStr());
    setExportTo(dateTo || todayStr());
    setShowExportModal(true);
  }

  function applyExportPreset(preset: 'today' | 'week' | 'month' | 'lastMonth') {
    const now = new Date();
    if (preset === 'today') {
      const d = todayStr();
      setExportFrom(d); setExportTo(d);
    } else if (preset === 'week') {
      const from = new Date(now); from.setDate(now.getDate() - 6);
      setExportFrom(from.toLocaleDateString('sv-SE')); setExportTo(todayStr());
    } else if (preset === 'month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setExportFrom(from.toLocaleDateString('sv-SE')); setExportTo(todayStr());
    } else if (preset === 'lastMonth') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      setExportFrom(from.toLocaleDateString('sv-SE')); setExportTo(to.toLocaleDateString('sv-SE'));
    }
  }

  async function handleExportPDF() {
    if (!exportFrom || !exportTo) {
      alert('Pilih tanggal mulai dan akhir terlebih dahulu.');
      return;
    }
    if (exportFrom > exportTo) {
      alert('Tanggal mulai tidak boleh setelah tanggal akhir.');
      return;
    }
    setExporting(true);
    try {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .gte('created_at', `${exportFrom}T00:00:00+07:00`)
        .lte('created_at', `${exportTo}T23:59:59+07:00`)
        .limit(EXPORT_CAP);

      if (actionFilter !== 'all') query = query.eq('action', actionFilter);
      if (entityFilter !== 'all') query = query.eq('entity_type', entityFilter);

      const { data, error } = await query;
      if (error) throw error;

      if (!data || data.length === 0) {
        alert('Tidak ada aktivitas untuk periode & filter ini.');
        setExporting(false);
        return;
      }
      if (data.length === EXPORT_CAP) {
        alert(`Data dibatasi ${EXPORT_CAP} baris terbaru untuk export ini. Persempit periode untuk export lebih lengkap.`);
      }
      generateAuditPDF(data as AuditLog[], { actionFilter, entityFilter, dateFrom: exportFrom, dateTo: exportTo });
      setShowExportModal(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal export PDF';
      alert(msg);
    }
    setExporting(false);
  }

  function changedFields(log: AuditLog): { field: string; from: any; to: any }[] {
    if (log.action !== 'update' || !log.old_data || !log.new_data) return [];
    const fields: { field: string; from: any; to: any }[] = [];
    const keys = new Set([...Object.keys(log.old_data), ...Object.keys(log.new_data)]);
    for (const key of keys) {
      if (['created_at', 'updated_at'].includes(key)) continue;
      const a = log.old_data[key];
      const b = log.new_data[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) fields.push({ field: key, from: a, to: b });
    }
    return fields;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Trail</h1>
          <p className="text-slate-500 text-sm mt-1">Riwayat seluruh aktivitas di sistem: login, dan perubahan data.</p>
        </div>
        <button onClick={openExportModal} className="btn-primary">
          <FileDown className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-slate-700">
          <Filter className="w-4 h-4" /> Filter
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input-field">
            <option value="all">Semua Aksi</option>
            {Object.entries(ACTION_META).map(([key, meta]) => (
              <option key={key} value={key}>{meta.label}</option>
            ))}
          </select>
          <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value)} className="input-field">
            <option value="all">Semua Jenis Data</option>
            {Object.entries(ENTITY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
        </div>
      </div>

      {loading && logs.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="card p-12 text-center">
          <HistoryIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Belum ada aktivitas tercatat untuk filter ini.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((log) => {
            const meta = ACTION_META[log.action];
            const Icon = meta.icon;
            const label = pickLabel(log.new_data) || pickLabel(log.old_data);
            const isExpanded = expandedId === log.id;
            const diffs = changedFields(log);
            const canExpand = log.action === 'update' ? diffs.length > 0 : !!(log.old_data || log.new_data);

            return (
              <div key={log.id} className="card overflow-hidden">
                <button
                  onClick={() => canExpand && setExpandedId(isExpanded ? null : log.id)}
                  className={`w-full flex items-center justify-between p-3.5 text-left ${canExpand ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'} transition-colors`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`badge border ${meta.color} flex-shrink-0`}>
                      <Icon className="w-3 h-3" />
                      {meta.label}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-slate-800 truncate">
                        <span className="font-medium">{log.user_name || 'System'}</span>
                        {' '}
                        {meta.label.toLowerCase()} {ENTITY_LABELS[log.entity_type] || log.entity_type}
                        {label && <span className="text-slate-500"> &mdash; {label}</span>}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(log.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </div>
                  </div>
                  {canExpand && (isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />)}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3">
                    {log.action === 'update' ? (
                      <div className="space-y-1.5">
                        {diffs.map((d) => (
                          <div key={d.field} className="text-xs grid grid-cols-[120px_1fr] gap-2">
                            <span className="text-slate-400 font-medium">{d.field}</span>
                            <span className="text-slate-600">
                              <span className="line-through text-red-400">{String(d.from ?? '\u2014')}</span>
                              {' '}&rarr;{' '}
                              <span className="text-emerald-600 font-medium">{String(d.to ?? '\u2014')}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 overflow-x-auto">
                        {JSON.stringify(log.new_data || log.old_data, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && (
            <div className="flex justify-center pt-2">
              <button onClick={loadMore} disabled={loading} className="btn-ghost border border-slate-200 text-sm">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Muat lebih banyak
              </button>
            </div>
          )}
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50" onClick={() => setShowExportModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900 mb-1">Export Audit Trail PDF</h2>
            <p className="text-xs text-slate-500 mb-4">Pilih periode yang ingin di-export. Filter Aksi &amp; Jenis Data di halaman ini tetap berlaku.</p>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => applyExportPreset('today')} className="text-xs py-2 rounded-lg border border-slate-200 hover:border-teal-400 hover:text-teal-600 transition-colors">Hari Ini</button>
              <button onClick={() => applyExportPreset('week')} className="text-xs py-2 rounded-lg border border-slate-200 hover:border-teal-400 hover:text-teal-600 transition-colors">7 Hari Terakhir</button>
              <button onClick={() => applyExportPreset('month')} className="text-xs py-2 rounded-lg border border-slate-200 hover:border-teal-400 hover:text-teal-600 transition-colors">Bulan Ini</button>
              <button onClick={() => applyExportPreset('lastMonth')} className="text-xs py-2 rounded-lg border border-slate-200 hover:border-teal-400 hover:text-teal-600 transition-colors">Bulan Lalu</button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="label-text">Dari Tanggal</label>
                <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="input-field" />
              </div>
              <div>
                <label className="label-text">Sampai Tanggal</label>
                <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="input-field" />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowExportModal(false)} className="btn-ghost border border-slate-200">Batal</button>
              <button onClick={handleExportPDF} disabled={exporting} className="btn-primary">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
