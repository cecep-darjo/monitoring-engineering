import { useEffect, useState } from 'react';
import {
  ClipboardPlus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Cog,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  getCurrentShift,
  SHIFT_LABELS,
  SHIFT_SHORT,
  type Machine,
  type MonitoringRound,
} from '@/lib/types';
import type { PageKey } from '@/components/Layout';

interface DashboardProps {
  onNavigate: (page: PageKey) => void;
}

export default function Dashboard({ onNavigate }: DashboardProps) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [todayRounds, setTodayRounds] = useState<MonitoringRound[]>([]);
  const [stats, setStats] = useState({ total: 0, normal: 0, warning: 0, abnormal: 0 });
  const [abnormalList, setAbnormalList] = useState<
    { id: string; parameter_name: string; value: string | null; unit: string | null; machine_name: string; shift_number: number; round_number: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const currentShift = getCurrentShift();
  const today = new Date().toISOString().split('T')[0];

  useEffect(() => {
    async function loadData() {
      const [{ data: machinesData }, { data: roundsData }] = await Promise.all([
        supabase.from('machines').select('*').eq('is_active', true).order('name'),
        supabase
          .from('monitoring_rounds')
          .select('*')
          .eq('monitoring_date', today)
          .order('created_at', { ascending: false }),
      ]);

      setMachines(machinesData || []);
      setTodayRounds(roundsData || []);

      if (roundsData && roundsData.length > 0) {
        const roundIds = roundsData.map((r) => r.id);
        const { data: values } = await supabase
          .from('monitoring_values')
          .select('*')
          .in('round_id', roundIds);
        const s = { total: 0, normal: 0, warning: 0, abnormal: 0 };
        const roundById = new Map(roundsData.map((r) => [r.id, r]));
        const abnormal: typeof abnormalList = [];
        (values || []).forEach((v) => {
          s.total++;
          if (v.status === 'normal') s.normal++;
          else if (v.status === 'warning') s.warning++;
          else if (v.status === 'abnormal') {
            s.abnormal++;
            const round = roundById.get(v.round_id);
            if (round) {
              abnormal.push({
                id: v.id,
                parameter_name: v.parameter_name,
                value: v.value,
                unit: v.unit,
                machine_name: round.machine_name,
                shift_number: round.shift_number,
                round_number: round.round_number,
              });
            }
          }
        });
        setStats(s);
        setAbnormalList(abnormal);
      }

      setLoading(false);
    }
    loadData();
  }, [today]);

  const shiftRounds = (shift: number) =>
    todayRounds.filter((r) => r.shift_number === shift);

  const completedCount = todayRounds.filter((r) => r.status === 'completed').length;
  const expectedTotal = machines.length * 6;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <button onClick={() => onNavigate('new-monitoring')} className="btn-primary">
          <ClipboardPlus className="w-4 h-4" />
          New Monitoring
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 flex items-center justify-center">
              <ClipboardPlus className="w-5 h-5 text-teal-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{completedCount}</p>
          <p className="text-slate-500 text-sm">Today's Rounds</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats.normal}</p>
          <p className="text-slate-500 text-sm">Normal Readings</p>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-slate-900">{stats.abnormal}</p>
          <p className="text-slate-500 text-sm">Abnormal</p>
        </div>
      </div>

      {/* Abnormal Today */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          Parameter &amp; Mesin Abnormal Hari Ini
        </h2>
        {abnormalList.length === 0 ? (
          <div className="card p-5 flex items-center gap-3 bg-emerald-50/50 border-emerald-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <p className="text-sm text-emerald-700">Tidak ada pembacaan abnormal tercatat hari ini.</p>
          </div>
        ) : (
          <div className="card divide-y divide-slate-100">
            {abnormalList.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3.5 gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                    <XCircle className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {a.machine_name} &middot; {a.parameter_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {SHIFT_SHORT[a.shift_number]} · Round {a.round_number}
                    </p>
                  </div>
                </div>
                <span className="badge bg-red-50 text-red-700 border-red-200 flex-shrink-0">
                  {a.value ?? '—'}{a.unit ? ` ${a.unit}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Current Shift Banner */}
      <div className="rounded-xl bg-gradient-to-r from-teal-600 to-cyan-700 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-teal-100 text-sm">Current Shift</p>
              <p className="text-xl font-bold">{SHIFT_LABELS[currentShift]}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div>
              <p className="text-teal-100 text-sm">Progress</p>
              <p className="text-xl font-bold">
                {completedCount}/{expectedTotal || '—'}
              </p>
            </div>
            <button
              onClick={() => onNavigate('new-monitoring')}
              className="rounded-lg bg-white/20 backdrop-blur-sm px-4 py-2.5 text-sm font-semibold hover:bg-white/30 transition-all"
            >
              Start Round
            </button>
          </div>
        </div>
      </div>

      {/* Shift Status Grid */}
      <div>
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Today's Shift Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((shift) => {
            const rounds = shiftRounds(shift);
            const completed = rounds.filter((r) => r.status === 'completed').length;
            const isCurrent = shift === currentShift;
            return (
              <div
                key={shift}
                className={`card p-5 ${isCurrent ? 'ring-2 ring-teal-500' : ''}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <h3 className="font-semibold text-slate-900">{SHIFT_SHORT[shift]}</h3>
                  </div>
                  {isCurrent && (
                    <span className="badge bg-teal-50 text-teal-700 border-teal-200">
                      Active
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  {[1, 2].map((round) => {
                    const roundData = rounds.find((r) => r.round_number === round);
                    return (
                      <div
                        key={round}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-sm ${
                          roundData
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-50 text-slate-400'
                        }`}
                      >
                        <span>Round {round}</span>
                        {roundData ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Clock className="w-4 h-4" />
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-slate-400 mt-3">
                  {completed} of {machines.length * 2} machine rounds done
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Active Machines */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Active Machines</h2>
          <span className="text-sm text-slate-400">{machines.length} machines</span>
        </div>
        {machines.length === 0 ? (
          <div className="card p-8 text-center">
            <Cog className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">
              No machines configured yet. An admin needs to add machines before monitoring can begin.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {machines.map((machine) => {
              const machineRounds = todayRounds.filter((r) => r.machine_id === machine.id);
              const done = machineRounds.length;
              return (
                <div
                  key={machine.id}
                  className="card-hover p-5 cursor-pointer"
                  onClick={() => onNavigate('new-monitoring')}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Cog className="w-5 h-5 text-slate-600" />
                    </div>
                    <span
                      className={`badge ${
                        done >= 6
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : done > 0
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}
                    >
                      {done}/6
                    </span>
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">{machine.name}</h3>
                  <p className="text-xs text-slate-400 mt-1">{machine.code}</p>
                  {machine.location && (
                    <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {machine.location}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      {todayRounds.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent Activity</h2>
          <div className="card divide-y divide-slate-100">
            {todayRounds.slice(0, 8).map((round) => (
              <div key={round.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Calendar className="w-4 h-4 text-slate-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {round.machine_name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {SHIFT_SHORT[round.shift_number]} · Round {round.round_number} · {round.technician_name}
                    </p>
                  </div>
                </div>
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
