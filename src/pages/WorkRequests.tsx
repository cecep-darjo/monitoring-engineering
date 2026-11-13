import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar, Camera, CheckCircle2, ChevronDown, ChevronUp, ClipboardList, Edit2,
  Clock3, Loader2, Plus, Trash2, User, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { photoUrl, removePhoto, uploadPhoto } from '@/lib/storage';
import { useAuth } from '@/lib/AuthContext';
import type { WorkRequest, WorkRequestPhoto } from '@/lib/types';

interface WorkRequestWithPhotos extends WorkRequest {
  photos: (WorkRequestPhoto & { url: string })[];
}

type WorkFilter = 'all' | 'in_progress' | 'upcoming' | 'completed';
type SortOrder = 'newest' | 'oldest';

const MAX_PHOTO_BYTES = 500 * 1024;
const SHIFT_START_HOURS: Record<number, Record<number, number>> = {
  1: { 1: 7, 2: 11 },
  2: { 1: 15, 2: 19 },
  3: { 1: 23, 2: 3 },
};

function localDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function scheduleDateTime(item: Pick<WorkRequest, 'scheduled_date' | 'shift_number' | 'round_number'>): Date | null {
  if (!item.scheduled_date || !item.shift_number || !item.round_number) return null;
  const hour = SHIFT_START_HOURS[item.shift_number]?.[item.round_number];
  if (hour === undefined) return null;
  const [year, month, day] = item.scheduled_date.split('-').map(Number);
  const date = new Date(year, month - 1, day, hour);
  if (item.shift_number === 3 && item.round_number === 2) date.setDate(date.getDate() + 1);
  return date;
}

