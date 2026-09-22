import { useEffect, useState } from 'react';
import {
  FileText,
  Download,
  Loader2,
  Calendar,
  Cog,
  Filter,
  X,
  Mail,
} from 'lucide-react';
import { supabase, STORAGE_BUCKET } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import {
  SHIFT_SHORT,
  SHIFT_LABELS,
  getStatusColor,
  type MonitoringRound,
  type MonitoringValue,
  type MonitoringPhoto,
  type Machine,
} from '@/lib/types';
import { generateReportPDF } from '@/lib/pdfReport';

export default function Reports() {
  const { profile } = useAuth();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string>('all');
  const [reportDate, setReportDate] = useState(() => {
    // Same "yesterday" rule as Dashboard/New Monitoring: before 07:00 the just-finished
    // night shift's rounds are still stored under yesterday's monitoring_date, so default
    // here to whichever date a full-day report would actually need right now.
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    if (now.getHours() < 7) local.setDate(local.getDate() - 1);
    return local.toISOString().split('T')[0];
  });
  const [shiftFilter, setShiftFilter] = useState<string>('all');
  const [rounds, setRounds] = useState<MonitoringRound[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    supabase.from('machines').select('*').order('name').then(({ data }) => {
      setMachines(data || []);
    });
  }, []);

  async function loadRounds() {
    setLoading(true);
    setHasGenerated(false);
    let query = supabase
      .from('monitoring_rounds')
      .select('*')
      .eq('monitoring_date', reportDate)
      .order('shift_number')
      .order('round_number');

    if (selectedMachine !== 'all') query = query.eq('machine_id', selectedMachine);
    if (shiftFilter !== 'all') query = query.eq('shift_number', Number(shiftFilter));

    const { data } = await query;
    setRounds(data || []);
    setLoading(false);
  }

  async function handleGeneratePDF() {
    if (rounds.length === 0) return;
    setGenerating(true);

    try {
      const roundIds = rounds.map((r) => r.id);
      const dayStart = new Date(`${reportDate}T00:00:00+07:00`).toISOString();
      const dayEnd = new Date(new Date(`${reportDate}T00:00:00+07:00`).getTime() + 24 * 60 * 60 * 1000).toISOString();

      const [{ data: values }, { data: photos }, { data: parameters }, { data: workRequests }, { data: schedules }] = await Promise.all([
        supabase.from('monitoring_values').select('*').in('round_id', roundIds),
        supabase.from('monitoring_photos').select('*').in('round_id', roundIds),
        supabase.from('parameters').select('*'),
        supabase.from('work_requests').select('*').gte('created_at', dayStart).lt('created_at', dayEnd).order('created_at'),
        supabase.from('schedules').select('machine_id, shift_number, round_number').eq('is_active', true),
      ]);

      const photoUrls: Record<string, string> = {};
      for (const photo of photos || []) {
        const { data } = await supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(photo.storage_path);
        photoUrls[photo.id] = data.publicUrl;
      }

      const workRequestIds = (workRequests || []).map((w) => w.id);
      const { data: workRequestPhotos } = workRequestIds.length
        ? await supabase.from('work_request_photos').select('*').in('work_request_id', workRequestIds)
        : { data: [] };
      const workRequestPhotoUrls: Record<string, string> = {};
      for (const photo of workRequestPhotos || []) {
        const { data } = await supabase.storage.from(STORAGE_BUCKET).getPublicUrl(photo.storage_path);
        workRequestPhotoUrls[photo.id] = data.publicUrl;
      }

      await generateReportPDF({
        date: reportDate,
        rounds: rounds,
        values: values || [],
        photos: photos || [],
        photoUrls,
        parameters: parameters || [],
        workRequests: workRequests || [],
        workRequestPhotos: workRequestPhotos || [],
        workRequestPhotoUrls,
        schedules: schedules || [],
        machineFilter: selectedMachine === 'all' ? null : machines.find((m) => m.id === selectedMachine)?.name || null,
        shiftFilter: shiftFilter === 'all' ? null : Number(shiftFilter),
      });

      setHasGenerated(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate PDF';
      alert(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendEmail() {
    if (!profile) return;
    setSendingEmail(true);
    setEmailResult(null);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-shift-report`;
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ date: reportDate, requestedBy: profile.id }),
      });
      const result = await response.json();
      if (!response.ok || result.error) {
        const detail = result.step ? ` [step: ${result.step}]` : '';
        throw new Error((result.error || `Request failed (${response.status})`) + detail);
      }
      if (result.skipped) {
        setEmailResult({ ok: false, message: result.skipped === 'no active recipients'
          ? 'Belum ada email penerima terdaftar. Tambahkan dulu di halaman Report Email.'
          : `Tidak ada data monitoring untuk tanggal ${reportDate}.` });
      } else {
        setEmailResult({ ok: true, message: `Report berhasil dikirim ke ${result.sentTo} email penerima.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim report ke email';
      setEmailResult({ ok: false, message: msg });
    }
    setSendingEmail(false);
  }

  const stats = {
    total: rounds.length,
    shifts: new Set(rounds.map((r) => r.shift_number)).size,
    machines: new Set(rounds.map((r) => r.machine_id)).size,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Shift Reports</h1>
        <p className="text-slate-500 text-sm mt-1">
          Generate PDF reports for monitoring rounds by date and shift
        </p>
      </div>

      {/* Filter Card */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Filter className="w-4 h-4" />
          Report Filters
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="label-text">Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={reportDate}
                onChange={(e) => { setReportDate(e.target.value); setRounds([]); setHasGenerated(false); }}
                className="input-field pl-10"
              />
            </div>
          </div>
          <div>
            <label className="label-text">Machine</label>
            <div className="relative">
              <Cog className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <select
                value={selectedMachine}
                onChange={(e) => { setSelectedMachine(e.target.value); setRounds([]); setHasGenerated(false); }}
                className="input-field pl-10"
              >
                <option value="all">All Machines</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label-text">Shift</label>
            <select
              value={shiftFilter}
              onChange={(e) => { setShiftFilter(e.target.value); setRounds([]); setHasGenerated(false); }}
              className="input-field"
            >
              <option value="all">All Shifts</option>
              <option value="1">{SHIFT_LABELS[1]}</option>
              <option value="2">{SHIFT_LABELS[2]}</option>
              <option value="3">{SHIFT_LABELS[3]}</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={loadRounds} disabled={!reportDate || loading} className="btn-primary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
            Load Rounds
          </button>
        </div>
      </div>

      {/* Manual email trigger — always sends the full-day report (all machines, all shifts) for the selected date */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Kirim Report ke Email
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Mengirim laporan lengkap 24 jam (Shift 1-3) untuk tanggal {reportDate || '-'} ke semua email terdaftar, terlepas dari filter Machine/Shift di atas.
            </p>
          </div>
          <button onClick={handleSendEmail} disabled={!reportDate || sendingEmail} className="btn-primary whitespace-nowrap">
            {sendingEmail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {sendingEmail ? 'Mengirim...' : 'Kirim Sekarang'}
          </button>
        </div>
        {emailResult && (
          <div className={`text-sm rounded-lg px-3 py-2 border ${emailResult.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-amber-700 bg-amber-50 border-amber-200'}`}>
            {emailResult.message}
          </div>
        )}
      </div>

      {/* Results */}
      {rounds.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-xs text-slate-500">Total Rounds</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{stats.shifts}</p>
              <p className="text-xs text-slate-500">Shifts Covered</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{stats.machines}</p>
              <p className="text-xs text-slate-500">Machines Monitored</p>
            </div>
          </div>

          <div className="card divide-y divide-slate-100">
            {rounds.map((round) => (
              <div key={round.id} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center flex-shrink-0">
                    <Cog className="w-4 h-4 text-teal-600" />
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
                <span className="badge bg-emerald-50 text-emerald-700 border-emerald-200 flex-shrink-0">
                  Completed
                </span>
              </div>
            ))}
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleGeneratePDF}
              disabled={generating}
              className="btn-primary px-8 py-3 text-base"
            >
              {generating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <Download className="w-5 h-5" />
                  Download PDF Report
                </>
              )}
            </button>
          </div>

          {hasGenerated && !generating && (
            <div className="card p-4 text-center text-sm text-emerald-700 bg-emerald-50 border-emerald-200 animate-fade-in">
              PDF report has been downloaded successfully.
            </div>
          )}
        </>
      )}

      {rounds.length === 0 && !loading && reportDate && (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            No monitoring rounds found for the selected filters. Adjust the filters and click "Load Rounds".
          </p>
        </div>
      )}
    </div>
  );
}
