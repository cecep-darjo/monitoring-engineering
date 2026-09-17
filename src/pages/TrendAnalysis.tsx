import { useEffect, useState } from 'react';
import { TrendingUp, Calendar, Loader2, FileDown, AlertTriangle, Cog } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Machine, Parameter } from '@/lib/types';
import { generateTrendPDF, type TrendPoint } from '@/lib/trendPdfReport';

const MAX_SPAN_DAYS = 30;

export default function TrendAnalysis() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState('');
  const [machineParams, setMachineParams] = useState<Parameter[]>([]);
  const [selectedParam, setSelectedParam] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return d.toLocaleDateString('sv-SE');
  });
  const [dateTo, setDateTo] = useState(() => new Date().toLocaleDateString('sv-SE'));

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('machines').select('*').eq('is_active', true).order('name').then(({ data }) => setMachines(data || []));
  }, []);

  useEffect(() => {
    setSelectedParam('');
    setPoints([]);
    setHasSearched(false);
    if (!selectedMachine) { setMachineParams([]); return; }
    supabase
      .from('machine_parameters')
      .select('parameter:parameters!parameter_id(*)')
      .eq('machine_id', selectedMachine)
      .then(({ data }) => {
        const params = (data || [])
          .map((mp: any) => mp.parameter as Parameter)
          .filter((p) => p && p.type === 'number');
        setMachineParams(params);
      });
  }, [selectedMachine]);

  const selectedParamObj = machineParams.find((p) => p.id === selectedParam) || null;
  const spanDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;

  async function loadTrend() {
    if (!selectedMachine || !selectedParam) {
      setError('Pilih mesin dan parameter terlebih dahulu.');
      return;
    }
    if (dateFrom > dateTo) {
      setError('Tanggal mulai tidak boleh setelah tanggal akhir.');
      return;
    }
    if (spanDays > MAX_SPAN_DAYS) {
      setError(`Rentang periode maksimal ${MAX_SPAN_DAYS} hari (saat ini ${spanDays} hari).`);
      return;
    }
    setError(null);
    setLoading(true);
    setHasSearched(true);

    const { data: rounds } = await supabase
      .from('monitoring_rounds')
      .select('id, monitoring_date, shift_number, round_number')
      .eq('machine_id', selectedMachine)
      .gte('monitoring_date', dateFrom)
      .lte('monitoring_date', dateTo)
      .order('monitoring_date').order('shift_number').order('round_number');

    const roundIds = (rounds || []).map((r) => r.id);
    const { data: values } = roundIds.length
      ? await supabase.from('monitoring_values').select('*').eq('parameter_id', selectedParam).in('round_id', roundIds)
      : { data: [] };

    const valueByRound = new Map((values || []).map((v: any) => [v.round_id, v]));
    const built: TrendPoint[] = [];
    for (const r of rounds || []) {
      const v = valueByRound.get(r.id);
      if (!v || v.value === null || v.value === '' || isNaN(parseFloat(v.value))) continue;
      const dateLabel = new Date(r.monitoring_date + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      built.push({
        roundId: r.id,
        label: `${dateLabel} S${r.shift_number}R${r.round_number}`,
        date: r.monitoring_date,
        shift: r.shift_number,
        round: r.round_number,
        value: parseFloat(v.value),
        status: v.status,
        notes: v.notes,
      });
    }
    setPoints(built);
    setLoading(false);
  }

  async function handleExportPDF() {
    if (!selectedMachine || !selectedParamObj || points.length === 0) return;
    const machine = machines.find((m) => m.id === selectedMachine);
    if (!machine) return;
    setExporting(true);
    try {
      generateTrendPDF({ machine, parameter: selectedParamObj, dateFrom, dateTo, points });
    } finally {
      setExporting(false);
    }
  }

  const normalCount = points.filter((p) => p.status === 'normal').length;
  const warningCount = points.filter((p) => p.status === 'warning').length;
  const abnormalCount = points.filter((p) => p.status === 'abnormal').length;

  // --- inline SVG chart ---
  function renderChart() {
    if (points.length === 0) return null;
    const vw = 900, vh = 300, padL = 50, padR = 20, padT = 20, padB = 40;
    const plotW = vw - padL - padR, plotH = vh - padT - padB;
    const values = points.map((p) => p.value);
    let minV = Math.min(...values), maxV = Math.max(...values);
    if (selectedParamObj?.min_value != null) minV = Math.min(minV, selectedParamObj.min_value);
    if (selectedParamObj?.max_value != null) maxV = Math.max(maxV, selectedParamObj.max_value);
    const pad = (maxV - minV) * 0.15 || 1;
    const yMin = minV - pad, yMax = maxV + pad;
    const xFor = (i: number) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const yFor = (v: number) => padT + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const statusColor: Record<string, string> = { normal: '#059669', warning: '#d97706', abnormal: '#dc2626' };
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.value)}`).join(' ');
    const labelStep = Math.max(1, Math.ceil(points.length / 10));

    return (
      <svg viewBox={`0 0 ${vw} ${vh}`} className="w-full h-auto">
        {selectedParamObj?.min_value != null && selectedParamObj?.max_value != null && (
          <rect
            x={padL} y={yFor(selectedParamObj.max_value)}
            width={plotW} height={yFor(selectedParamObj.min_value) - yFor(selectedParamObj.max_value)}
            fill="#ecfdf5"
          />
        )}
        {[0, 1, 2, 3, 4].map((t) => {
          const val = yMin + (t / 4) * (yMax - yMin);
          const y = yFor(val);
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={vw - padR} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} fontSize={9} fill="#94a3b8" textAnchor="end">{val.toFixed(1)}</text>
            </g>
          );
        })}
        <path d={linePath} fill="none" stroke="#1b7fbd" strokeWidth={1.5} />
        {points.map((p, i) => (
          <circle key={p.roundId} cx={xFor(i)} cy={yFor(p.value)} r={3} fill={statusColor[p.status]} />
        ))}
        {points.map((p, i) =>
          i % labelStep === 0 ? (
            <text key={p.roundId} x={xFor(i)} y={vh - padB + 14} fontSize={8} fill="#94a3b8" textAnchor="middle">
              {p.label}
            </text>
          ) : null
        )}
      </svg>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-teal-600" />
          Trend Parameter
        </h1>
        <p className="text-slate-500 text-sm mt-1">Lihat tren nilai parameter dari waktu ke waktu, dan export sebagai laporan PDF.</p>
      </div>

      <div className="card p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label-text">Mesin</label>
            <select value={selectedMachine} onChange={(e) => setSelectedMachine(e.target.value)} className="input-field">
              <option value="">Pilih mesin...</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text">Parameter</label>
            <select value={selectedParam} onChange={(e) => setSelectedParam(e.target.value)} disabled={!selectedMachine} className="input-field">
              <option value="">Pilih parameter...</option>
              {machineParams.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.unit ? ` (${p.unit})` : ''}</option>
              ))}
            </select>
            {selectedMachine && machineParams.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">Mesin ini belum punya parameter numerik terdaftar.</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-text">Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-field" />
          </div>
          <div>
            <label className="label-text">Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-field" />
          </div>
        </div>
        <p className="text-xs text-slate-400 flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Rentang: {spanDays > 0 ? spanDays : '-'} hari (min 1, maks {MAX_SPAN_DAYS} hari)
        </p>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex justify-end">
          <button onClick={loadTrend} disabled={loading} className="btn-primary">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
            Tampilkan Trend
          </button>
        </div>
      </div>

      {hasSearched && !loading && (
        points.length === 0 ? (
          <div className="card p-12 text-center">
            <Cog className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Tidak ada data pembacaan untuk kombinasi mesin/parameter/periode ini.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="card p-4">
                <p className="text-xs text-slate-400 mb-1">Total Pembacaan</p>
                <p className="text-2xl font-bold text-slate-900">{points.length}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-slate-400 mb-1">Normal</p>
                <p className="text-2xl font-bold text-emerald-600">{normalCount}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-slate-400 mb-1">Warning</p>
                <p className="text-2xl font-bold text-amber-600">{warningCount}</p>
              </div>
              <div className="card p-4">
                <p className="text-xs text-slate-400 mb-1">Abnormal</p>
                <p className="text-2xl font-bold text-red-600">{abnormalCount}</p>
              </div>
            </div>

            <div className="card p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-semibold text-slate-900 text-sm">
                  {selectedParamObj?.name} {selectedParamObj?.unit && `(${selectedParamObj.unit})`}
                </h2>
                <button onClick={handleExportPDF} disabled={exporting} className="btn-primary">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                  Generate PDF
                </button>
              </div>
              {renderChart()}
            </div>

            {(warningCount + abnormalCount) > 0 && (
              <div className="card p-5">
                <h2 className="font-semibold text-slate-900 text-sm mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Pembacaan Menyimpang
                </h2>
                <div className="space-y-2">
                  {points.filter((p) => p.status !== 'normal').map((p) => (
                    <div key={p.roundId} className="flex items-center justify-between text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div>
                        <span className="font-medium text-slate-800">{p.label}</span>
                        <span className="text-slate-400 ml-2">{p.value}{selectedParamObj?.unit}</span>
                        {p.notes && <span className="text-slate-400 ml-2">· {p.notes}</span>}
                      </div>
                      <span className={`badge ${p.status === 'abnormal' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                        {p.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
