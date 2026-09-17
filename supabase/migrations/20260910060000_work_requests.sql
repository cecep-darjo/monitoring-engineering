CREATE TABLE IF NOT EXISTS work_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  technician_name text NOT NULL,
  title text NOT NULL,
  requested_by text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'in_progress')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE work_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_requests_select_all"
ON work_requests FOR SELECT TO authenticated
USING (true);

CREATE POLICY "work_requests_insert_all"
ON work_requests FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "work_requests_update_own_or_admin"
ON work_requests FOR UPDATE TO authenticated
USING (auth.uid() = technician_id OR is_admin())
WITH CHECK (auth.uid() = technician_id OR is_admin());

CREATE POLICY "work_requests_delete_own_or_admin"
ON work_requests FOR DELETE TO authenticated
USING (auth.uid() = technician_id OR is_admin());

CREATE TABLE IF NOT EXISTS work_request_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_request_id uuid NOT NULL REFERENCES work_requests(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE work_request_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_request_photos_select_all"
ON work_request_photos FOR SELECT TO authenticated
USING (true);

CREATE POLICY "work_request_photos_insert_all"
ON work_request_photos FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "work_request_photos_delete_own_or_admin"
ON work_request_photos FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM work_requests WHERE id = work_request_photos.work_request_id AND (technician_id = auth.uid() OR is_admin()))
);

-- Reuses the existing public "monitoring-photos" bucket (folder: work-requests/*),
-- so no new storage bucket or bucket policy is needed.

CREATE INDEX IF NOT EXISTS idx_work_requests_created_at ON work_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_request_photos_request ON work_request_photos(work_request_id);
