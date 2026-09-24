import { useEffect, useState } from 'react';
import {
  Settings,
  Plus,
  Edit2,
  Trash2,
  X,
  Search,
  Hash,
  Type,
  ToggleLeft,
  List,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Parameter, ParameterType } from '@/lib/types';

const TYPE_ICONS: Record<ParameterType, typeof Hash> = {
  number: Hash,
  text: Type,
  boolean: ToggleLeft,
  option: List,
};

const OPTION_PRESETS: { label: string; options: string[] }[] = [
  { label: 'OK / NG', options: ['OK', 'NG'] },
  { label: 'Bersih / Kotor', options: ['Bersih', 'Kotor'] },
  { label: 'Baik / Rusak', options: ['Baik', 'Rusak'] },
  { label: 'Ada / Tidak Ada', options: ['Ada', 'Tidak Ada'] },
  { label: 'Normal / Abnormal', options: ['Normal', 'Abnormal'] },
  { label: 'Kering / Basah', options: ['Kering', 'Basah'] },
];

export default function AdminParameters() {
  const [params, setParams] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Parameter | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [type, setType] = useState<ParameterType>('number');
  const [options, setOptions] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [mustIncrease, setMustIncrease] = useState(false);
  const [showMinusButton, setShowMinusButton] = useState(false);

  useEffect(() => {
    loadParams();
  }, []);

  async function loadParams() {
    setLoading(true);
    const { data } = await supabase
      .from('parameters')
      .select('*')
      .order('created_at', { ascending: false });
    setParams(data || []);
    setLoading(false);
  }

  function openCreate() {
    setEditing(null);
    setName('');
    setUnit('');
    setType('number');
    setOptions('');
    setMinValue('');
    setMaxValue('');
    setIsActive(true);
    setPhotoRequired(false);
    setMustIncrease(false);
    setShowMinusButton(false);
    setError(null);
    setShowForm(true);
  }

  function openEdit(param: Parameter) {
    setEditing(param);
    setName(param.name);
    setUnit(param.unit || '');
    setType(param.type);
    setOptions(param.options.join(', '));
    setMinValue(param.min_value?.toString() || '');
    setMaxValue(param.max_value?.toString() || '');
    setIsActive(param.is_active);
    setPhotoRequired(param.photo_required);
    setMustIncrease(param.must_increase);
    setShowMinusButton(param.show_minus_button ?? false);
    setError(null);
    setShowForm(true);
  }

  async function handleSave() {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      unit: unit.trim() || null,
      type,
      options: type === 'option' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
      min_value: type === 'number' && minValue ? parseFloat(minValue) : null,
      max_value: type === 'number' && maxValue ? parseFloat(maxValue) : null,
      is_active: isActive,
      photo_required: photoRequired,
      must_increase: type === 'number' ? mustIncrease : false,
      show_minus_button: type === 'number' ? showMinusButton : false,
    };

    if (editing) {
      const { error: err } = await supabase.from('parameters').update(payload).eq('id', editing.id);
      if (err) setError(err.message);
    } else {
      const { error: err } = await supabase.from('parameters').insert(payload);
      if (err) setError(err.message);
    }

    if (!error) {
      setShowForm(false);
      await loadParams();
    }
    setSaving(false);
  }

  async function handleDelete(param: Parameter) {
    if (!confirm(`Delete parameter "${param.name}"? This will remove it from all machines.`)) return;
    const { error: err } = await supabase.from('parameters').delete().eq('id', param.id);
    if (err) {
      alert(err.message);
      return;
    }
    await loadParams();
  }

  const filtered = params.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Parameters</h1>
          <p className="text-slate-500 text-sm mt-1">Manage monitoring parameters that technicians can record</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" />
          Add Parameter
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parameters..."
          className="input-field pl-10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Settings className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">
            {params.length === 0 ? 'No parameters yet. Click "Add Parameter" to get started.' : 'No parameters match your search.'}
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {filtered.map((param) => {
            const Icon = TYPE_ICONS[param.type];
            return (
              <div key={param.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4.5 h-4.5 w-[18px] h-[18px] text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{param.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      <span className="capitalize">{param.type}</span>
                      {param.unit && ` · Unit: ${param.unit}`}
                      {param.type === 'number' && param.min_value !== null && param.min_value !== undefined && param.max_value !== null && param.max_value !== undefined &&
                        ` · Range: ${param.min_value} - ${param.max_value}`}
                      {param.type === 'option' && param.options.length > 0 &&
                        ` · Options: ${param.options.join(', ')}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {param.photo_required && (
                    <span className="badge bg-amber-50 text-amber-700 border-amber-200">Wajib Foto</span>
                  )}
                  {param.must_increase && (
                    <span className="badge bg-blue-50 text-blue-700 border-blue-200">Harus Naik</span>
                  )}
                  {param.show_minus_button && (
                    <span className="badge bg-purple-50 text-purple-700 border-purple-200">Tombol -</span>
                  )}
                  <span
                    className={`badge ${
                      param.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'
                    }`}
                  >
                    {param.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => openEdit(param)} className="btn-ghost text-xs border border-slate-200 px-2.5">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(param)} className="btn-ghost text-xs border border-slate-200 px-2.5 text-red-500 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 sticky top-0 bg-white">
              <h2 className="font-bold text-slate-900">{editing ? 'Edit Parameter' : 'Add Parameter'}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label-text">Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} className="input-field" placeholder="e.g. Temperature" />
              </div>
              <div>
                <label className="label-text">Unit (optional)</label>
                <input value={unit} onChange={(e) => setUnit(e.target.value)} className="input-field" placeholder="e.g. °C, bar, RPM" />
              </div>
              <div>
                <label className="label-text">Type</label>
                <select value={type} onChange={(e) => setType(e.target.value as ParameterType)} className="input-field">
                  <option value="number">Number</option>
                  <option value="text">Text</option>
                  <option value="boolean">Boolean (OK / Not OK)</option>
                  <option value="option">Multiple Choice (dropdown)</option>
                </select>
              </div>

              <div>
                <label className="label-text">Quick Preset</label>
                <p className="text-xs text-slate-400 -mt-0.5 mb-1.5">Klik untuk langsung isi tipe Multiple Choice dengan opsi umum</p>
                <div className="flex flex-wrap gap-1.5">
                  {OPTION_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        setType('option');
                        setOptions(preset.options.join(', '));
                      }}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        type === 'option' && options === preset.options.join(', ')
                          ? 'bg-teal-50 border-teal-300 text-teal-700 font-medium'
                          : 'border-slate-200 text-slate-500 hover:border-teal-300 hover:text-teal-600'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {type === 'number' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label-text">Min Normal</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={minValue}
                      onChange={(e) => { if (/^-?\d*\.?\d*$/.test(e.target.value)) setMinValue(e.target.value); }}
                      className="input-field"
                      placeholder="e.g. -20"
                    />
                  </div>
                  <div>
                    <label className="label-text">Max Normal</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={maxValue}
                      onChange={(e) => { if (/^-?\d*\.?\d*$/.test(e.target.value)) setMaxValue(e.target.value); }}
                      className="input-field"
                      placeholder="e.g. 80"
                    />
                  </div>
                </div>
              )}

              {type === 'option' && (
                <div>
                  <label className="label-text">Multiple Choice Options (comma-separated)</label>
                  <input value={options} onChange={(e) => setOptions(e.target.value)} className="input-field" placeholder="e.g. Bersih, Kotor" />
                  <p className="text-xs text-slate-400 mt-1">Pisahkan tiap opsi dengan koma, atau pakai Quick Preset di atas</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                  <span className="text-sm text-slate-700">Active</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={photoRequired} onChange={(e) => setPhotoRequired(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                  <span className="text-sm text-slate-700">Wajib Upload Foto</span>
                </label>
                {type === 'number' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={mustIncrease} onChange={(e) => setMustIncrease(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                    <span className="text-sm text-slate-700">Nilai Harus Selalu Naik (mis. Running Hours)</span>
                  </label>
                )}
                {type === 'number' && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={showMinusButton} onChange={(e) => setShowMinusButton(e.target.checked)} className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                    <span className="text-sm text-slate-700">Tampilkan Tombol Minus (-) di Form Monitoring</span>
                  </label>
                )}
                <p className="text-xs text-slate-400 pl-6">
                  Kalau dicentang, kolom upload foto akan ditampilkan untuk parameter ini saat monitoring (tetap opsional, tidak wajib diisi). Kalau tidak dicentang, kolom upload foto tidak akan muncul sama sekali.
                </p>
                {type === 'number' && (
                  <p className="text-xs text-slate-400 pl-6">
                    "Nilai Harus Selalu Naik": entry baru akan DITOLAK kalau nilainya lebih kecil dari entry terakhir untuk parameter ini di mesin yang sama. Cocok untuk parameter akumulatif seperti running hours / counter.
                  </p>
                )}
                {type === 'number' && (
                  <p className="text-xs text-slate-400 pl-6">
                    "Tombol Minus": membantu perangkat HP yang keyboard numeriknya tidak punya tombol '-' agar teknisi tetap bisa input nilai negatif.
                  </p>
                )}
              </div>

              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-200 sticky bottom-0 bg-white">
              <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
