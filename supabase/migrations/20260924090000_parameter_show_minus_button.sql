ALTER TABLE parameters
ADD COLUMN IF NOT EXISTS show_minus_button boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN parameters.show_minus_button IS
  'If true and parameter type is number, show a dedicated minus (-) toggle button in monitoring input to help mobile keyboards that do not provide a minus key.';
