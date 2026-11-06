import { useEffect, useState } from 'react';
import { BellRing, CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import type { Announcement } from '@/lib/types';

function localDateTimeValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function AdminAnnouncements() {
  const { profile } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [message, setMessage] = useState('');
  const [publishAt, setPublishAt] = useState(() => localDateTimeValue());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadAnnouncements(); }, []);

  async function loadAnnouncements() {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('announcements').select('*').order('publish_at', { ascending: false });
    if (loadError) setError(loadError.message);
    else setAnnouncements((data || []) as Announcement[]);
    setLoading(false);
  }

  async function handleCreate() {
    if (!profile || !message.trim() || !publishAt) {
      setError('Pesan dan tanggal/jam tampil wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase.from('announcements').insert({
      message: message.trim(),
      publish_at: new Date(publishAt).toISOString(),
      created_by: profile.id,
    });
    if (insertError) setError(insertError.message);
    else {
      setMessage('');
      setPublishAt(localDateTimeValue());
      await loadAnnouncements();
    }
    setSaving(false);
  }

  async function handleDelete(announcement: Announcement) {
    if (!window.confirm('Hapus pengumuman ini?')) return;
    setDeletingId(announcement.id);
    setError(null);
    const { error: deleteError } = await supabase.from('announcements').delete().eq('id', announcement.id);
    if (deleteError) setError(deleteError.message);
    else setAnnouncements((current) => current.filter((item) => item.id !== announcement.id));
    setDeletingId(null);
  }

  const now = Date.now();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pengumuman</h1>
        <p className="mt-1 text-sm text-slate-500">Tulis pesan dan tentukan tanggal serta jam pengumuman tampil di Dashboard.</p>
      </div>

      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><BellRing className="h-4 w-4 text-teal-600" /> Buat Pengumuman</div>
        <div>
          <label className="label-text" htmlFor="announcement-message">Pesan</label>
          <textarea id="announcement-message" value={message} onChange={(event) => setMessage(event.target.value)} rows={4} maxLength={2000} className="input-field resize-y" placeholder="Tulis pesan pengumuman..." />
        </div>
        <div className="max-w-sm">
          <label className="label-text" htmlFor="announcement-publish-at">Tanggal dan jam tampil</label>
          <input id="announcement-publish-at" type="datetime-local" value={publishAt} onChange={(event) => setPublishAt(event.target.value)} className="input-field" />
        </div>
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex justify-end">
          <button onClick={() => void handleCreate()} disabled={saving || !message.trim() || !publishAt} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Simpan Pengumuman
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Daftar Pengumuman</h2>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
        ) : announcements.length === 0 ? (
          <div className="card p-8 text-center text-sm text-slate-500">Belum ada pengumuman.</div>
        ) : announcements.map((announcement) => {
          const isUpcoming = new Date(announcement.publish_at).getTime() > now;
          return (
            <article key={announcement.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <span className={`badge ${isUpcoming ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{isUpcoming ? 'Terjadwal' : 'Tampil'}</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">{announcement.message}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><CalendarClock className="h-3.5 w-3.5" />{new Date(announcement.publish_at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })}</p>
              </div>
              <button onClick={() => void handleDelete(announcement)} disabled={deletingId === announcement.id} className="btn-ghost self-end border border-red-200 px-3 text-xs text-red-600 sm:self-start" aria-label="Hapus pengumuman">
                {deletingId === announcement.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Hapus
              </button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
