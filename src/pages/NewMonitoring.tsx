import { useEffect, useState, useRef } from 'react';
import {
  ClipboardPlus,
  Camera,
  X,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Upload,
  Loader2,
} from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import {
  getCurrentShiftAndRound,
  getRoundWindowLabel,
  ROUND_WINDOWS,
  SHIFT_LABELS,
  evaluateValueStatus,
  getStatusColor,
  type Machine,
  type Parameter,
  type ScheduleParameter,
  type ValueStatus,
  type MonitoringPhoto,
} from '@/lib/types';
import type { PageKey } from '@/components/Layout';

interface NewMonitoringProps {
  onNavigate: (page: PageKey) => void;
}

interface ExistingPhoto extends MonitoringPhoto {
  url: string;
}

interface ParamWithValue {
  parameter: Parameter;
  value: string;
  notes: string;
  status: ValueStatus;
  photos: File[];
  existingPhotos: ExistingPhoto[];
  dependsOnParameterId: string | null;
  dependsOnValue: string | null;
}

export default function NewMonitoring({ onNavigate }: NewMonitoringProps) {
  const { profile } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [enteredMachineIds, setEnteredMachineIds] = useState<Set<string>>(new Set());
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const initialShiftRound = getCurrentShiftAndRound();
  const [shiftNumber, setShiftNumber] = useState(initialShiftRound.shift);
  const [roundNumber, setRoundNumber] = useState(initialShiftRound.round);
  const [monitoringDate, setMonitoringDate] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [generalNotes, setGeneralNotes] = useState('');
  const [params, setParams] = useState<ParamWithValue[]>([]);
  const [previousValues, setPreviousValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [deletedPhotos, setDeletedPhotos] = useState<{ id: string; storage_path: string }[]>([]);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    loadScheduledMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftNumber, roundNumber]);

  useEffect(() => {
    refreshEnteredMachines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitoringDate]);

  async function loadScheduledMachines() {
    setLoading(true);
    const { data: allMachines } = await supabase
      .from('machines')
      .select('*')
      .eq('is_active', true)
      .order('name');

    // Only show machines that are actually scheduled for the current shift + round,
    // so technicians aren't picking from a full list of machines that aren't due right now.
    const { data: scheduleData } = await supabase
      .from('schedules')
      .select('machine_id')
      .eq('shift_number', shiftNumber)
      .eq('round_number', roundNumber)
      .eq('is_active', true);

    const scheduledIds = new Set((scheduleData || []).map((s: any) => s.machine_id));
    setMachines((allMachines || []).filter((m) => scheduledIds.has(m.id)));

    await refreshEnteredMachines();
    setLoading(false);
  }

  async function refreshEnteredMachines() {
    const { data: enteredRounds } = await supabase
      .from('monitoring_rounds')
      .select('machine_id')
      .eq('shift_number', shiftNumber)
      .eq('round_number', roundNumber)
      .eq('monitoring_date', monitoringDate);
    setEnteredMachineIds(new Set((enteredRounds || []).map((r: any) => r.machine_id)));
  }

  async function loadMachineParameters(machine: Machine) {
    setSelectedMachine(machine);
    setError(null);

    // Load schedule for this machine + current shift
    const { data: scheduleData } = await supabase
      .from('schedules')
      .select('*, machine:machines(*)')
      .eq('machine_id', machine.id)
      .eq('shift_number', shiftNumber)
      .eq('is_active', true);

    const shiftSchedules = (scheduleData || []) as any[];

    // Check existing rounds to auto-suggest round number
    const { data: existing } = await supabase
      .from('monitoring_rounds')
      .select('round_number, shift_number')
      .eq('machine_id', machine.id)
      .eq('shift_number', shiftNumber)
      .eq('monitoring_date', monitoringDate);

    const doneRounds = (existing || []).map((r) => r.round_number);
    let suggestedRound = 1;
    if (!doneRounds.includes(1)) suggestedRound = 1;
    else if (!doneRounds.includes(2)) suggestedRound = 2;
    else suggestedRound = 2;
    setRoundNumber(suggestedRound);

    // Load parameters and existing data for the suggested round
    await loadScheduleParams(machine.id, shiftNumber, suggestedRound);
  }

  function isCurrentShiftOpen() {
    const now = new Date();
    const localToday = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - now.getTimezoneOffset() * 60000 - 86400000).toISOString().split('T')[0];
    const hour = now.getHours();
    const window = ROUND_WINDOWS[shiftNumber]?.[roundNumber];
    if (!window) return false;

    if (window.start < window.end) {
      // Same-day window, e.g. 07-11, 11-15, 15-19, 19-23, 03-07
      return monitoringDate === localToday && hour >= window.start && hour < window.end;
    }
    // Wraps past midnight, e.g. shift 3 round 1: 23-03
    return (
      (monitoringDate === localToday && hour >= window.start) ||
      (monitoringDate === yesterday && hour < window.end)
    );
  }

  async function loadScheduleParams(machineId: string, shift: number, round: number) {
    setError(null);
    const { data: scheduleData } = await supabase
      .from('schedules').select('id')
      .eq('machine_id', machineId).eq('shift_number', shift)
      .eq('round_number', round).eq('is_active', true).maybeSingle();

    if (!scheduleData) { setParams([]); setEditingRoundId(null); return; }

    const { data: existingRound } = await supabase
      .from('monitoring_rounds').select('*')
      .eq('machine_id', machineId).eq('shift_number', shift)
      .eq('round_number', round).eq('monitoring_date', monitoringDate).maybeSingle();

    const { data: spData } = await supabase
      .from('schedule_parameters').select('*, parameter:parameters!parameter_id(*)')
      .eq('schedule_id', scheduleData.id).order('sort_order');

    let existingValues: any[] = [];
    let photosByParam = new Map<string, MonitoringPhoto[]>();
    if (existingRound) {
      const { data } = await supabase.from('monitoring_values').select('*').eq('round_id', existingRound.id);
      existingValues = data || [];
      setEditingRoundId(existingRound.id);
      setGeneralNotes(existingRound.notes || '');

      const { data: photoData } = await supabase
        .from('monitoring_photos')
        .select('*')
        .eq('round_id', existingRound.id);
      for (const photo of photoData || []) {
        if (!photosByParam.has(photo.parameter_id)) photosByParam.set(photo.parameter_id, []);
        photosByParam.get(photo.parameter_id)!.push(photo);
      }
    } else {
      setEditingRoundId(null); setGeneralNotes('');
    }
    setDeletedPhotos([]);

    const items: ParamWithValue[] = (spData || []).filter((sp: any) => sp.parameter).map((sp: any) => {
      const old = existingValues.find((v: any) => v.parameter_id === sp.parameter.id);
      const existingPhotos: ExistingPhoto[] = (photosByParam.get(sp.parameter.id) || []).map((photo) => ({
        ...photo,
        url: supabase.storage.from(STORAGE_BUCKET).getPublicUrl(photo.storage_path).data.publicUrl,
      }));
      return { parameter: sp.parameter as Parameter, value: old?.value || '', notes: old?.notes || '', status: old?.status || 'normal', photos: [], existingPhotos, dependsOnParameterId: sp.depends_on_parameter_id || null, dependsOnValue: sp.depends_on_value || null };
    });
    setParams(items);

    // For "must increase" parameters (e.g. running hours), look up the most recent prior
    // entry on this machine so we can block a new value that's lower than it.
    const increasingParamIds = items.filter((p) => p.parameter.must_increase).map((p) => p.parameter.id);
    if (increasingParamIds.length > 0) {
      const { data: priorRows } = await supabase
        .from('monitoring_values')
        .select('value, parameter_id, round_id, monitoring_rounds!inner(machine_id, monitoring_date, shift_number, round_number)')
        .in('parameter_id', increasingParamIds)
        .eq('monitoring_rounds.machine_id', machineId);

      const latestByParam: Record<string, { value: number; sortKey: string }> = {};
      for (const row of (priorRows || []) as any[]) {
        if (existingRound && row.round_id === existingRound.id) continue; // skip the round we're editing itself
        const numVal = parseFloat(row.value);
        if (isNaN(numVal)) continue;
        const r = row.monitoring_rounds;
        const sortKey = `${r.monitoring_date}-${r.shift_number}-${r.round_number}`;
        const current = latestByParam[row.parameter_id];
        if (!current || sortKey > current.sortKey) {
          latestByParam[row.parameter_id] = { value: numVal, sortKey };
        }
      }
      const prevMap: Record<string, number> = {};
      for (const paramId of increasingParamIds) {
        if (latestByParam[paramId]) prevMap[paramId] = latestByParam[paramId].value;
      }
      setPreviousValues(prevMap);
    } else {
      setPreviousValues({});
    }
  }

  function updateParamValue(idx: number, value: string) {
    setParams((prev) =>
      prev.map((p, i) => {
        if (i !== idx) return p;
        const status = evaluateValueStatus(value, p.parameter);
        return { ...p, value, status };
      })
    );
  }

  function updateParamNotes(idx: number, notes: string) {
    setParams((prev) => prev.map((p, i) => (i === idx ? { ...p, notes } : p)));
  }

  const MAX_PHOTO_BYTES = 500 * 1024;

  function handleFileSelect(idx: number, files: FileList | null) {
    if (!files) return;
    const incoming = Array.from(files).filter((f) => f.type.startsWith('image/'));
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

    if (okFiles.length === 0) return;
    setParams((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, photos: [...p.photos, ...okFiles].slice(0, 5) } : p
      )
    );
  }

  function isParamActive(p: ParamWithValue): boolean {
    if (!p.dependsOnParameterId) return true;
    const trigger = params.find((x) => x.parameter.id === p.dependsOnParameterId);
    if (!trigger) return true; // trigger param not in this schedule; fail open rather than hide unexpectedly
    return trigger.value === p.dependsOnValue;
  }

  function removeExistingPhoto(idx: number, photo: ExistingPhoto) {
    setDeletedPhotos((prev) => [...prev, { id: photo.id, storage_path: photo.storage_path }]);
    setParams((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, existingPhotos: p.existingPhotos.filter((ph) => ph.id !== photo.id) } : p
      )
    );
  }

  function removePhoto(idx: number, photoIdx: number) {
    setParams((prev) =>
      prev.map((p, i) =>
        i === idx ? { ...p, photos: p.photos.filter((_, j) => j !== photoIdx) } : p
      )
    );
  }

  async function handleSubmit() {
    if (!selectedMachine || !profile) return;
    if (params.length === 0) {
      setError('No parameters configured for this machine\'s schedule. Ask an admin to set up the monitoring schedule.');
      return;
    }

    const decreasedParam = params.find((p) => {
      if (!p.parameter.must_increase || !p.value) return false;
      const prev = previousValues[p.parameter.id];
      if (prev === undefined) return false;
      const num = parseFloat(p.value);
      return !isNaN(num) && num < prev;
    });
    if (decreasedParam) {
      setError(
        `Nilai "${decreasedParam.parameter.name}" (${decreasedParam.value}) lebih kecil dari entry sebelumnya (${previousValues[decreasedParam.parameter.id]}). Parameter ini tidak boleh menurun.`
      );
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (!isCurrentShiftOpen()) throw new Error(`Waktu entry untuk Round ${roundNumber} (${getRoundWindowLabel(shiftNumber, roundNumber)}) sudah berakhir atau belum dimulai. Data terkunci.`);

      // Remove any existing photos the technician deleted while editing this round.
      for (const dp of deletedPhotos) {
        await supabase.storage.from(STORAGE_BUCKET).remove([dp.storage_path]);
        await supabase.from('monitoring_photos').delete().eq('id', dp.id);
      }

      let roundId = editingRoundId;
      if (roundId) {
        const { error } = await supabase.from('monitoring_rounds').update({
          notes: generalNotes || null, completed_at: new Date().toISOString(), technician_id: profile.id, technician_name: profile.full_name
        }).eq('id', roundId);
        if (error) throw error;
        const { error: deleteError } = await supabase.from('monitoring_values').delete().eq('round_id', roundId);
        if (deleteError) throw deleteError;
      } else {
        const { data: roundData, error: roundError } = await supabase.from('monitoring_rounds').insert({
          technician_id: profile.id, technician_name: profile.full_name, machine_id: selectedMachine.id,
          machine_name: selectedMachine.name, shift_number: shiftNumber, round_number: roundNumber,
          monitoring_date: monitoringDate, status: 'completed', notes: generalNotes || null, completed_at: new Date().toISOString(),
        }).select().single();
        if (roundError) throw roundError;
        roundId = roundData.id;
      }
      const activeParams = params.filter((p) => isParamActive(p));
      const valuesToInsert = activeParams.map((p) => ({ round_id: roundId!, parameter_id: p.parameter.id,
        parameter_name: p.parameter.name, value: p.value || null, unit: p.parameter.unit,
        status: p.value ? p.status : 'normal', notes: p.notes || null }));
      const { error: valuesError } = await supabase.from('monitoring_values').insert(valuesToInsert);
      if (valuesError) throw valuesError;

      for (const p of activeParams) {
        if (p.photos.length === 0) continue;
        for (const file of p.photos) {
          const ext = file.name.split('.').pop();
          const fileName = `${roundId}/${p.parameter.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(fileName, file);

          if (uploadError) throw uploadError;

          const { error: photoError } = await supabase
            .from('monitoring_photos')
            .insert({
              round_id: roundId,
              parameter_id: p.parameter.id,
              storage_path: fileName,
              file_name: file.name,
            });

          if (photoError) throw photoError;
        }
      }

      setSuccess(true);
      setDeletedPhotos([]);
      await refreshEnteredMachines();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save monitoring data';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setSelectedMachine(null);
    setParams([]);
    setGeneralNotes('');
    setSuccess(false);
    setError(null);
    setDeletedPhotos([]);
    setPreviousValues({});
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto mt-12 animate-fade-in">
        <div className="card p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Monitoring Saved</h2>
          <p className="text-slate-500 text-sm mb-6">
            The monitoring round has been recorded successfully.
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={resetForm} className="btn-primary">
              <ClipboardPlus className="w-4 h-4" />
              New Round
            </button>
            <button onClick={() => onNavigate('dashboard')} className="btn-secondary">
              Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (machines.length === 0) {
    return (
      <div className="max-w-md mx-auto mt-12">
        <div className="card p-8 text-center">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-slate-900 mb-2">Tidak Ada Mesin Terjadwal</h2>
          <p className="text-slate-500 text-sm">
            Tidak ada mesin yang dijadwalkan untuk {SHIFT_LABELS[shiftNumber]} Round {roundNumber} saat ini.
            Hubungi admin untuk mengatur jadwal monitoring, atau cek kembali saat jam round berikutnya.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Monitoring Round</h1>
        <p className="text-slate-500 text-sm mt-1">
          Record equipment readings for the current shift
        </p>
      </div>

      {/* Machine Selection */}
      {!selectedMachine ? (
        <div className="space-y-4">
          <div className="card p-5">
            <label className="label-text">Select Machine to Monitor</label>
            <p className="text-xs text-slate-400 mt-1">
              Menampilkan mesin yang terjadwal untuk {SHIFT_LABELS[shiftNumber]} Round {roundNumber} ({getRoundWindowLabel(shiftNumber, roundNumber)})
            </p>
            <div className="space-y-2 mt-3">
              {machines.map((machine) => {
                const isEntered = enteredMachineIds.has(machine.id);
                return (
                  <button
                    key={machine.id}
                    onClick={() => loadMachineParameters(machine)}
                    className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all text-left group ${
                      isEntered
                        ? 'border-emerald-300 bg-emerald-50/60 hover:border-emerald-400'
                        : 'border-slate-200 hover:border-teal-400 hover:bg-teal-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isEntered && (
                        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0" title="Sudah dientry">
                          <CheckCircle2 className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{machine.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {machine.code}
                          {machine.location && ` · ${machine.location}`}
                          {isEntered && <span className="text-emerald-600 font-medium"> · Sudah dientry</span>}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-5 h-5 flex-shrink-0 transition-colors ${isEntered ? 'text-emerald-300 group-hover:text-emerald-500' : 'text-slate-300 group-hover:text-teal-500'}`} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Round Info */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-400">Machine</p>
                <p className="font-semibold text-slate-900">{selectedMachine.name}</p>
              </div>
              <button
                onClick={() => { setSelectedMachine(null); setParams([]); }}
                className="btn-ghost text-xs"
              >
                Change
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="label-text">Shift</label>
                <select
                  value={shiftNumber}
                  onChange={(e) => {
                    const newShift = Number(e.target.value);
                    setShiftNumber(newShift);
                    if (selectedMachine) {
                      loadScheduleParams(selectedMachine.id, newShift, roundNumber);
                    }
                  }}
                  className="input-field"
                >
                  <option value={1}>{SHIFT_LABELS[1]}</option>
                  <option value={2}>{SHIFT_LABELS[2]}</option>
                  <option value={3}>{SHIFT_LABELS[3]}</option>
                </select>
              </div>
              <div>
                <label className="label-text">Round</label>
                <select
                  value={roundNumber}
                  onChange={(e) => {
                    const newRound = Number(e.target.value);
                    setRoundNumber(newRound);
                    if (selectedMachine) {
                      loadScheduleParams(selectedMachine.id, shiftNumber, newRound);
                    }
                  }}
                  className="input-field"
                >
                  <option value={1}>Round 1 ({getRoundWindowLabel(shiftNumber, 1)})</option>
                  <option value={2}>Round 2 ({getRoundWindowLabel(shiftNumber, 2)})</option>
                </select>
              </div>
              <div>
                <label className="label-text">Date</label>
                <input
                  type="date"
                  value={monitoringDate}
                  onChange={(e) => { const d=e.target.value; setMonitoringDate(d); if (selectedMachine) setTimeout(() => loadScheduleParams(selectedMachine.id, shiftNumber, roundNumber), 0); }}
                  className="input-field"
                />
              </div>
            </div>
            {editingRoundId && <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-700">Round {roundNumber} sudah dilakukan. Anda sedang mengedit data yang sama.</div>}
            {!isCurrentShiftOpen() && (
              <div className="rounded-lg bg-slate-100 border border-slate-300 px-3 py-2 text-sm text-slate-600">
                🔒 Round {roundNumber} hanya bisa diisi pukul {getRoundWindowLabel(shiftNumber, roundNumber)}. Saat ini di luar jam tersebut, data terkunci.
              </div>
            )}
          </div>

          {/* Parameters */}
          {params.length === 0 ? (
            <div className="card p-6 text-center">
              <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                No parameters scheduled for this machine in {SHIFT_LABELS[shiftNumber]} Round {roundNumber}. An admin needs to configure the monitoring schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <fieldset disabled={!isCurrentShiftOpen()} className="space-y-4 disabled:opacity-60">
              {params.map((p, idx) => {
                const active = isParamActive(p);
                if (!active) {
                  const trigger = p.dependsOnParameterId ? params.find((x) => x.parameter.id === p.dependsOnParameterId) : null;
                  return (
                    <div key={p.parameter.id} className="card p-4 border-dashed border-slate-200 bg-slate-50/60">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-medium text-slate-500 text-sm">{p.parameter.name}</h3>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Tidak berlaku saat ini — hanya aktif jika {trigger?.parameter.name || 'kondisi terkait'} = "{p.dependsOnValue}"
                          </p>
                        </div>
                        <span className="badge bg-slate-100 text-slate-400 border-slate-200 flex-shrink-0">N/A</span>
                      </div>
                    </div>
                  );
                }
                return (
                <div key={p.parameter.id} className="card p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">
                        {p.parameter.name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {p.parameter.type === 'number' &&
                          p.parameter.min_value !== null &&
                          p.parameter.min_value !== undefined &&
                          p.parameter.max_value !== null &&
                          p.parameter.max_value !== undefined &&
                          `Normal: ${p.parameter.min_value} - ${p.parameter.max_value}`}
                        {p.parameter.unit && ` ${p.parameter.unit}`}
                      </p>
                    </div>
                    {p.value && (
                      <span className={`badge ${getStatusColor(p.status)}`}>
                        {p.status}
                      </span>
                    )}
                  </div>

                  {p.parameter.type === 'boolean' ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateParamValue(idx, 'OK')}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                          p.value === 'OK'
                            ? 'bg-emerald-500 text-white border-emerald-500'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-emerald-300'
                        }`}
                      >
                        OK
                      </button>
                      <button
                        onClick={() => updateParamValue(idx, 'Not OK')}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                          p.value === 'Not OK'
                            ? 'bg-red-500 text-white border-red-500'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-red-300'
                        }`}
                      >
                        Not OK
                      </button>
                    </div>
                  ) : p.parameter.type === 'option' ? (
                    <select
                      value={p.value}
                      onChange={(e) => updateParamValue(idx, e.target.value)}
                      className="input-field"
                    >
                      <option value="">Select...</option>
                      {p.parameter.options.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <div>
                      <input
                        type={p.parameter.type === 'number' ? 'text' : 'text'}
                        inputMode={p.parameter.type === 'number' ? 'decimal' : undefined}
                        value={p.value}
                        onChange={(e) => {
                          if (p.parameter.type === 'number' && !/^-?\d*\.?\d*$/.test(e.target.value)) return;
                          updateParamValue(idx, e.target.value);
                        }}
                        placeholder={`Enter value${p.parameter.unit ? ` (${p.parameter.unit})` : ''}`}
                        className={`input-field ${
                          p.parameter.must_increase && previousValues[p.parameter.id] !== undefined &&
                          p.value !== '' && !isNaN(parseFloat(p.value)) && parseFloat(p.value) < previousValues[p.parameter.id]
                            ? '!border-red-400 !ring-2 !ring-red-100'
                            : ''
                        }`}
                      />
                      {p.parameter.must_increase && previousValues[p.parameter.id] !== undefined && (
                        <p className="text-[11px] text-slate-400 mt-1">
                          Entry sebelumnya: <b>{previousValues[p.parameter.id]}{p.parameter.unit ? ` ${p.parameter.unit}` : ''}</b> — nilai baru harus &ge; ini
                        </p>
                      )}
                    </div>
                  )}

                  <input
                    type="text"
                    value={p.notes}
                    onChange={(e) => updateParamNotes(idx, e.target.value)}
                    placeholder="Notes (optional)"
                    className="input-field mt-3 text-sm"
                  />

                  {/* Photo Upload — only shown for parameters the admin has enabled;
                      still optional even when shown, technician can submit without a photo. */}
                  {p.parameter.photo_required && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-slate-500 mb-1.5">Upload Foto (opsional)</p>
                    <input
                      ref={(el) => { fileInputRefs.current[p.parameter.id] = el; }}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => handleFileSelect(idx, e.target.files)}
                      className="hidden"
                    />
                    {p.existingPhotos.length === 0 && p.photos.length === 0 ? (
                      <div>
                        <button
                          onClick={() => fileInputRefs.current[p.parameter.id]?.click()}
                          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-dashed border-slate-200 text-slate-400 text-sm hover:border-teal-400 hover:text-teal-500 transition-all"
                        >
                          <Camera className="w-4 h-4" />
                          Upload Photos
                        </button>
                        <p className="text-[10px] text-slate-400 mt-1 text-center">Maks. 500KB per foto</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {p.existingPhotos.map((photo) => (
                            <div key={photo.id} className="relative group">
                              <img
                                src={photo.url}
                                alt={photo.file_name}
                                className="w-20 h-20 rounded-lg object-cover border border-teal-200"
                              />
                              <span className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center py-0.5 rounded-b-lg">
                                Tersimpan
                              </span>
                              <button
                                onClick={() => removeExistingPhoto(idx, photo)}
                                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Hapus foto ini"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {p.photos.map((file, photoIdx) => (
                            <div key={photoIdx} className="relative group">
                              <img
                                src={URL.createObjectURL(file)}
                                alt={`Photo ${photoIdx + 1}`}
                                className="w-20 h-20 rounded-lg object-cover border border-slate-200"
                              />
                              <button
                                onClick={() => removePhoto(idx, photoIdx)}
                                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => fileInputRefs.current[p.parameter.id]?.click()}
                          className="text-xs text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
                        >
                          <Upload className="w-3 h-3" />
                          Add more
                        </button>
                      </div>
                    )}
                  </div>
                  )}
                </div>
                );
              })}

              </fieldset>
              {/* General Notes */}
              <div className="card p-5">
                <label className="label-text">General Notes (Optional)</label>
                <textarea
                  value={generalNotes}
                  onChange={(e) => setGeneralNotes(e.target.value)}
                  rows={3}
                  placeholder="Any additional observations about this monitoring round..."
                  className="input-field resize-none"
                />
              </div>

              {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleSubmit}
                  disabled={saving || params.length === 0 || !isCurrentShiftOpen()}
                  className="btn-primary flex-1"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Submit Monitoring
                    </>
                  )}
                </button>
                <button
                  onClick={() => { setSelectedMachine(null); setParams([]); }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
