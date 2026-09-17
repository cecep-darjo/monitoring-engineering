/*
# Equipment Monitoring Schema

## Overview
Creates a complete 24-hour equipment monitoring system for technicians working in 3 shifts
(2 monitoring rounds per shift). Includes machines, configurable parameters, monitoring logs
with photo uploads, and role-based access (admin/technician).

## New Tables
1. `profiles` — extends auth.users with role (admin/technician), full name, active status
2. `machines` — equipment being monitored (name, code, location, description)
3. `parameters` — configurable monitoring parameters (name, unit, type, normal range)
4. `machine_parameters` — many-to-many link between machines and parameters with sort order
5. `monitoring_rounds` — a monitoring session (technician + machine + shift + round + date)
6. `monitoring_values` — individual parameter readings within a round
7. `monitoring_photos` — photos attached to a round (stored in Supabase Storage)

## Security
- RLS enabled on all tables
- `is_admin()` SECURITY DEFINER function checks caller's profile role
- All tables readable by authenticated users
- Write access restricted: admin-only for machines/parameters/config; any authenticated
  technician can create monitoring data; only creator or admin can modify/delete it
- Storage bucket `monitoring-photos` created with authenticated read/write policies

## Triggers
- `handle_new_user()` — auto-creates a profile when a user signs up via auth.users,
  and assigns 'admin' role to the very first user (bootstrap), 'technician' thereafter
*/

-- ============================================================
-- PROFILES TABLE (must exist before is_admin function)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'technician' CHECK (role IN ('admin', 'technician')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- HELPER FUNCTION: is_admin
-- ============================================================
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON profiles;
CREATE POLICY "profiles_select_own_or_admin"
ON profiles FOR SELECT TO authenticated
USING (auth.uid() = id OR is_admin());

DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON profiles;
CREATE POLICY "profiles_update_own_or_admin"
ON profiles FOR UPDATE TO authenticated
USING (auth.uid() = id OR is_admin())
WITH CHECK (auth.uid() = id OR is_admin());

DROP POLICY IF EXISTS "profiles_admin_insert" ON profiles;
CREATE POLICY "profiles_admin_insert"
ON profiles FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "profiles_admin_delete" ON profiles;
CREATE POLICY "profiles_admin_delete"
ON profiles FOR DELETE TO authenticated
USING (is_admin());

-- ============================================================
-- HANDLE NEW USER TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_admin boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') INTO has_admin;
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    CASE WHEN has_admin THEN 'technician' ELSE 'admin' END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- MACHINES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS machines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  location text,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE machines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "machines_select_all" ON machines;
CREATE POLICY "machines_select_all"
ON machines FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "machines_admin_insert" ON machines;
CREATE POLICY "machines_admin_insert"
ON machines FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "machines_admin_update" ON machines;
CREATE POLICY "machines_admin_update"
ON machines FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "machines_admin_delete" ON machines;
CREATE POLICY "machines_admin_delete"
ON machines FOR DELETE TO authenticated
USING (is_admin());

-- ============================================================
-- PARAMETERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text,
  type text NOT NULL DEFAULT 'number' CHECK (type IN ('number', 'text', 'boolean', 'option')),
  options text[] NOT NULL DEFAULT '{}',
  min_value numeric,
  max_value numeric,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parameters_select_all" ON parameters;
CREATE POLICY "parameters_select_all"
ON parameters FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "parameters_admin_insert" ON parameters;
CREATE POLICY "parameters_admin_insert"
ON parameters FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "parameters_admin_update" ON parameters;
CREATE POLICY "parameters_admin_update"
ON parameters FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "parameters_admin_delete" ON parameters;
CREATE POLICY "parameters_admin_delete"
ON parameters FOR DELETE TO authenticated
USING (is_admin());

-- ============================================================
-- MACHINE_PARAMETERS TABLE (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS machine_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE(machine_id, parameter_id)
);

ALTER TABLE machine_parameters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "machine_params_select_all" ON machine_parameters;
CREATE POLICY "machine_params_select_all"
ON machine_parameters FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "machine_params_admin_insert" ON machine_parameters;
CREATE POLICY "machine_params_admin_insert"
ON machine_parameters FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "machine_params_admin_update" ON machine_parameters;
CREATE POLICY "machine_params_admin_update"
ON machine_parameters FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "machine_params_admin_delete" ON machine_parameters;
CREATE POLICY "machine_params_admin_delete"
ON machine_parameters FOR DELETE TO authenticated
USING (is_admin());

-- ============================================================
-- MONITORING_ROUNDS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS monitoring_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  technician_name text NOT NULL,
  machine_id uuid NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  machine_name text NOT NULL,
  shift_number int NOT NULL CHECK (shift_number IN (1, 2, 3)),
  round_number int NOT NULL CHECK (round_number IN (1, 2)),
  monitoring_date date NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz DEFAULT now()
);

