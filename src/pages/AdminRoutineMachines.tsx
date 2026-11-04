import { useEffect, useState } from 'react';
import { CheckCircle2, Power, PowerOff } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Machine } from '@/lib/types';

export default function AdminRoutineMachines() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void loadMachines(); }, []);

  async function loadMachines() {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('machines')
      .select('*')
      .eq('machine_category', 'rutin')
      .order('name');
    if (loadError) setError(loadError.message);
    else setMachines(data || []);
    setLoading(false);
  }

  async function setAllActive(isActive: boolean) {
    if (machines.length === 0) return;
    setBusy(true);
    setError(null);
    const ids = machines.map((machine) => machine.id);
    const { error: saveError } = await supabase.from('machines').update({ is_active: isActive }).in('id', ids);
    if (saveError) setError(saveError.message);
    else setMachines((current) => current.map((machine) => ({ ...machine, is_active: isActive })));
    setBusy(false);
  }

  const activeCount = machines.filter((machine) => machine.is_active).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Machine Rutin</h1>
          <p className="mt-1 text-sm text-slate-500">Daftar ini hanya berisi mesin berbadge Rutin. Status aktif mengikuti status Machine reguler.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void setAllActive(true)} disabled={busy || machines.length === 0} className="btn-primary">
            <Power className="h-4 w-4" /> Aktifkan Semua
          </button>
          <button onClick={() => void setAllActive(false)} disabled={busy || machines.length === 0} className="btn-secondary">
            <PowerOff className="h-4 w-4" /> Nonaktifkan Semua
          </button>
        </div>
      </div>

      <div className="card flex items-center gap-3 p-4">
        <CheckCircle2 className="h-5 w-5 text-teal-600" />
        <p className="text-sm text-slate-600"><strong className="text-slate-900">{activeCount}</strong> dari {machines.length} mesin rutin aktif</p>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading ? (
        <div className="flex h-40 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" /></div>
      ) : machines.length === 0 ? (
        <div className="card p-12 text-center text-sm text-slate-500">Belum ada mesin berbadge Rutin. Atur badge mesin di halaman Machines.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Machine</th><th className="px-5 py-3">Lokasi</th><th className="px-5 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {machines.map((machine) => (
                  <tr key={machine.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4"><div className="font-medium text-slate-900">{machine.name}</div><div className="mt-0.5 text-xs text-slate-400">{machine.code}</div></td>
                    <td className="px-5 py-4 text-slate-500">{machine.location || '—'}</td>
                    <td className="px-5 py-4"><span className={`badge ${machine.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-500'}`}>{machine.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
