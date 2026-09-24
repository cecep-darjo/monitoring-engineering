import { useEffect, useState } from 'react';
import {
  History as HistoryIcon,
  ChevronRight,
  ChevronLeft,
  Search,
  Filter,
  X,
  CheckCircle2,
  Camera,
  Eye,
  Pencil,
  Save,
  Loader2,
} from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import {
  SHIFT_SHORT,
  getStatusColor,
  evaluateValueStatus,
  type MonitoringRound,
  type MonitoringValue,
  type MonitoringPhoto,
  type Machine,
  type Parameter,
} from '@/lib/types';

interface HistoryProps {
  onNavigate?: (page: any) => void;
}

interface RoundDetail extends MonitoringRound {
  values: MonitoringValue[];
  photos: MonitoringPhoto[];
}

export default function History({}: HistoryProps) {
  const [rounds, setRounds] = useState<MonitoringRound[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRound, setSelectedRound] = useState<RoundDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [paramMetaById, setParamMetaById] = useState<Record<string, Parameter>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editGeneralNotes, setEditGeneralNotes] = useState('');
  const [editValues, setEditValues] = useState<Record<string, { value: string; notes: string }>>({});

  // Filters
  const [search, setSearch] = useState('');
  const [machineFilter, setMachineFilter] = useState<string>('all');
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    loadRounds();
    supabase.from('machines').select('*').order('name').then(({ data }) => {
      setMachines(data || []);
    });
  }, []);

  async function loadRounds() {
    setLoading(true);
    let query = supabase
      .from('monitoring_rounds')
      .select('*')
      .order('monitoring_date', { ascending: false })
      .order('shift_number', { ascending: false })
      .order('round_number', { ascending: false })
      .limit(200);

    if (machineFilter !== 'all') query = query.eq('machine_id', machineFilter);
    if (shiftFilter !== 'all') query = query.eq('shift_number', Number(shiftFilter));
    if (dateFrom) query = query.gte('monitoring_date', dateFrom);
    if (dateTo) query = query.lte('monitoring_date', dateTo);

    const { data } = await query;
    let filtered = data || [];
    if (search) {
      const s = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.machine_name.toLowerCase().includes(s) ||
          r.technician_name.toLowerCase().includes(s)
      );
    }
    setRounds(filtered);
    setLoading(false);
  }

  function applyFilters() {
    loadRounds();
    setShowFilters(false);
  }

  function clearFilters() {
    setMachineFilter('all');
    setShiftFilter('all');
    setDateFrom('');
    setDateTo('');
    setSearch('');
  }

  async function viewRound(round: MonitoringRound) {
    setDetailLoading(true);
    setSelectedRound(null);
    setIsEditing(false);
    setEditError(null);

    const [{ data: values }, { data: photos }] = await Promise.all([
      supabase.from('monitoring_values').select('*').eq('round_id', round.id),
      supabase.from('monitoring_photos').select('*').eq('round_id', round.id),
    ]);

    const detail: RoundDetail = {
      ...round,
      values: values || [],
      photos: photos || [],
    };
    setSelectedRound(detail);
    setEditGeneralNotes(detail.notes || '');

    const ids = Array.from(new Set((values || []).map((v: any) => v.parameter_id).filter(Boolean)));
    if (ids.length > 0) {
      const { data: paramData } = await supabase.from('parameters').select('*').in('id', ids);
      const map: Record<string, Parameter> = {};
      for (const p of paramData || []) map[p.id] = p as Parameter;
      setParamMetaById(map);
    } else {
      setParamMetaById({});
    }

    const urls: Record<string, string> = {};
    for (const photo of photos || []) {
      const { data } = await supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(photo.storage_path);
      urls[photo.id] = data.publicUrl;
    }
    setPhotoUrls(urls);
    setDetailLoading(false);
  }

  function startEdit() {
    if (!selectedRound) return;
    if (!isAdmin) {
      setEditError('Hanya admin yang dapat mengubah data monitoring dari History.');
      return;
    }
    const draft: Record<string, { value: string; notes: string }> = {};
    for (const v of selectedRound.values) {
      draft[v.id] = { value: v.value || '', notes: v.notes || '' };
    }
    setEditValues(draft);
    setEditGeneralNotes(selectedRound.notes || '');
    setEditError(null);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setEditError(null);
  }

  async function saveEdit() {
    if (!selectedRound) return;
    if (!isAdmin) {
      setEditError('Hanya admin yang dapat menyimpan perubahan data monitoring.');
      return;
    }

    const normalized = selectedRound.values.map((v) => {
      const draft = editValues[v.id];
      const value = (draft?.value ?? v.value ?? '').trim();
      const notes = (draft?.notes ?? v.notes ?? '').trim();
      const meta = paramMetaById[v.parameter_id];
      const status = meta ? evaluateValueStatus(value, meta) : v.status;
      return { id: v.id, parameterName: v.parameter_name, value, notes, status };
    });

    const incomplete = normalized.find((x) => !x.value);
    if (incomplete) {
      setEditError(`Parameter "${incomplete.parameterName}" belum diisi. Lengkapi nilai sebelum simpan.`);
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      for (const item of normalized) {
        const { error } = await supabase
          .from('monitoring_values')
          .update({ value: item.value, notes: item.notes || null, status: item.status })
          .eq('id', item.id);
        if (error) throw error;
      }

      const nextGeneralNotes = editGeneralNotes.trim() || null;
      const { error: roundError } = await supabase
        .from('monitoring_rounds')
        .update({ notes: nextGeneralNotes, completed_at: new Date().toISOString() })
        .eq('id', selectedRound.id);
      if (roundError) throw roundError;

      const updatedValues = selectedRound.values.map((v) => {
        const draft = editValues[v.id];
        const value = (draft?.value ?? v.value ?? '').trim();
        const notes = (draft?.notes ?? v.notes ?? '').trim();
        const meta = paramMetaById[v.parameter_id];
        const status = meta ? evaluateValueStatus(value, meta) : v.status;
        return { ...v, value, notes: notes || null, status };
      });

      setSelectedRound({ ...selectedRound, values: updatedValues, notes: nextGeneralNotes });
      setRounds((prev) => prev.map((r) => (r.id === selectedRound.id ? { ...r, notes: nextGeneralNotes } : r)));
      setIsEditing(false);
    } catch (err: any) {
      setEditError(err?.message || 'Gagal menyimpan perubahan monitoring.');
    } finally {
      setEditSaving(false);
    }
  }

  const hasActiveFilters =
    machineFilter !== 'all' || shiftFilter !== 'all' || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Monitoring History</h1>
        <p className="text-slate-500 text-sm mt-1">Browse and review past monitoring rounds</p>
      </div>

      {/* Search & Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            placeholder="Search by machine or technician..."
            className="input-field pl-10"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary ${hasActiveFilters ? 'border-teal-400 text-teal-600' : ''}`}
        >
          <Filter className="w-4 h-4" />
          Filters
        </button>
      </div>

      {showFilters && (
        <div className="card p-5 space-y-4 animate-slide-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label-text">Machine</label>
              <select
                value={machineFilter}
                onChange={(e) => setMachineFilter(e.target.value)}
                className="input-field"
              >
                <option value="all">All Machines</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-text">Shift</label>
              <select
                value={shiftFilter}
                onChange={(e) => setShiftFilter(e.target.value)}
                className="input-field"
              >
                <option value="all">All Shifts</option>
                <option value="1">Shift 1</option>
                <option value="2">Shift 2</option>
                <option value="3">Shift 3</option>
              </select>
            </div>
            <div>
              <label className="label-text">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="input-field"
              />
            </div>
            <div>
              <label className="label-text">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="input-field"
              />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={clearFilters} className="btn-ghost text-sm">
              <X className="w-4 h-4" />
              Clear
            </button>
            <button onClick={applyFilters} className="btn-primary text-sm">
              Apply Filters
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rounds.length === 0 ? (
        <div className="card p-12 text-center">
          <HistoryIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No monitoring rounds found.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {rounds.map((round) => (
            <button
              key={round.id}
              onClick={() => viewRound(round)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-teal-600" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 text-sm truncate">
                    {round.machine_name}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(round.monitoring_date).toLocaleDateString('en-US', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })} · {SHIFT_SHORT[round.shift_number]} · Round {round.round_number}
                  </p>
                  <p className="text-xs text-slate-400">By {round.technician_name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Eye className="w-4 h-4 text-slate-300 group-hover:text-teal-500 transition-colors" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedRound && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setSelectedRound(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">{selectedRound.machine_name}</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {new Date(selectedRound.monitoring_date).toLocaleDateString('en-US', {
                    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
                  })} · {SHIFT_SHORT[selectedRound.shift_number]} · Round {selectedRound.round_number}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {isAdmin && (!isEditing ? (
                  <button onClick={startEdit} className="btn-secondary text-xs px-3 py-1.5">
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                ) : (
                  <>
                    <button onClick={cancelEdit} disabled={editSaving} className="btn-ghost text-xs px-3 py-1.5">
                      Batal
                    </button>
                    <button onClick={saveEdit} disabled={editSaving} className="btn-primary text-xs px-3 py-1.5">
                      {editSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Simpan
                    </button>
                  </>
                ))}
                <button onClick={() => setSelectedRound(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>Technician:</span>
                <span className="font-medium text-slate-700">{selectedRound.technician_name}</span>
              </div>

              {!isAdmin && (
                <div className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                  Mode baca saja. Perubahan data monitoring dari History hanya untuk level admin.
                </div>
              )}

              {/* Values */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Parameter Readings</h3>
                {selectedRound.values.length === 0 ? (
                  <p className="text-sm text-slate-400">No values recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedRound.values.map((v) => {
                      const draft = editValues[v.id] || { value: v.value || '', notes: v.notes || '' };
                      const displayStatus = isEditing
                        ? (paramMetaById[v.parameter_id] ? evaluateValueStatus(draft.value, paramMetaById[v.parameter_id]) : v.status)
                        : v.status;
                      return (
                        <div key={v.id} className="p-3 rounded-lg bg-slate-50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-900">{v.parameter_name}</p>
                              {isEditing ? (
                                <div className="mt-1.5 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={draft.value}
                                      onChange={(e) => setEditValues((prev) => ({
                                        ...prev,
                                        [v.id]: { ...(prev[v.id] || { value: v.value || '', notes: v.notes || '' }), value: e.target.value },
                                      }))}
                                      className="input-field text-sm"
                                      placeholder="Masukkan nilai"
                                    />
                                    {v.unit && <span className="text-xs text-slate-400 whitespace-nowrap">{v.unit}</span>}
                                  </div>
                                  <input
                                    type="text"
                                    value={draft.notes}
                                    onChange={(e) => setEditValues((prev) => ({
                                      ...prev,
                                      [v.id]: { ...(prev[v.id] || { value: v.value || '', notes: v.notes || '' }), notes: e.target.value },
                                    }))}
                                    className="input-field text-xs"
                                    placeholder="Catatan parameter (opsional)"
                                  />
                                </div>
                              ) : (
                                <>
                                  <p className="text-sm text-slate-600 mt-0.5">
                                    {v.value || '—'} {v.unit && <span className="text-slate-400">{v.unit}</span>}
                                  </p>
                                  {v.notes && (
                                    <p className="text-xs text-slate-400 mt-1">{v.notes}</p>
                                  )}
                                </>
                              )}
                            </div>
                            <span className={`badge ${getStatusColor(displayStatus)} flex-shrink-0`}>
                              {displayStatus}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Photos */}
              {selectedRound.photos.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Camera className="w-4 h-4" />
                    Photos ({selectedRound.photos.length})
                  </h3>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {selectedRound.photos.map((photo) => (
                      <a
                        key={photo.id}
                        href={photoUrls[photo.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden border border-slate-200 hover:border-teal-400 transition-colors group"
                      >
                        {photoUrls[photo.id] ? (
                          <img
                            src={photoUrls[photo.id]}
                            alt={photo.file_name || 'Monitoring photo'}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                            <Camera className="w-5 h-5 text-slate-300" />
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* General Notes */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">General Notes</h3>
                {isEditing ? (
                  <textarea
                    rows={3}
                    value={editGeneralNotes}
                    onChange={(e) => setEditGeneralNotes(e.target.value)}
                    className="input-field resize-none text-sm"
                    placeholder="Catatan umum (opsional)"
                  />
                ) : selectedRound.notes ? (
                  <p className="text-sm text-slate-600 p-3 rounded-lg bg-slate-50">
                    {selectedRound.notes}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400">Tidak ada catatan umum.</p>
                )}
              </div>

              {editError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {editError}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
