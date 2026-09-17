-- Prevent the same machine/shift/round/date from being created twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitoring_round_once
ON monitoring_rounds(machine_id, monitoring_date, shift_number, round_number);

-- Server-side protection: editing/creating is only allowed while the relevant shift is active.
CREATE OR REPLACE FUNCTION public.shift_is_active(p_date date, p_shift int)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE h int := EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Jakarta');
DECLARE d date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_shift = 1 THEN RETURN p_date = d AND h >= 7 AND h < 15; END IF;
  IF p_shift = 2 THEN RETURN p_date = d AND h >= 15 AND h < 23; END IF;
  IF p_shift = 3 THEN
    RETURN (p_date = d AND h >= 23) OR (p_date = d - 1 AND h < 7);
  END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_monitoring_shift_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.shift_is_active(NEW.monitoring_date, NEW.shift_number) THEN
    RAISE EXCEPTION 'Monitoring is locked because the shift has ended';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_monitoring_shift_lock ON monitoring_rounds;
CREATE TRIGGER trg_monitoring_shift_lock
BEFORE INSERT OR UPDATE ON monitoring_rounds
FOR EACH ROW EXECUTE FUNCTION public.enforce_monitoring_shift_lock();
