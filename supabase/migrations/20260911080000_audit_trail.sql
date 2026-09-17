CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name text,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'login', 'login_failed', 'logout')),
  entity_type text NOT NULL,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);

-- Only admins can read the audit trail.
CREATE POLICY "audit_logs_select_admin"
ON audit_logs FOR SELECT TO authenticated
USING (is_admin());

-- Client code is only ever allowed to log its own login/logout/login_failed events —
-- every create/update/delete row is written exclusively by the trigger function below
-- (SECURITY DEFINER, owned by postgres) so it can never be forged from the browser.
CREATE POLICY "audit_logs_insert_own_auth_events"
ON audit_logs FOR INSERT TO authenticated
WITH CHECK (action IN ('login', 'logout') AND user_id = auth.uid());

-- login_failed happens before a session exists, so it must be insertable by anon too,
-- scoped to only that action and no identifying user_id spoofing (user_id left null).
CREATE POLICY "audit_logs_insert_login_failed_anon"
ON audit_logs FOR INSERT TO anon
WITH CHECK (action = 'login_failed' AND user_id IS NULL);

CREATE POLICY "audit_logs_insert_login_failed_authenticated"
ON audit_logs FOR INSERT TO authenticated
WITH CHECK (action = 'login_failed' AND user_id IS NULL);

-- Generic audit trigger: records create/update/delete on any table it's attached to.
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id uuid;
  actor_name text;
  row_id uuid;
BEGIN
  actor_id := auth.uid();
  IF actor_id IS NOT NULL THEN
    SELECT full_name INTO actor_name FROM profiles WHERE id = actor_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    row_id := OLD.id;
    INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, old_data)
    VALUES (actor_id, actor_name, 'delete', TG_TABLE_NAME, row_id, to_jsonb(OLD));
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    row_id := NEW.id;
    IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, old_data, new_data)
      VALUES (actor_id, actor_name, 'update', TG_TABLE_NAME, row_id, to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    row_id := NEW.id;
    INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, new_data)
    VALUES (actor_id, actor_name, 'create', TG_TABLE_NAME, row_id, to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'machines', 'parameters', 'schedules', 'schedule_parameters', 'profiles',
    'monitoring_rounds', 'monitoring_values', 'work_requests', 'report_recipients'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_audit ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()', t);
  END LOOP;
END $$;
