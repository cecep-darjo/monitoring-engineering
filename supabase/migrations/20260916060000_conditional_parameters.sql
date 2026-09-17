ALTER TABLE schedule_parameters
  ADD COLUMN IF NOT EXISTS depends_on_parameter_id uuid REFERENCES parameters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS depends_on_value text;

COMMENT ON COLUMN schedule_parameters.depends_on_parameter_id IS
  'If set, this parameter is only active in a round when the parameter referenced here has the value in depends_on_value (e.g. "Leaving Chiller Temp" only applies when "Chiller Status" = ON).';
