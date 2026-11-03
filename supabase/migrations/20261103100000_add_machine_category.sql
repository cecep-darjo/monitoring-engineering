-- Existing machines are classified as regular (Rutin) by default.
ALTER TABLE machines
  ADD COLUMN IF NOT EXISTS machine_category text NOT NULL DEFAULT 'rutin';

ALTER TABLE machines
  DROP CONSTRAINT IF EXISTS machines_machine_category_check;

ALTER TABLE machines
  ADD CONSTRAINT machines_machine_category_check
  CHECK (machine_category IN ('rutin', 'mfd'));

CREATE INDEX IF NOT EXISTS idx_machines_machine_category
  ON machines(machine_category);
