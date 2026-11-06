ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS end_at timestamptz;

ALTER TABLE announcements
  DROP CONSTRAINT IF EXISTS announcements_time_window_check;

ALTER TABLE announcements
  ADD CONSTRAINT announcements_time_window_check
  CHECK (end_at IS NULL OR end_at > publish_at);

CREATE INDEX IF NOT EXISTS idx_announcements_end_at
  ON announcements(end_at)
  WHERE is_active = true;
