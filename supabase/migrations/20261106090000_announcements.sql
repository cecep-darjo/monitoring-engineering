CREATE TABLE IF NOT EXISTS announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message text NOT NULL,
  publish_at timestamptz NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select_authenticated" ON announcements;
CREATE POLICY "announcements_select_authenticated"
ON announcements FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "announcements_admin_insert" ON announcements;
CREATE POLICY "announcements_admin_insert"
ON announcements FOR INSERT TO authenticated
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "announcements_admin_update" ON announcements;
CREATE POLICY "announcements_admin_update"
ON announcements FOR UPDATE TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

DROP POLICY IF EXISTS "announcements_admin_delete" ON announcements;
CREATE POLICY "announcements_admin_delete"
ON announcements FOR DELETE TO authenticated
USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_announcements_publish_at
  ON announcements(publish_at DESC)
  WHERE is_active = true;

DROP TRIGGER IF EXISTS trg_audit ON announcements;
CREATE TRIGGER trg_audit
AFTER INSERT OR UPDATE OR DELETE ON announcements
FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
