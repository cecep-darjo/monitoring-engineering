-- Scheduled tasks start pending; evidence and work details are supplied on completion.
ALTER TABLE work_requests
  ALTER COLUMN description DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS shift_number int,
  ADD COLUMN IF NOT EXISTS round_number int,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS work_requests_status_check;
ALTER TABLE work_requests
  ADD CONSTRAINT work_requests_status_check
  CHECK (status IN ('pending', 'in_progress', 'completed'));

ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS work_requests_shift_number_check;
ALTER TABLE work_requests
  ADD CONSTRAINT work_requests_shift_number_check
  CHECK (shift_number IS NULL OR shift_number IN (1, 2, 3));

ALTER TABLE work_requests DROP CONSTRAINT IF EXISTS work_requests_round_number_check;
ALTER TABLE work_requests
  ADD CONSTRAINT work_requests_round_number_check
  CHECK (round_number IS NULL OR round_number IN (1, 2));

CREATE INDEX IF NOT EXISTS idx_work_requests_schedule
  ON work_requests(scheduled_date, shift_number, round_number)
  WHERE status <> 'completed';
CREATE INDEX IF NOT EXISTS idx_work_requests_completed_at
  ON work_requests(completed_at DESC)
  WHERE status = 'completed';

-- Any authenticated technician or admin can work a scheduled task, even when another user created it.
DROP POLICY IF EXISTS "work_requests_update_own_or_admin" ON work_requests;
CREATE POLICY "work_requests_update_authenticated"
ON work_requests FOR UPDATE TO authenticated
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION validate_scheduled_work_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND (NEW.scheduled_date IS NULL OR NEW.shift_number IS NULL OR NEW.round_number IS NULL) THEN
    RAISE EXCEPTION 'Tanggal, shift, dan round wajib diisi untuk titipan pekerjaan baru.';
  END IF;

  IF NEW.status = 'completed' THEN
    IF TG_OP = 'INSERT' OR OLD.status <> 'completed' THEN
      IF NEW.description IS NULL OR length(trim(NEW.description)) = 0 OR
        NOT EXISTS (SELECT 1 FROM work_request_photos WHERE work_request_id = NEW.id) THEN
        RAISE EXCEPTION 'Titipan pekerjaan harus memiliki detail pekerjaan dan minimal satu foto bukti sebelum selesai.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_scheduled_work_request ON work_requests;
CREATE TRIGGER trg_validate_scheduled_work_request
BEFORE INSERT OR UPDATE ON work_requests
FOR EACH ROW EXECUTE FUNCTION validate_scheduled_work_request();
