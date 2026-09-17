/*
# Add Schedule System and Username Column

## Overview
1. Adds `username` column to profiles for username-based login
2. Creates `schedules` table — defines which machines are monitored per shift+round
3. Creates `schedule_parameters` table — defines which parameters to record per scheduled machine

## New Tables
- `schedules`: machine_id + shift_number + round_number (unique combination), is_active
- `schedule_parameters`: links schedule_id to parameter_id with sort_order

## Modified Tables
- `profiles`: added `username` text column (unique, nullable for backward compat)

## Security
- RLS enabled on new tables
- All authenticated users can read schedules
- Only admin can create/update/delete schedules and schedule_parameters
*/

-- Add username column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username) WHERE username IS NOT NULL;

-- Update handle_new_user to also store username
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_admin boolean;
  v_username text;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') INTO has_admin;
  v_username := NEW.raw_user_meta_data->>'username';
  INSERT INTO public.profiles (id, email, full_name, role, username)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE WHEN has_admin THEN 'technician' ELSE 'admin' END,
    v_username
  );
  RETURN NEW;
END;
$$;

-- ============================================================
-- SCHEDULES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  shift_number int NOT NULL CHECK (shift_number IN (1, 2, 3)),
  round_number int NOT NULL CHECK (round_number IN (1, 2)),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(machine_id, shift_number, round_number)
);

ALTER TABLE schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedules_select_all" ON schedules;
CREATE POLICY "schedules_select_all"
ON schedules FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "schedules_admin_insert" ON schedules;
CREATE POLICY "schedules_admin_insert"
ON schedules FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "schedules_admin_update" ON schedules;
CREATE POLICY "schedules_admin_update"
ON schedules FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "schedules_admin_delete" ON schedules;
CREATE POLICY "schedules_admin_delete"
ON schedules FOR DELETE TO authenticated
USING (is_admin());

-- ============================================================
-- SCHEDULE_PARAMETERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS schedule_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE(schedule_id, parameter_id)
);

ALTER TABLE schedule_parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedule_params_select_all" ON schedule_parameters;
CREATE POLICY "schedule_params_select_all"
ON schedule_parameters FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "schedule_params_admin_insert" ON schedule_parameters;
CREATE POLICY "schedule_params_admin_insert"
ON schedule_parameters FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "schedule_params_admin_update" ON schedule_parameters;
CREATE POLICY "schedule_params_admin_update"
ON schedule_parameters FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "schedule_params_admin_delete" ON schedule_parameters;
CREATE POLICY "schedule_params_admin_delete"
ON schedule_parameters FOR DELETE TO authenticated
USING (is_admin());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_schedules_shift_round ON schedules(shift_number, round_number);
CREATE INDEX IF NOT EXISTS idx_schedules_machine ON schedules(machine_id);
CREATE INDEX IF NOT EXISTS idx_schedule_parameters_schedule ON schedule_parameters(schedule_id);
