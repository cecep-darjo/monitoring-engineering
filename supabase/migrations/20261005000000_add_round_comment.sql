-- ============================================================
-- ADD ROUND COMMENT COLUMN
-- ============================================================
-- Adds an optional per-round comment that is separate from the
-- existing `notes` (General Notes) field. This comment is shown
-- in the monitoring entry form (NewMonitoring), editable in
-- History, and rendered in the daily PDF report.
ALTER TABLE monitoring_rounds
  ADD COLUMN IF NOT EXISTS round_comment text;