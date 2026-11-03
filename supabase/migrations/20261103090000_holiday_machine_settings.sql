-- Holiday activation is kept separate from the regular machine active flag.
CREATE TABLE IF NOT EXISTS holiday_machine_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL UNIQUE REFERENCES machines(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE holiday_machine_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holiday_machine_settings_select_all" ON holiday_machine_settings;
CREATE POLICY "holiday_machine_settings_select_all"
ON holiday_machine_settings FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "holiday_machine_settings_admin_insert" ON holiday_machine_settings;
CREATE POLICY "holiday_machine_settings_admin_insert"
ON holiday_machine_settings FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "holiday_machine_settings_admin_update" ON holiday_machine_settings;
CREATE POLICY "holiday_machine_settings_admin_update"
ON holiday_machine_settings FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "holiday_machine_settings_admin_delete" ON holiday_machine_settings;
CREATE POLICY "holiday_machine_settings_admin_delete"
ON holiday_machine_settings FOR DELETE TO authenticated
USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_holiday_machine_settings_active
  ON holiday_machine_settings(is_active);
