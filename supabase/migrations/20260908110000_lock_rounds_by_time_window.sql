-- Replaces the shift-level lock with a per-round time-window lock:
-- Shift 1: Round 1 = 07:00-11:00, Round 2 = 11:00-15:00
-- Shift 2: Round 1 = 15:00-19:00, Round 2 = 19:00-23:00
-- Shift 3: Round 1 = 23:00-03:00, Round 2 = 03:00-07:00

CREATE OR REPLACE FUNCTION public.round_is_active(p_date date, p_shift int, p_round int)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  h int := EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Jakarta');
  d date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_shift = 1 AND p_round = 1 THEN RETURN p_date = d AND h >= 7  AND h < 11; END IF;
  IF p_shift = 1 AND p_round = 2 THEN RETURN p_date = d AND h >= 11 AND h < 15; END IF;
  IF p_shift = 2 AND p_round = 1 THEN RETURN p_date = d AND h >= 15 AND h < 19; END IF;
  IF p_shift = 2 AND p_round = 2 THEN RETURN p_date = d AND h >= 19 AND h < 23; END IF;
  IF p_shift = 3 AND p_round = 1 THEN
    RETURN (p_date = d AND h >= 23) OR (p_date = d - 1 AND h < 3);
  END IF;
  IF p_shift = 3 AND p_round = 2 THEN RETURN p_date = d - 1 AND h >= 3 AND h < 7; END IF;
  RETURN false;
END; $$;

CREATE OR REPLACE FUNCTION public.enforce_monitoring_shift_lock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT public.round_is_active(NEW.monitoring_date, NEW.shift_number, NEW.round_number) THEN
    RAISE EXCEPTION 'Monitoring is locked because this round''s entry window is closed';
  END IF;
  RETURN NEW;
END; $$;

-- Trigger already exists from the previous migration and points at the same
-- function name, so no need to re-create it; CREATE OR REPLACE above is enough.
-- Re-create defensively in case this migration runs standalone.
DROP TRIGGER IF EXISTS trg_monitoring_shift_lock ON monitoring_rounds;
CREATE TRIGGER trg_monitoring_shift_lock
BEFORE INSERT OR UPDATE ON monitoring_rounds
FOR EACH ROW EXECUTE FUNCTION public.enforce_monitoring_shift_lock();
