CREATE TABLE IF NOT EXISTS report_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE report_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view report recipients"
  ON report_recipients FOR SELECT
  TO authenticated
  USING (is_admin());

CREATE POLICY "Admins can insert report recipients"
  ON report_recipients FOR INSERT
  TO authenticated
  WITH CHECK (is_admin());

CREATE POLICY "Admins can update report recipients"
  ON report_recipients FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete report recipients"
  ON report_recipients FOR DELETE
  TO authenticated
  USING (is_admin());
