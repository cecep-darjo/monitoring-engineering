import { useEffect, useRef, useState } from 'react';
import { ClipboardList, Plus, X, Camera, Loader2, User, Calendar, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import type { WorkRequest, WorkRequestPhoto } from '@/lib/types';

interface WorkRequestWithPhotos extends WorkRequest {
  photos: (WorkRequestPhoto & { url: string })[];
}

export default function WorkRequests() {
  const { profile } = useAuth();
  const [items, setItems] = useState<WorkRequestWithPhotos[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data: requests } = await supabase
      .from('work_requests')
      .select('*')
      .order('created_at', { ascending: false });

    const ids = (requests || []).map((r) => r.id);
    const { data: photoData } = ids.length
      ? await supabase.from('work_request_photos').select('*').in('work_request_id', ids)
      : { data: [] as WorkRequestPhoto[] };

    const photosByRequest = new Map<string, (WorkRequestPhoto & { url: string })[]>();
    for (const photo of photoData || []) {
      const url = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl;
      if (!photosByRequest.has(photo.work_request_id)) photosByRequest.set(photo.work_request_id, []);
      photosByRequest.get(photo.work_request_id)!.push({ ...photo, url });
    }

    setItems((requests || []).map((r) => ({ ...r, photos: photosByRequest.get(r.id) || [] })));
    setLoading(false);
  }

  function resetForm() {
    setTitle('');
    setRequestedBy('');
    setDescription('');
    setPhotos([]);
    setShowForm(false);
    setError(null);
  }

  const MAX_PHOTO_BYTES = 500 * 1024;

  function handleFileSelect(files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files);
    const tooLarge = incoming.filter((f) => f.size > MAX_PHOTO_BYTES);
    const okFiles = incoming.filter((f) => f.size <= MAX_PHOTO_BYTES);

    if (tooLarge.length > 0) {
      setError(
        `${tooLarge.length} foto melebihi 500KB dan tidak diupload: ${tooLarge
          .map((f) => `${f.name} (${(f.size / 1024).toFixed(0)}KB)`)
          .join(', ')}. Kompres atau ambil foto dengan resolusi lebih kecil.`
      );
    } else {
      setError(null);
    }

    if (okFiles.length > 0) setPhotos((prev) => [...prev, ...okFiles]);
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!profile) return;
    if (!title.trim() || !requestedBy.trim() || !description.trim()) {
      setError('Judul, peminta, dan deskripsi pekerjaan wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: workRequest, error: insertErr } = await supabase
        .from('work_requests')
        .insert({
          technician_id: profile.id,
          technician_name: profile.full_name,
          title: title.trim(),
          requested_by: requestedBy.trim(),
          description: description.trim(),
        })
        .select()
        .single();
      if (insertErr) throw insertErr;

      for (const file of photos) {
        const ext = file.name.split('.').pop();
        const path = `work-requests/${workRequest.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file);
        if (uploadErr) throw uploadErr;
        await supabase.from('work_request_photos').insert({
          work_request_id: workRequest.id,
          storage_path: path,
          file_name: file.name,
        });
      }

      resetForm();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal menyimpan titipan pekerjaan';
      setError(msg);
    }
    setSaving(false);
  }

  async function handleDelete(item: WorkRequestWithPhotos) {
    if (!window.confirm(`Hapus titipan pekerjaan "${item.title}"?`)) return;
    for (const photo of item.photos) {
      await supabase.storage.from(STORAGE_BUCKET).remove([photo.storage_path]);
    }
    await supabase.from('work_requests').delete().eq('id', item.id);
    await load();
  }

  const canManage = (item: WorkRequest) => profile && (profile.role === 'admin' || profile.id === item.technician_id);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Titipan Pekerjaan</h1>
          <p className="text-slate-500 text-sm mt-1">Catatan pekerjaan tambahan di luar monitoring rutin.</p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Batal' : 'Tambah Titipan'}
        </button>
      </div>

      {showForm && (
        <div className="card p-5 space-y-4">
          <div>
            <label className="label-text">Judul Pekerjaan</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="mis. Perbaikan kebocoran pipa area produksi" />
          </div>
          <div>
            <label className="label-text">Titipan dari (nama peminta)</label>
            <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} className="input-field" placeholder="mis. Pak Budi (Supervisor Produksi)" />
          </div>
          <div>
            <label className="label-text">Deskripsi Pekerjaan yang Sudah Dikerjakan</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field min-h-24"
              placeholder="Jelaskan apa yang sudah dikerjakan, hasil, dan catatan lainnya..."
            />
          </div>

          <div>
            <label className="label-text">Foto (opsional)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
            />
            <div className="space-y-2 mt-1">
              {photos.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photos.map((file, idx) => (
                    <div key={idx} className="relative group">
                      <img src={URL.createObjectURL(file)} alt="" className="w-20 h-20 rounded-lg object-cover border border-slate-200" />
                      <button
                        onClick={() => removePhoto(idx)}
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 text-sm text-teal-600 hover:text-teal-700 font-medium"
              >
                <Camera className="w-4 h-4" />
                {photos.length > 0 ? 'Tambah foto lagi' : 'Upload foto'}
              </button>
              <p className="text-[10px] text-slate-400">Maks. 500KB per foto</p>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="btn-ghost border border-slate-200">Batal</button>
            <button onClick={handleSubmit} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Simpan
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-12 text-center">
          <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Belum ada titipan pekerjaan yang tercatat.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <div key={item.id} className="card overflow-hidden">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm truncate">{item.title}</p>
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1 flex-wrap">
                      <span className="flex items-center gap-1"><User className="w-3 h-3" /> Diminta oleh: {item.requested_by}</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(item.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span>Teknisi: {item.technician_name}</span>
                      {item.photos.length > 0 && <span>{item.photos.length} foto</span>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
                    <p className="text-sm text-slate-600 whitespace-pre-wrap">{item.description}</p>
                    {item.photos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {item.photos.map((photo) => (
                          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer">
                            <img src={photo.url} alt={photo.file_name || ''} className="w-24 h-24 rounded-lg object-cover border border-slate-200 hover:opacity-80 transition-opacity" />
                          </a>
                        ))}
                      </div>
                    )}
                    {canManage(item) && (
                      <div className="flex justify-end">
                        <button onClick={() => handleDelete(item)} className="btn-ghost text-xs border border-red-200 text-red-600 px-2.5">
                          <Trash2 className="w-3.5 h-3.5" />
                          Hapus
                        </button>
                      </div>
                    )}
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
