ALTER TABLE parameters ADD COLUMN IF NOT EXISTS must_increase boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN parameters.must_increase IS
  'For cumulative/counter-style parameters (e.g. running hours). When true, a new entry cannot be saved with a value lower than the most recent prior entry for the same parameter on the same machine.';
