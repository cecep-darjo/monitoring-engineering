import { useEffect, useState } from 'react';
import {
  CalendarClock,
  Plus,
  Trash2,
  X,
  Cog,
  Settings,
  Clock,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  SHIFT_LABELS,
  SHIFT_SHORT,
  type Machine,
  type Parameter,
  type Schedule,
  type ScheduleParameter,
} from '@/lib/types';

interface ScheduleWithMachine extends Schedule {
  machine?: Machine;
}

export default function AdminSchedules() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [allParams, setAllParams] = useState<Parameter[]>([]);
  const [schedules, setSchedules] = useState<ScheduleWithMachine[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [machineSchedules, setMachineSchedules] = useState<Record<string, ScheduleWithMachine>>({});
  const [showParamModal, setShowParamModal] = useState<ScheduleWithMachine | null>(null);
  const [scheduleParams, setScheduleParams] = useState<ScheduleParameter[]>([]);
  const [paramSearch, setParamSearch] = useState('');
  const [machineParamIds, setMachineParamIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editingDepFor, setEditingDepFor] = useState<string | null>(null);
  const [depTriggerId, setDepTriggerId] = useState('');
  const [depValue, setDepValue] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    const [{ data: machinesData }, { data: paramsData }, { data: schedulesData }] = await Promise.all([
      supabase.from('machines').select('*').order('name'),
      supabase.from('parameters').select('*').eq('is_active', true).order('name'),
      supabase.from('schedules').select('*, machine:machines(*)').order('shift_number').order('round_number'),
    ]);

    setMachines(machinesData || []);
    setAllParams(paramsData || []);

    const sData = (schedulesData || []) as ScheduleWithMachine[];
    setSchedules(sData);

    // Build lookup map: machine_id -> { "shift-round": schedule }
    const map: Record<string, ScheduleWithMachine> = {};
    for (const s of sData) {
      map[`${s.machine_id}-${s.shift_number}-${s.round_number}`] = s;
    }
    setMachineSchedules(map);
    setLoading(false);
  }

  async function toggleSchedule(machine: Machine, shift: number, round: number) {
    setBusy(true);
    const key = `${machine.id}-${shift}-${round}`;
    const existing = machineSchedules[key];

    if (existing) {
      // Toggle is_active
      const { error } = await supabase
        .from('schedules')
        .update({ is_active: !existing.is_active })
        .eq('id', existing.id);
      if (error) alert(error.message);
    } else {
      // Create new schedule
      const { data, error } = await supabase
        .from('schedules')
        .insert({
          machine_id: machine.id,
          shift_number: shift,
          round_number: round,
          is_active: true,
        })
        .select('*, machine:machines(*)')
        .single();
      if (error) {
        alert(error.message);
      } else if (data) {
        const newSched = data as ScheduleWithMachine;
        setMachineSchedules((prev) => ({ ...prev, [key]: newSched }));
      }
    }
    await loadData();
    setBusy(false);
  }

  async function openParamModal(schedule: ScheduleWithMachine) {
    setShowParamModal(schedule);
    setParamSearch('');
    const [{ data }, { data: mpData }] = await Promise.all([
      supabase
        .from('schedule_parameters')
        .select('*, parameter:parameters!parameter_id(*)')
        .eq('schedule_id', schedule.id)
        .order('sort_order'),
      supabase
        .from('machine_parameters')
        .select('parameter_id')
        .eq('machine_id', schedule.machine_id),
    ]);
    setScheduleParams((data || []) as ScheduleParameter[]);
    setMachineParamIds(new Set((mpData || []).map((mp: any) => mp.parameter_id)));
  }

  async function addParamToSchedule(paramId: string) {
    if (!showParamModal) return;
    const maxOrder = Math.max(0, ...scheduleParams.map((sp) => sp.sort_order));
    const { data, error } = await supabase
      .from('schedule_parameters')
      .insert({
        schedule_id: showParamModal.id,
        parameter_id: paramId,
        sort_order: maxOrder + 1,
      })
      .select('*, parameter:parameters!parameter_id(*)')
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setScheduleParams([...scheduleParams, data as ScheduleParameter]);
  }

  async function removeParamFromSchedule(spId: string) {
    const { error } = await supabase.from('schedule_parameters').delete().eq('id', spId);
    if (error) {
      alert(error.message);
      return;
    }
    setScheduleParams(scheduleParams.filter((sp) => sp.id !== spId));
  }

  async function moveParam(sp: ScheduleParameter, direction: 'up' | 'down') {
    const sorted = [...scheduleParams].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((s) => s.id === sp.id);
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === sorted.length - 1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    const swapSp = sorted[swapIdx];

    await Promise.all([
      supabase.from('schedule_parameters').update({ sort_order: swapSp.sort_order }).eq('id', sp.id),
      supabase.from('schedule_parameters').update({ sort_order: sp.sort_order }).eq('id', swapSp.id),
    ]);

    await openParamModal(showParamModal!);
  }

  function openDepEditor(sp: ScheduleParameter) {
    setEditingDepFor(sp.id);
    setDepTriggerId(sp.depends_on_parameter_id || '');
    setDepValue(sp.depends_on_value || '');
  }

  async function saveDependency(sp: ScheduleParameter) {
    if (!depTriggerId || !depValue) return;
    const { error } = await supabase
      .from('schedule_parameters')
      .update({ depends_on_parameter_id: depTriggerId, depends_on_value: depValue })
      .eq('id', sp.id);
    if (error) { alert(error.message); return; }
    setScheduleParams((prev) =>
      prev.map((s) => (s.id === sp.id ? { ...s, depends_on_parameter_id: depTriggerId, depends_on_value: depValue } : s))
    );
    setEditingDepFor(null);
  }

  function valueOptionsFor(paramId: string): string[] {
    const param = scheduleParams.find((s) => s.parameter_id === paramId)?.parameter as unknown as Parameter | undefined;
    if (!param) return [];
    if (param.type === 'boolean') return ['OK', 'Not OK'];
    if (param.type === 'option') return param.options || [];
    return [];
  }

  async function clearDependency(sp: ScheduleParameter) {
    const { error } = await supabase
      .from('schedule_parameters')
      .update({ depends_on_parameter_id: null, depends_on_value: null })
      .eq('id', sp.id);
    if (error) { alert(error.message); return; }
    setScheduleParams((prev) =>
      prev.map((s) => (s.id === sp.id ? { ...s, depends_on_parameter_id: null, depends_on_value: null } : s))
    );
    setEditingDepFor(null);
  }

  const availableParams = allParams.filter(
    (p) =>
      machineParamIds.has(p.id) &&
      !scheduleParams.some((sp) => sp.parameter_id === p.id) &&
      p.name.toLowerCase().includes(paramSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Monitoring Schedules</h1>
        <p className="text-slate-500 text-sm mt-1">
          Define which machines are monitored per shift and round, and which parameters to record
        </p>
      </div>

      {/* Machine selector */}
      {!selectedMachine ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Select a machine to configure its monitoring schedule:</p>
          {machines.length === 0 ? (
            <div className="card p-12 text-center">
              <Cog className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No machines configured. Add machines first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {machines.map((machine) => {
                const schedCount = schedules.filter((s) => s.machine_id === machine.id && s.is_active).length;
                return (
                  <button
                    key={machine.id}
                    onClick={() => setSelectedMachine(machine)}
                    className="card-hover p-5 text-left"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        <Cog className="w-5 h-5 text-slate-600" />
                      </div>
                      <span className="badge bg-teal-50 text-teal-700 border-teal-200">
                        {schedCount}/6 active
                      </span>
                    </div>
                    <h3 className="font-semibold text-slate-900 text-sm">{machine.name}</h3>
                    <p className="text-xs text-slate-400 mt-1">{machine.code}</p>
                    <div className="flex items-center gap-1 mt-3 text-xs text-teal-600 font-medium">
                      Configure
                      <ChevronRight className="w-3 h-3" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Back button + machine header */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedMachine(null)}
              className="btn-ghost text-sm"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            <div>
              <h2 className="font-bold text-slate-900">{selectedMachine.name}</h2>
              <p className="text-xs text-slate-400">{selectedMachine.code}</p>
            </div>
          </div>

          {/* Shift × Round grid */}
          <div className="space-y-4">
            {[1, 2, 3].map((shift) => (
              <div key={shift} className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-teal-600" />
                  <h3 className="font-semibold text-slate-900 text-sm">{SHIFT_LABELS[shift]}</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[1, 2].map((round) => {
                    const key = `${selectedMachine.id}-${shift}-${round}`;
                    const sched = machineSchedules[key];
                    const isActive = sched?.is_active ?? false;
                    return (
                      <div
                        key={round}
                        className={`rounded-lg border-2 p-4 transition-all ${
                          isActive
                            ? 'border-teal-300 bg-teal-50/50'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-medium text-slate-700">Round {round}</span>
                          <button
                            onClick={() => toggleSchedule(selectedMachine, shift, round)}
                            disabled={busy}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                              isActive ? 'bg-teal-500' : 'bg-slate-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                isActive ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                        {isActive && sched ? (
                          <div>
                            <button
                              onClick={() => openParamModal(sched)}
                              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 hover:border-teal-400 transition-all"
                            >
                              <span className="flex items-center gap-2">
                                <Settings className="w-4 h-4 text-slate-400" />
                                Configure Parameters
                              </span>
                              <ChevronRight className="w-4 h-4 text-slate-300" />
                            </button>
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">Enable to configure parameters</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Parameter assignment modal */}
      {showParamModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowParamModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <div>
                <h2 className="font-bold text-slate-900 text-sm">
                  {showParamModal.machine?.name}
                </h2>
                <p className="text-xs text-slate-400">
                  {SHIFT_SHORT[showParamModal.shift_number]} · Round {showParamModal.round_number}
                </p>
              </div>
              <button onClick={() => setShowParamModal(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {/* Assigned */}
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">Parameters to Record</h3>
                {scheduleParams.length === 0 ? (
                  <p className="text-sm text-slate-400 p-3 bg-slate-50 rounded-lg">
                    No parameters assigned. Add parameters below — technicians will record these values each round.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {[...scheduleParams]
                      .sort((a, b) => a.sort_order - b.sort_order)
                      .map((sp, idx, arr) => {
                        const triggerCandidates = arr.filter(
                          (s) => s.id !== sp.id && ['option', 'boolean'].includes((s.parameter as unknown as Parameter)?.type)
                        );
                        const triggerParam = sp.depends_on_parameter_id
                          ? (arr.find((s) => s.parameter_id === sp.depends_on_parameter_id)?.parameter as unknown as Parameter | undefined)
                          : undefined;
                        return (
                        <div key={sp.id} className="rounded-lg bg-slate-50">
                        <div className="flex items-center justify-between p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-400 w-5">{idx + 1}.</span>
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {(sp.parameter as unknown as Parameter).name}
                              </p>
                              <p className="text-xs text-slate-400 capitalize">
                                {(sp.parameter as unknown as Parameter).type}
                                {(sp.parameter as unknown as Parameter).unit &&
                                  ` · ${(sp.parameter as unknown as Parameter).unit}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveParam(sp, 'up')}
                              disabled={idx === 0}
                              className="text-slate-400 hover:text-slate-600 disabled:opacity-30 px-1"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => moveParam(sp, 'down')}
                              disabled={idx === arr.length - 1}
                              className="text-slate-400 hover:text-slate-600 disabled:opacity-30 px-1"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeParamFromSchedule(sp.id)}
                              className="text-red-400 hover:text-red-600 p-1"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Conditional dependency: only relevant when another on/off-style parameter has a specific value */}
                        <div className="px-3 pb-3">
                          {editingDepFor === sp.id ? (
                            <div className="flex flex-wrap items-center gap-2 bg-white rounded-lg border border-slate-200 p-2">
                              <span className="text-xs text-slate-500">Aktif hanya jika</span>
                              <select
                                value={depTriggerId}
                                onChange={(e) => { setDepTriggerId(e.target.value); setDepValue(''); }}
                                className="input-field !py-1 !text-xs w-auto"
                              >
                                <option value="">Pilih parameter...</option>
                                {triggerCandidates.map((t) => (
                                  <option key={t.parameter_id} value={t.parameter_id}>
                                    {(t.parameter as unknown as Parameter).name}
                                  </option>
                                ))}
                              </select>
                              <span className="text-xs text-slate-500">=</span>
                              <select
                                value={depValue}
                                onChange={(e) => setDepValue(e.target.value)}
                                disabled={!depTriggerId}
                                className="input-field !py-1 !text-xs w-auto"
                              >
                                <option value="">Pilih nilai...</option>
                                {valueOptionsFor(depTriggerId).map((v) => (
                                  <option key={v} value={v}>{v}</option>
                                ))}
                              </select>
                              <button onClick={() => saveDependency(sp)} disabled={!depTriggerId || !depValue} className="btn-primary !py-1 !px-2 !text-xs">
                                Simpan
                              </button>
                              <button onClick={() => setEditingDepFor(null)} className="btn-ghost !py-1 !px-2 !text-xs border border-slate-200">
                                Batal
                              </button>
                              {sp.depends_on_parameter_id && (
                                <button onClick={() => clearDependency(sp)} className="text-xs text-red-500 hover:text-red-700 ml-auto">
                                  Hapus kondisi
                                </button>
                              )}
                            </div>
                          ) : sp.depends_on_parameter_id && triggerParam ? (
                            <button
                              onClick={() => openDepEditor(sp)}
                              className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1 hover:bg-teal-100 transition-colors"
                            >
                              Aktif hanya jika <b>{triggerParam.name}</b> = <b>{sp.depends_on_value}</b> (klik untuk ubah)
                            </button>
                          ) : triggerCandidates.length > 0 ? (
                            <button
                              onClick={() => openDepEditor(sp)}
                              className="text-xs text-slate-400 hover:text-teal-600 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" /> Set kondisi (opsional)
                            </button>
                          ) : null}
                        </div>
                        </div>
                        );
                      })}
                  </div>
                )}
              </div>

              {/* Available */}
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
                    {machineParamIds.size === 0
                      ? 'Mesin ini belum punya parameter terdaftar. Tambahkan dulu di halaman Machines.'
                      : 'Semua parameter mesin ini sudah ditambahkan, atau tidak ada yang cocok dengan pencarian.'}
                  </p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {availableParams.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addParamToSchedule(p.id)}
                        className="w-full flex items-center justify-between p-2.5 rounded-lg border border-slate-200 hover:border-teal-400 hover:bg-teal-50/50 transition-all text-left"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-400 capitalize">
                            {p.type}{p.unit && ` · ${p.unit}`}
                          </p>
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
