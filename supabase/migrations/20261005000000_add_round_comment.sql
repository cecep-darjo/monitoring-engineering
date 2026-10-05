-- ============================================================
-- ROUND CONCLUSION (per round, global — not per machine)
-- ============================================================
-- A single conclusion/comment per (monitoring_date + shift_number +
-- round_number), shared by ALL machines in that round. This is the
-- round-level wrap-up of every monitoring performed during that round.
--
-- The earlier per-machine `monitoring_rounds.round_comment` approach
-- is dropped in favor of this global one.

ALTER TABLE monitoring_rounds
  DROP COLUMN IF EXISTS round_comment;

CREATE TABLE IF NOT EXISTS round_conclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  monitoring_date date NOT NULL,
  shift_number int NOT NULL CHECK (shift_number IN (1, 2, 3)),
  round_number int NOT NULL CHECK (round_number IN (1, 2)),
  comment text NOT NULL,
  technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  technician_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One conclusion per round.
CREATE UNIQUE INDEX IF NOT EXISTS uq_round_conclusion_once
  ON round_conclusions(monitoring_date, shift_number, round_number);

ALTER TABLE round_conclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "conclusions_select_all" ON round_conclusions;
CREATE POLICY "conclusions_select_all"
ON round_conclusions FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "conclusions_insert_all" ON round_conclusions;
CREATE POLICY "conclusions_insert_all"
ON round_conclusions FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "conclusions_update_all" ON round_conclusions;
CREATE POLICY "conclusions_update_all"
ON round_conclusions FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "conclusions_delete_own_or_admin" ON round_conclusions;
CREATE POLICY "conclusions_delete_own_or_admin"
ON round_conclusions FOR DELETE TO authenticated
USING (technician_id = auth.uid() OR is_admin());