function formatDate(value: string | null) {
  if (!value) return 'Jadwal lama';
  return new Date(`${value}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' });
}

function localDateKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function effectiveStatus(item: WorkRequest, now = new Date()): WorkRequest['status'] {
  const scheduledAt = scheduleDateTime(item);
  if (item.status === 'pending' && scheduledAt && scheduledAt.getTime() <= now.getTime()) return 'in_progress';
  return item.status;
}

export default function WorkRequests() {
  const { profile } = useAuth();
  const [items, setItems] = useState<WorkRequestWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [completionId, setCompletionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [scheduledDate, setScheduledDate] = useState(localDateInputValue);
  const [shiftNumber, setShiftNumber] = useState(1);
  const [roundNumber, setRoundNumber] = useState(1);
  const [workDetail, setWorkDetail] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [editTitle, setEditTitle] = useState('');
  const [editRequestedBy, setEditRequestedBy] = useState('');
  const [editScheduledDate, setEditScheduledDate] = useState('');
  const [editShiftNumber, setEditShiftNumber] = useState(1);
  const [editRoundNumber, setEditRoundNumber] = useState(1);
  const [filter, setFilter] = useState<WorkFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [completedFrom, setCompletedFrom] = useState('');
  const [completedTo, setCompletedTo] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const interval = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  async function load() {
    setLoading(true);
    const { data: requests, error: requestError } = await supabase
      .from('work_requests').select('*').order('created_at', { ascending: false });
    if (requestError) {
      setActionError(requestError.message);
      setItems([]);
      setLoading(false);
      return;
    }
    const ids = (requests || []).map((request) => request.id);
    const { data: photoData, error: photosError } = ids.length
      ? await supabase.from('work_request_photos').select('*').in('work_request_id', ids)
      : { data: [] as WorkRequestPhoto[], error: null };
    if (photosError) setActionError(photosError.message);

    const photosByRequest = new Map<string, (WorkRequestPhoto & { url: string })[]>();
    for (const photo of photoData || []) {
      const url = photoUrl(photo.storage_path);
      if (!photosByRequest.has(photo.work_request_id)) photosByRequest.set(photo.work_request_id, []);
      photosByRequest.get(photo.work_request_id)!.push({ ...photo, url });
    }
    setItems((requests || []).map((request) => ({ ...request, photos: photosByRequest.get(request.id) || [] })));
    setLoading(false);
  }

  function resetCreateForm() {
    setTitle('');
    setRequestedBy('');
    setScheduledDate(localDateInputValue());
    setShiftNumber(1);
    setRoundNumber(1);
    setShowForm(false);
    setError(null);
  }

  async function handleCreate() {
    if (!profile) return;
    if (!title.trim() || !requestedBy.trim() || !scheduledDate) {
      setError('Judul, peminta, tanggal, shift, dan round wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('work_requests').insert({
      technician_id: profile.id,
      technician_name: profile.full_name,
      title: title.trim(),
      requested_by: requestedBy.trim(),
      description: null,
      scheduled_date: scheduledDate,
      shift_number: shiftNumber,
      round_number: roundNumber,
      status: 'pending',
      completed_at: null,
    });
    if (insertError) setError(insertError.message);
    else {
      resetCreateForm();
      setFilter('upcoming');
      await load();
    }
    setSaving(false);
  }

  function handleEvidenceSelect(fileList: FileList | null) {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const oversized = incoming.filter((file) => file.size > MAX_PHOTO_BYTES);
    if (oversized.length) {
      setActionError(`Foto bukti maksimal 500KB per file: ${oversized.map((file) => file.name).join(', ')}`);
    } else {
      setActionError(null);
    }
    setEvidenceFiles((current) => [...current, ...incoming.filter((file) => file.size <= MAX_PHOTO_BYTES)]);
  }

  async function startWork(item: WorkRequestWithPhotos) {
    setBusyId(item.id);
    setActionError(null);
    const { error: updateError } = await supabase.from('work_requests').update({ status: 'in_progress' }).eq('id', item.id);
    if (updateError) setActionError(updateError.message);
    else {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: 'in_progress' } : entry));
      setExpandedId(item.id);
      setCompletionId(item.id);
      setWorkDetail('');
      setEvidenceFiles([]);
    }
    setBusyId(null);
  }

  function beginEdit(item: WorkRequestWithPhotos) {
    setExpandedId(item.id);
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditRequestedBy(item.requested_by);
    setEditScheduledDate(item.scheduled_date || localDateInputValue());
    setEditShiftNumber(item.shift_number || 1);
    setEditRoundNumber(item.round_number || 1);
    setActionError(null);
  }

  async function saveEdit(item: WorkRequestWithPhotos) {
    if (!editTitle.trim() || !editRequestedBy.trim() || !editScheduledDate) {
      setActionError('Judul, peminta, tanggal, shift, dan round wajib diisi.');
      return;
    }
    setBusyId(item.id);
    setActionError(null);
    const { error: updateError } = await supabase.from('work_requests').update({
      title: editTitle.trim(),
      requested_by: editRequestedBy.trim(),
      scheduled_date: editScheduledDate,
      shift_number: editShiftNumber,
      round_number: editRoundNumber,
    }).eq('id', item.id);
    if (updateError) setActionError(updateError.message);
    else {
      setEditingId(null);
      await load();
    }
    setBusyId(null);
  }

  async function completeWork(item: WorkRequestWithPhotos) {
    if (!workDetail.trim()) {
      setActionError('Detail pekerjaan yang sudah dikerjakan wajib diisi.');
      return;
    }
    if (!evidenceFiles.length) {
      setActionError('Tambahkan minimal satu foto bukti sebelum menyelesaikan titipan.');
      return;
    }
    setBusyId(item.id);
    setActionError(null);
    const uploadedPaths: string[] = [];
    const insertedPhotoIds: string[] = [];
    try {
      for (const file of evidenceFiles) {
        const ext = file.name.split('.').pop() || 'jpg';
        const path = `work-requests/${item.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadError } = await uploadPhoto(path, file);
        if (uploadError) throw new Error(uploadError);
        uploadedPaths.push(path);
        const { data: photoRow, error: photoError } = await supabase.from('work_request_photos').insert({
          work_request_id: item.id,
          storage_path: path,
          file_name: file.name,
        }).select('id').single();
        if (photoError) throw photoError;
        if (photoRow?.id) insertedPhotoIds.push(photoRow.id);
      }

      const { error: updateError } = await supabase.from('work_requests').update({
        description: workDetail.trim(),
        status: 'completed',
        completed_at: new Date().toISOString(),
      }).eq('id', item.id);
      if (updateError) throw updateError;
      setCompletionId(null);
      setWorkDetail('');
      setEvidenceFiles([]);
      setFilter('completed');
      await load();
    } catch (err) {
      if (insertedPhotoIds.length) await supabase.from('work_request_photos').delete().in('id', insertedPhotoIds);
      await removePhoto(uploadedPaths);
      setActionError(err instanceof Error ? err.message : 'Gagal menyelesaikan titipan pekerjaan.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(item: WorkRequestWithPhotos) {
    if (!window.confirm(`Hapus titipan pekerjaan "${item.title}"?`)) return;
    setBusyId(item.id);
    setActionError(null);
    try {
      for (const photo of item.photos) {
        const { error: photoError } = await removePhoto([photo.storage_path]);
        if (photoError) throw new Error(photoError);
      }
      const { error: deleteError } = await supabase.from('work_requests').delete().eq('id', item.id);
      if (deleteError) throw deleteError;
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menghapus titipan pekerjaan.');
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({
    in_progress: items.filter((item) => effectiveStatus(item, currentTime) === 'in_progress').length,
    upcoming: items.filter((item) => effectiveStatus(item, currentTime) === 'pending').length,
    completed: items.filter((item) => item.status === 'completed').length,
  }), [items, currentTime]);

  const filteredItems = useMemo(() => {
    const rows = items.filter((item) => {
      const status = effectiveStatus(item, currentTime);
      if (filter === 'in_progress' && status !== 'in_progress') return false;
      if (filter === 'upcoming' && status !== 'pending') return false;
      if (filter === 'completed' && item.status !== 'completed') return false;
      if (filter === 'completed' && (completedFrom || completedTo)) {
        const completedDate = localDateKey(item.completed_at || item.created_at);
        if (completedFrom && completedDate < completedFrom) return false;
        if (completedTo && completedDate > completedTo) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      const aDate = filter === 'completed'
        ? new Date(a.completed_at || a.created_at).getTime()
        : (scheduleDateTime(a)?.getTime() ?? new Date(a.created_at).getTime());
      const bDate = filter === 'completed'
        ? new Date(b.completed_at || b.created_at).getTime()
        : (scheduleDateTime(b)?.getTime() ?? new Date(b.created_at).getTime());
      return sortOrder === 'newest' ? bDate - aDate : aDate - bDate;
    });
  }, [items, filter, completedFrom, completedTo, sortOrder, currentTime]);

  const canManage = (item: WorkRequest) => profile && (profile.role === 'admin' || profile.id === item.technician_id);

  const filterCards: { key: WorkFilter; title: string; count: number; color: string }[] = [
    { key: 'in_progress', title: 'Sedang berjalan', count: counts.in_progress, color: 'text-blue-600' },
    { key: 'upcoming', title: 'Akan datang', count: counts.upcoming, color: 'text-amber-600' },
    { key: 'completed', title: 'Selesai', count: counts.completed, color: 'text-emerald-600' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Titipan Pekerjaan</h1>
          <p className="mt-1 text-sm text-slate-500">Jadwalkan pekerjaan berdasarkan tanggal, shift, dan round. Lengkapi detail serta foto bukti saat selesai.</p>
        </div>
        <button onClick={() => setShowForm((value) => !value)} className="btn-primary">
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? 'Batal' : 'Tambah Titipan'}
        </button>
      </div>

      {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>}

      {showForm && (
        <div className="card space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label-text">Judul Pekerjaan</label>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="input-field" placeholder="mis. Perbaikan kebocoran pipa" />
            </div>
            <div>
              <label className="label-text">Titipan dari</label>
              <input value={requestedBy} onChange={(event) => setRequestedBy(event.target.value)} className="input-field" placeholder="Nama peminta pekerjaan" />
            </div>
            <div>
              <label className="label-text">Tanggal</label>
              <input type="date" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} className="input-field" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label-text">Shift</label>
                <select value={shiftNumber} onChange={(event) => setShiftNumber(Number(event.target.value))} className="input-field">
                  <option value={1}>Shift 1 (07-15)</option><option value={2}>Shift 2 (15-23)</option><option value={3}>Shift 3 (23-07)</option>
                </select>
              </div>
              <div>
                <label className="label-text">Round</label>
                <select value={roundNumber} onChange={(event) => setRoundNumber(Number(event.target.value))} className="input-field">
                  <option value={1}>Round 1</option><option value={2}>Round 2</option>
                </select>
              </div>
            </div>
          </div>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <button onClick={resetCreateForm} className="btn-ghost border border-slate-200">Batal</button>
            <button onClick={() => void handleCreate()} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Simpan Jadwal
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {filterCards.map((card) => (
          <button key={card.key} onClick={() => setFilter(filter === card.key ? 'all' : card.key)} className={`card rounded-xl border p-4 text-left transition-colors ${filter === card.key ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200 hover:border-slate-300'}`}>
            <p className="text-xs text-slate-500">{card.title}</p>
            <p className={`mt-1 text-2xl font-bold ${card.color}`}>{card.count}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label-text">Sortir</label>
            <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)} className="input-field min-w-40">
              <option value="newest">Terbaru dulu</option><option value="oldest">Terlama dulu</option>
            </select>
          </div>
          {filter === 'completed' && (
            <>
              <div><label className="label-text">Selesai dari</label><input type="date" value={completedFrom} onChange={(event) => setCompletedFrom(event.target.value)} className="input-field" /></div>
              <div><label className="label-text">Sampai</label><input type="date" value={completedTo} onChange={(event) => setCompletedTo(event.target.value)} className="input-field" /></div>
              {(completedFrom || completedTo) && <button onClick={() => { setCompletedFrom(''); setCompletedTo(''); }} className="btn-ghost border border-slate-200">Reset tanggal</button>}
            </>
          )}
        </div>
        <p className="text-xs text-slate-400">Menampilkan {filteredItems.length} dari {items.length} titipan</p>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" /></div>
      ) : filteredItems.length === 0 ? (
        <div className="card p-12 text-center"><ClipboardList className="mx-auto mb-3 h-12 w-12 text-slate-300" /><p className="text-sm text-slate-500">Tidak ada titipan pada filter ini.</p></div>
      ) : (
        <div className="space-y-3">
          {filteredItems.map((item) => {
            const isExpanded = expandedId === item.id;
            const isCompleting = completionId === item.id;
            const scheduledAt = scheduleDateTime(item);
            const displayStatus = effectiveStatus(item, currentTime);
            const statusLabel = displayStatus === 'completed' ? 'Selesai' : displayStatus === 'in_progress' ? 'Sedang berjalan' : 'Akan datang';
            const statusClass = displayStatus === 'completed' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : displayStatus === 'in_progress' ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-amber-200 bg-amber-50 text-amber-700';
            return (
              <div key={item.id} className="card overflow-hidden">
                <div className="space-y-3 p-4">
                  <button onClick={() => setExpandedId(isExpanded ? null : item.id)} className="flex w-full min-w-0 items-start justify-between gap-3 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-semibold leading-5 text-slate-900">{item.title}</p><span className={`badge ${statusClass} shrink-0`}>{statusLabel}</span></div>
                      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm leading-5 text-slate-600 sm:grid-cols-2">
                        <span className="inline-flex min-w-0 items-start gap-1.5"><User className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="break-words">Peminta: {item.requested_by}</span></span>
                        <span className="inline-flex min-w-0 items-start gap-1.5"><Calendar className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{formatDate(item.scheduled_date)} · Shift {item.shift_number ?? '-'} · Round {item.round_number ?? '-'}</span></span>
                        <span className="break-words">Teknisi: {item.technician_name}</span>
                        {item.status === 'completed' && <span className="break-words">Selesai: {new Date(item.completed_at || item.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-slate-400" />}
                  </button>
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    {item.status === 'pending' && displayStatus === 'pending' && <button onClick={() => void startWork(item)} disabled={busyId === item.id} className="btn-primary px-3 py-2 text-xs">{busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock3 className="h-3.5 w-3.5" />} Mulai</button>}
                    {item.status === 'in_progress' && <button onClick={() => { setExpandedId(item.id); setCompletionId(isCompleting ? null : item.id); if (!isCompleting) { setWorkDetail(item.description || ''); setEvidenceFiles([]); } setActionError(null); }} className="btn-primary px-3 py-2 text-xs"><CheckCircle2 className="h-3.5 w-3.5" /> Selesaikan</button>}
                    {item.status === 'pending' && displayStatus === 'in_progress' && <button onClick={() => void startWork(item)} disabled={busyId === item.id} className="btn-primary px-3 py-2 text-xs">{busyId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Lengkapi</button>}
                    <button onClick={() => editingId === item.id ? setEditingId(null) : beginEdit(item)} className="btn-ghost border border-slate-200 px-3 py-2 text-xs" title="Edit titipan"><Edit2 className="h-3.5 w-3.5" /> Edit</button>
                    {profile?.role === 'admin' && <button onClick={() => void handleDelete(item)} disabled={busyId === item.id} title="Hapus titipan" aria-label="Hapus titipan" className="btn-ghost border border-red-200 px-3 py-2 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" /> Hapus</button>}
                  </div>
                </div>
                {isExpanded && (
                  <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-3">
                    <div className="flex flex-wrap gap-4 text-xs text-slate-500"><span>Dibuat: {new Date(item.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>{scheduledAt && <span>Waktu mulai jadwal: {scheduledAt.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>}</div>
                    {editingId === item.id && (
                      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div><label className="label-text">Judul Pekerjaan</label><input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="input-field" /></div>
                          <div><label className="label-text">Titipan dari</label><input value={editRequestedBy} onChange={(event) => setEditRequestedBy(event.target.value)} className="input-field" /></div>
                          <div><label className="label-text">Tanggal</label><input type="date" value={editScheduledDate} onChange={(event) => setEditScheduledDate(event.target.value)} className="input-field" /></div>
                          <div className="grid grid-cols-2 gap-3">
                            <div><label className="label-text">Shift</label><select value={editShiftNumber} onChange={(event) => setEditShiftNumber(Number(event.target.value))} className="input-field"><option value={1}>Shift 1</option><option value={2}>Shift 2</option><option value={3}>Shift 3</option></select></div>
                            <div><label className="label-text">Round</label><select value={editRoundNumber} onChange={(event) => setEditRoundNumber(Number(event.target.value))} className="input-field"><option value={1}>Round 1</option><option value={2}>Round 2</option></select></div>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2"><button onClick={() => setEditingId(null)} className="btn-ghost border border-slate-200">Batal</button><button onClick={() => void saveEdit(item)} disabled={busyId === item.id} className="btn-primary">{busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Simpan Perubahan</button></div>
                      </div>
                    )}
                    {item.description ? <div><h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Detail pekerjaan</h3><p className="whitespace-pre-wrap text-sm text-slate-700">{item.description}</p></div> : <p className="text-sm italic text-slate-400">Detail pekerjaan diisi saat titipan diselesaikan.</p>}
                    {item.photos.length > 0 && <div><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Foto bukti</h3><div className="flex flex-wrap gap-2">{item.photos.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><img src={photo.url} alt={photo.file_name || ''} className="h-24 w-24 rounded-lg border border-slate-200 object-cover hover:opacity-80" /></a>)}</div></div>}
                    {isCompleting && item.status === 'in_progress' && (
                      <div className="space-y-3 rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                        <div><label className="label-text">Detail pekerjaan yang sudah dikerjakan</label><textarea value={workDetail} onChange={(event) => setWorkDetail(event.target.value)} className="input-field min-h-24" placeholder="Jelaskan pekerjaan, hasil, dan catatan..." /></div>
                        <div>
                          <label className="label-text">Foto bukti (wajib, maks. 500KB per foto)</label>
                          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={(event) => handleEvidenceSelect(event.target.files)} className="hidden" />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {evidenceFiles.map((file, index) => <span key={`${file.name}-${index}`} className="rounded-md bg-white px-2 py-1 text-xs text-slate-600">{file.name}<button onClick={() => setEvidenceFiles((current) => current.filter((_, i) => i !== index))} className="ml-2 text-red-500" aria-label={`Hapus ${file.name}`}><X className="inline h-3 w-3" /></button></span>)}
                            <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 text-sm font-medium text-teal-700"><Camera className="h-4 w-4" />Tambah foto</button>
                          </div>
                        </div>
                        <div className="flex justify-end"><button onClick={() => void completeWork(item)} disabled={busyId === item.id} className="btn-primary">{busyId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Simpan & Selesaikan</button></div>
                      </div>
                    )}
                    {canManage(item) && profile?.role !== 'admin' && <div className="flex justify-end"><button onClick={() => void handleDelete(item)} disabled={busyId === item.id} className="btn-ghost border border-red-200 px-2.5 text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" />Hapus</button></div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
