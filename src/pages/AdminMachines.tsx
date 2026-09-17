import { useEffect, useState } from 'react';
import {
  Cog,
  Plus,
  Edit2,
  Trash2,
  X,
  Settings,
  Search,
  MapPin,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Machine, Parameter, MachineParameter } from '@/lib/types';

interface MachineWithParams extends Machine {
  paramCount?: number;
}

export default function AdminMachines() {
  const [machines, setMachines] = useState<MachineWithParams[]>([]);
  const [allParams, setAllParams] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [showParams, setShowParams] = useState<Machine | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parameter assignment state
  const [machineParams, setMachineParams] = useState<MachineParameter[]>([]);
  const [paramSearch, setParamSearch] = useState('');

  useEffect(() => {
    loadMachines();
    supabase.from('parameters').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setAllParams(data || []);
    });
  }, []);

  async function loadMachines() {
    setLoading(true);
    const { data } = await supabase
      .from('machines')
      .select('*')
      .order('created_at', { ascending: false });

    const machinesData = data || [];
    const withCounts = await Promise.all(
      machinesData.map(async (m) => {
        const { count } = await supabase
          .from('machine_parameters')
          .select('id', { count: 'exact', head: true })
          .eq('machine_id', m.id);
        return { ...m, paramCount: count || 0 };
      })
    );
    setMachines(withCounts);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setName('');
    setCode('');
    setLocation('');
    setDescription('');
    setIsActive(true);
    setError(null);
    setShowForm(true);
  }

  function openEdit(machine: Machine) {
    setEditing(machine);
    setName(machine.name);
    setCode(machine.code);
    setLocation(machine.location || '');
    setDescription(machine.description || '');
    setIsActive(machine.is_active);
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim() || !code.trim()) {
      setError('Name and code are required');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      code: code.trim().toUpperCase(),
      location: location.trim() || null,
      description: description.trim() || null,
      is_active: isActive,
    };

    if (editing) {
      const { error: err } = await supabase
        .from('machines')
        .update(payload)
        .eq('id', editing.id);
      if (err) setError(err.message);
    } else {
      const { error: err } = await supabase.from('machines').insert(payload);
      if (err) setError(err.message);
    }

    if (!error) {
      setShowForm(false);
      await loadMachines();
    }
    setSaving(false);
  }

  async function handleDelete(machine: Machine) {
    if (!confirm(`Delete machine "${machine.name}"? This will also delete all its monitoring data.`)) return;
    const { error: err } = await supabase.from('machines').delete().eq('id', machine.id);
    if (err) {
      alert(err.message);
      return;
    }
    await loadMachines();
  }

  async function openParams(machine: Machine) {
    setShowParams(machine);
    const { data } = await supabase
      .from('machine_parameters')
      .select('*, parameter:parameters(*)')
      .eq('machine_id', machine.id)
      .order('sort_order');
    setMachineParams((data || []) as unknown as MachineParameter[]);
  }

  async function addParameterToMachine(paramId: string) {
    if (!showParams) return;
    const maxOrder = Math.max(0, ...machineParams.map((mp) => mp.sort_order));
    const { data, error: err } = await supabase
      .from('machine_parameters')
      .insert({
        machine_id: showParams.id,
        parameter_id: paramId,
        sort_order: maxOrder + 1,
      })
      .select('*, parameter:parameters(*)')
      .single();
    if (err) {
      alert(err.message);
      return;
    }
    setMachineParams([...machineParams, data as unknown as MachineParameter]);
  }

  async function removeParameterFromMachine(mpId: string) {
    const { error: err } = await supabase.from('machine_parameters').delete().eq('id', mpId);
    if (err) {
      alert(err.message);
      return;
    }
    setMachineParams(machineParams.filter((mp) => mp.id !== mpId));
  }

  async function moveParameter(mp: MachineParameter, direction: 'up' | 'down') {
    const sorted = [...machineParams].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((m) => m.id === mp.id);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sorted.length - 1) return;

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const swapMp = sorted[swapIdx];

    await Promise.all([
      supabase.from('machine_parameters').update({ sort_order: swapMp.sort_order }).eq('id', mp.id),
      supabase.from('machine_parameters').update({ sort_order: mp.sort_order }).eq('id', swapMp.id),
    ]);

    await openParams(showParams!);
  }

  const filteredMachines = machines.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase())
  );

  const availableParams = allParams.filter(
    (p) =>
      !machineParams.some((mp) => mp.parameter_id === p.id) &&
      p.name.toLowerCase().includes(paramSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Machines</h1>
          <p className="text-slate-500 text-sm mt-1">Manage equipment and assign monitoring parameters</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Machine
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search machines..."
          className="input-field pl-10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredMachines.length === 0 ? (
        <div className="card p-12 text-center">
          <Cog className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            {machines.length === 0 ? 'No machines yet. Click "Add Machine" to get started.' : 'No machines match your search.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMachines.map((machine) => (
            <div key={machine.id} className="card p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Cog className="w-5 h-5 text-slate-600" />
                </div>
                <span
                  className={`badge ${
                    machine.is_active
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200'
                  }`}
                >
                  {machine.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h3 className="font-semibold text-slate-900 text-sm">{machine.name}</h3>
              <p className="text-xs text-slate-400 mt-1">{machine.code}</p>
              {machine.location && (
                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {machine.location}
                </p>
              )}
              {machine.description && (
                <p className="text-xs text-slate-400 mt-2 line-clamp-2">{machine.description}</p>
              )}
              <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                <Settings className="w-3.5 h-3.5" />
                {machine.paramCount || 0} parameters
              </div>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => openParams(machine)}
                  className="btn-ghost text-xs flex-1 border border-slate-200"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Parameters
                </button>
                <button onClick={() => openEdit(machine)} className="btn-ghost text-xs border border-slate-200 px-2.5">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handleDelete(machine)} className="btn-ghost text-xs border border-slate-200 px-2.5 text-red-500 hover:bg-red-50">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-bold text-slate-900">{editing ? 'Edit Machine' : 'Add Machine'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label-text">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. Generator A" />
              </div>
              <div>
                <label className="label-text">Code</label>
                <input value={code} onChange={(e) => setCode(e.target.value)} className="input-field" placeholder="e.g. GEN-A" />
              </div>
              <div>
                <label className="label-text">Location (optional)</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className="input-field" placeholder="e.g. Building 1, Room 101" />
              </div>
              <div>
                <label className="label-text">Description (optional)</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input-field resize-none" placeholder="Brief description of the machine..." />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                <span className="text-sm text-slate-700">Active</span>
              </label>
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Parameter Assignment Modal */}
      {showParams && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowParams(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-bold text-slate-900">{showParams.name}</h2>
                <p className="text-xs text-slate-400">Assign monitoring parameters</p>
              </div>
              <button onClick={() => setShowParams(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Assigned parameters */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Assigned Parameters</h3>
                {machineParams.length === 0 ? (
                  <p className="text-sm text-slate-400 p-3 bg-slate-50 rounded-lg">No parameters assigned yet.</p>
                ) : (
                  <div className="space-y-2">
                    {[...machineParams]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((mp, idx, arr) => (
                        <div key={mp.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-400 w-5">{idx + 1}.</span>
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {(mp.parameter as unknown as Parameter).name}
                              </p>
                              <p className="text-xs text-slate-400 capitalize">
                                {(mp.parameter as unknown as Parameter).type}
                                {(mp.parameter as unknown as Parameter).unit && ` · ${(mp.parameter as unknown as Parameter).unit}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveParameter(mp, 'up')}
                              disabled={idx === 0}
                              className="text-slate-400 hover:text-slate-600 disabled:opacity-30 px-1"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveParameter(mp, 'down')}
                              disabled={idx === arr.length - 1}
                              className="text-slate-400 hover:text-slate-600 disabled:opacity-30 px-1"
                            >
                              ↓
                            </button>
                            <button
                              onClick={() => removeParameterFromMachine(mp.id)}
                              className="text-red-400 hover:text-red-600 p-1"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Available parameters */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Add Parameters</h3>
                <input
                  type="text"
                  value={paramSearch}
                  onChange={(e) => setParamSearch(e.target.value)}
                  placeholder="Search parameters..."
                  className="input-field mb-2 text-sm"
                />
                {availableParams.length === 0 ? (
                  <p className="text-sm text-slate-400 p-3 bg-slate-50 rounded-lg">
                    {allParams.length === 0 ? 'No parameters exist yet. Create parameters first.' : 'All parameters assigned or none match.'}
                  </p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {availableParams.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addParameterToMachine(p.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 transition-all text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-400 capitalize">{p.type}{p.unit && ` · ${p.unit}`}</p>
                        </div>
                        <Plus className="w-4 h-4 text-teal-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