ALTER TABLE monitoring_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rounds_select_all" ON monitoring_rounds;
CREATE POLICY "rounds_select_all"
ON monitoring_rounds FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "rounds_insert_all" ON monitoring_rounds;
CREATE POLICY "rounds_insert_all"
ON monitoring_rounds FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "rounds_update_own_or_admin" ON monitoring_rounds;
CREATE POLICY "rounds_update_own_or_admin"
ON monitoring_rounds FOR UPDATE TO authenticated
USING (auth.uid() = technician_id OR is_admin())
WITH CHECK (auth.uid() = technician_id OR is_admin());

DROP POLICY IF EXISTS "rounds_delete_own_or_admin" ON monitoring_rounds;
CREATE POLICY "rounds_delete_own_or_admin"
ON monitoring_rounds FOR DELETE TO authenticated
USING (auth.uid() = technician_id OR is_admin());

-- ============================================================
-- MONITORING_VALUES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS monitoring_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES monitoring_rounds(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES parameters(id) ON DELETE CASCADE,
  parameter_name text NOT NULL,
  value text,
  unit text,
  status text NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'warning', 'abnormal')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE monitoring_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "values_select_all" ON monitoring_values;
CREATE POLICY "values_select_all"
ON monitoring_values FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "values_insert_all" ON monitoring_values;
CREATE POLICY "values_insert_all"
ON monitoring_values FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "values_update_own_or_admin" ON monitoring_values;
CREATE POLICY "values_update_own_or_admin"
ON monitoring_values FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM monitoring_rounds WHERE id = monitoring_values.round_id AND (technician_id = auth.uid() OR is_admin()))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM monitoring_rounds WHERE id = monitoring_values.round_id AND (technician_id = auth.uid() OR is_admin()))
);

DROP POLICY IF EXISTS "values_delete_own_or_admin" ON monitoring_values;
CREATE POLICY "values_delete_own_or_admin"
ON monitoring_values FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM monitoring_rounds WHERE id = monitoring_values.round_id AND (technician_id = auth.uid() OR is_admin()))
);

-- ============================================================
-- MONITORING_PHOTOS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS monitoring_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES monitoring_rounds(id) ON DELETE CASCADE,
  parameter_id uuid REFERENCES parameters(id) ON DELETE SET NULL,
  storage_path text NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE monitoring_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "photos_select_all" ON monitoring_photos;
CREATE POLICY "photos_select_all"
ON monitoring_photos FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "photos_insert_all" ON monitoring_photos;
CREATE POLICY "photos_insert_all"
ON monitoring_photos FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "photos_delete_own_or_admin" ON monitoring_photos;
CREATE POLICY "photos_delete_own_or_admin"
ON monitoring_photos FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM monitoring_rounds WHERE id = monitoring_photos.round_id AND (technician_id = auth.uid() OR is_admin()))
);

-- ============================================================
-- STORAGE BUCKET: monitoring-photos
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('monitoring-photos', 'monitoring-photos', true)
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "photos_bucket_read" ON storage.objects;
CREATE POLICY "photos_bucket_read"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'monitoring-photos');

DROP POLICY IF EXISTS "photos_bucket_insert" ON storage.objects;
CREATE POLICY "photos_bucket_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'monitoring-photos');

DROP POLICY IF EXISTS "photos_bucket_delete" ON storage.objects;
CREATE POLICY "photos_bucket_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'monitoring-photos');

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_machine_parameters_machine ON machine_parameters(machine_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_rounds_date ON monitoring_rounds(monitoring_date);
CREATE INDEX IF NOT EXISTS idx_monitoring_rounds_machine ON monitoring_rounds(machine_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_rounds_shift ON monitoring_rounds(shift_number, round_number);
CREATE INDEX IF NOT EXISTS idx_monitoring_values_round ON monitoring_values(round_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_photos_round ON monitoring_photos(round_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
