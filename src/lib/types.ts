export type UserRole = 'admin' | 'technician';

export interface Profile {
  id: string;
  email: string;
  username: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface Machine {
  id: string;
  name: string;
  code: string;
  location: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export type ParameterType = 'number' | 'text' | 'boolean' | 'option';

export interface Parameter {
  id: string;
  name: string;
  unit: string | null;
  type: ParameterType;
  options: string[];
  min_value: number | null;
  max_value: number | null;
  is_active: boolean;
  photo_required: boolean;
  must_increase: boolean;
  created_at: string;
}

export interface MachineParameter {
  id: string;
  machine_id: string;
  parameter_id: string;
  sort_order: number;
  parameter?: Parameter;
}

export type RoundStatus = 'pending' | 'completed';

export interface MonitoringRound {
  id: string;
  technician_id: string | null;
  technician_name: string;
  machine_id: string;
  machine_name: string;
  shift_number: number;
  round_number: number;
  monitoring_date: string;
  status: RoundStatus;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export type ValueStatus = 'normal' | 'warning' | 'abnormal';

export interface MonitoringValue {
  id: string;
  round_id: string;
  parameter_id: string;
  parameter_name: string;
  value: string | null;
  unit: string | null;
  status: ValueStatus;
  notes: string | null;
  created_at: string;
}

export interface MonitoringPhoto {
  id: string;
  round_id: string;
  parameter_id: string | null;
  storage_path: string;
  file_name: string | null;
  created_at: string;
}

export interface RoundWithDetails extends MonitoringRound {
  values?: MonitoringValue[];
  photos?: MonitoringPhoto[];
}

export interface Schedule {
  id: string;
  machine_id: string;
  shift_number: number;
  round_number: number;
  is_active: boolean;
  created_at: string;
}

export interface ScheduleParameter {
  id: string;
  schedule_id: string;
  parameter_id: string;
  sort_order: number;
  depends_on_parameter_id: string | null;
  depends_on_value: string | null;
  parameter?: Parameter;
}

export interface WorkRequest {
  id: string;
  technician_id: string | null;
  technician_name: string;
  title: string;
  requested_by: string;
  description: string;
  status: 'completed' | 'in_progress';
  created_at: string;
}

export interface WorkRequestPhoto {
  id: string;
  work_request_id: string;
  storage_path: string;
  file_name: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: 'create' | 'update' | 'delete' | 'login' | 'login_failed' | 'logout';
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, any> | null;
  new_data: Record<string, any> | null;
  created_at: string;
}

export const SHIFT_LABELS: Record<number, string> = {
  1: 'Shift 1 (07:00 - 15:00)',
  2: 'Shift 2 (15:00 - 23:00)',
  3: 'Shift 3 (23:00 - 07:00)',
};

export const SHIFT_SHORT: Record<number, string> = {
  1: 'Shift 1',
  2: 'Shift 2',
  3: 'Shift 3',
};

export function getCurrentShift(): number {
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 15) return 1;
  if (hour >= 15 && hour < 23) return 2;
  return 3;
}

// Per-round entry windows:
// Shift 1: Round 1 = 07-11, Round 2 = 11-15
// Shift 2: Round 1 = 15-19, Round 2 = 19-23
// Shift 3: Round 1 = 23-03, Round 2 = 03-07
export const ROUND_WINDOWS: Record<number, Record<number, { start: number; end: number }>> = {
  1: { 1: { start: 7, end: 11 }, 2: { start: 11, end: 15 } },
  2: { 1: { start: 15, end: 19 }, 2: { start: 19, end: 23 } },
  3: { 1: { start: 23, end: 3 }, 2: { start: 3, end: 7 } },
};

export function getCurrentShiftAndRound(): { shift: number; round: number } {
  const hour = new Date().getHours();
  for (const shift of [1, 2, 3]) {
    for (const round of [1, 2]) {
      const w = ROUND_WINDOWS[shift][round];
      const inWindow = w.start < w.end
        ? hour >= w.start && hour < w.end
        : hour >= w.start || hour < w.end; // wraps past midnight
      if (inWindow) return { shift, round };
    }
  }
  return { shift: 3, round: 2 };
}

export function getCurrentRound(): number {
  return getCurrentShiftAndRound().round;
}

export function getRoundWindowLabel(shift: number, round: number): string {
  const w = ROUND_WINDOWS[shift]?.[round];
  if (!w) return '';
  const fmt = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return `${fmt(w.start)}-${fmt(w.end)}`;
}

export function getStatusColor(status: ValueStatus): string {
  switch (status) {
    case 'normal':
      return 'bg-emerald-100 text-emerald-700 border-emerald-300';
    case 'warning':
      return 'bg-amber-100 text-amber-700 border-amber-300';
    case 'abnormal':
      return 'bg-red-100 text-red-700 border-red-300';
    default:
      return 'bg-gray-100 text-gray-700 border-gray-300';
  }
}

export function evaluateValueStatus(
  value: string,
  param: Parameter
): ValueStatus {
  if (param.type !== 'number' || !value) return 'normal';
  const numVal = parseFloat(value);
  if (isNaN(numVal)) return 'normal';

  const hasMin = param.min_value !== null && param.min_value !== undefined;
  const hasMax = param.max_value !== null && param.max_value !== undefined;

  const min = param.min_value;
  const max = param.max_value;

  if (hasMin && hasMax && min !== null && max !== null) {
    const range = max - min;
    const lowerWarn = min - range * 0.1;
    const upperWarn = max + range * 0.1;
    if (numVal < lowerWarn || numVal > upperWarn) return 'abnormal';
    if (numVal < min || numVal > max) return 'warning';
  } else if (hasMin && min !== null) {
    if (numVal < min - Math.abs(min) * 0.1) return 'abnormal';
    if (numVal < min) return 'warning';
  } else if (hasMax && max !== null) {
    if (numVal > max + Math.abs(max) * 0.1) return 'abnormal';
    if (numVal > max) return 'warning';
  }

  return 'normal';
}
