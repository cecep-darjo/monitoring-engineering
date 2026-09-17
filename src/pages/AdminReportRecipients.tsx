import { useEffect, useState } from 'react';
import { Mail, Plus, Trash2, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ReportRecipient {
  id: string;
  email: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

export default function AdminReportRecipients() {
  const [recipients, setRecipients] = useState<ReportRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('report_recipients')
      .select('*')
      .order('created_at', { ascending: false });
    setRecipients(data || []);
    setLoading(false);
  }

  async function handleAdd() {
    const clean = email.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Masukkan alamat email yang valid');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: err } = await supabase
      .from('report_recipients')
      .insert({ email: clean, label: label.trim() || null });
    if (err) {
      setError(err.message.includes('duplicate') ? 'Email ini sudah terdaftar' : err.message);
      setSaving(false);
      return;
    }
    setEmail('');
    setLabel('');
    setSaving(false);
    await load();
  }

  async function handleToggle(r: ReportRecipient) {
    await supabase.from('report_recipients').update({ is_active: !r.is_active }).eq('id', r.id);
    await load();
  }

  async function handleDelete(r: ReportRecipient) {
    if (!window.confirm(`Hapus ${r.email} dari daftar penerima report?`)) return;
    await supabase.from('report_recipients').delete().eq('id', r.id);
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Report Email Recipients</h1>
        <p className="text-slate-500 text-sm mt-1">
          Email di bawah ini akan otomatis menerima PDF report setiap hari, dikirim setelah Shift 3 Round 2
          selesai (pukul 07:00 WIB).
        </p>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@perusahaan.com"
            className="input-field flex-1"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (opsional, mis. Supervisor)"
            className="input-field flex-1"
          />
          <button onClick={handleAdd} disabled={saving} className="btn-primary whitespace-nowrap">
            <Plus className="w-4 h-4" />
            Tambah
          </button>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : recipients.length === 0 ? (
        <div className="card p-12 text-center">
          <Mail className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Belum ada email penerima terdaftar.</p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{r.email}</p>
                {r.label && <p className="text-xs text-slate-400">{r.label}</p>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggle(r)}
                  className={`badge cursor-pointer ${
                    r.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                  title={r.is_active ? 'Klik untuk nonaktifkan' : 'Klik untuk aktifkan'}
                >
                  {r.is_active ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {r.is_active ? 'Aktif' : 'Nonaktif'}
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  className="btn-ghost text-xs border border-red-200 text-red-600 px-2.5"
                  title="Hapus"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
