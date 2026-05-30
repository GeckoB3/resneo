-- Resneo: data import tool — sessions, files, mappings, validation, undo audit, custom fields, storage.

-- -----------------------------------------------------------------------------
-- booking_source: historical imports
-- -----------------------------------------------------------------------------
ALTER TYPE booking_source ADD VALUE IF NOT EXISTS 'import';

-- -----------------------------------------------------------------------------
-- guests: JSON bag for import-defined custom columns + schema extras
-- -----------------------------------------------------------------------------
ALTER TABLE guests ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN guests.custom_fields IS 'Venue-defined custom client fields (import tool, CRM extensions); keys are slugged field_key values.';

-- -----------------------------------------------------------------------------
-- custom_client_fields
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_client_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  field_key text NOT NULL,
  field_type text NOT NULL CHECK (field_type IN ('text', 'number', 'date', 'boolean')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_client_fields_venue ON custom_client_fields(venue_id);

ALTER TABLE custom_client_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_custom_client_fields"
  ON custom_client_fields FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- -----------------------------------------------------------------------------
-- import_sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES staff(id),
  status text NOT NULL DEFAULT 'uploading',
  detected_platform text,
  total_rows int NOT NULL DEFAULT 0,
  imported_clients int NOT NULL DEFAULT 0,
  imported_bookings int NOT NULL DEFAULT 0,
  skipped_rows int NOT NULL DEFAULT 0,
  updated_existing int NOT NULL DEFAULT 0,
  undo_available_until timestamptz,
  undone_at timestamptz,
  ai_mapping_used boolean NOT NULL DEFAULT false,
  ai_model_used text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  progress_processed int NOT NULL DEFAULT 0,
  progress_total int NOT NULL DEFAULT 0,
  session_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_sessions_venue ON import_sessions(venue_id);
CREATE INDEX IF NOT EXISTS idx_import_sessions_created ON import_sessions(venue_id, created_at DESC);

ALTER TABLE import_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_sessions"
  ON import_sessions FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- -----------------------------------------------------------------------------
-- import_files
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_type text NOT NULL,
  storage_path text NOT NULL,
  row_count int,
  column_count int,
  headers text[],
  sample_rows jsonb,
  encoding text NOT NULL DEFAULT 'utf-8',
  delimiter text NOT NULL DEFAULT ',',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_files_session ON import_files(session_id);

ALTER TABLE import_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_files"
  ON import_files FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- -----------------------------------------------------------------------------
-- import_column_mappings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_column_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  source_column text NOT NULL,
  target_field text,
  action text NOT NULL DEFAULT 'map',
  custom_field_name text,
  custom_field_type text,
  split_config jsonb,
  ai_suggested boolean NOT NULL DEFAULT false,
  ai_confidence text,
  ai_reasoning text,
  user_overridden boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_mappings_file ON import_column_mappings(file_id);
CREATE INDEX IF NOT EXISTS idx_import_mappings_session ON import_column_mappings(session_id);

ALTER TABLE import_column_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_column_mappings"
  ON import_column_mappings FOR ALL
  USING (session_id IN (
    SELECT s.id FROM import_sessions s
    JOIN staff st ON st.venue_id = s.venue_id
    WHERE st.email = (auth.jwt() ->> 'email')
  ))
  WITH CHECK (session_id IN (
    SELECT s.id FROM import_sessions s
    JOIN staff st ON st.venue_id = s.venue_id
    WHERE st.email = (auth.jwt() ->> 'email')
  ));

-- -----------------------------------------------------------------------------
-- import_validation_issues
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_validation_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  row_number int NOT NULL,
  severity text NOT NULL,
  issue_type text NOT NULL,
  column_name text,
  raw_value text,
  message text NOT NULL,
  resolution text,
  user_decision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_issues_session ON import_validation_issues(session_id);

ALTER TABLE import_validation_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_validation_issues"
  ON import_validation_issues FOR ALL
  USING (session_id IN (
    SELECT s.id FROM import_sessions s
    JOIN staff st ON st.venue_id = s.venue_id
    WHERE st.email = (auth.jwt() ->> 'email')
  ))
  WITH CHECK (session_id IN (
    SELECT s.id FROM import_sessions s
    JOIN staff st ON st.venue_id = s.venue_id
    WHERE st.email = (auth.jwt() ->> 'email')
  ));

-- -----------------------------------------------------------------------------
-- import_records (undo audit)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL,
  previous_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_records_session ON import_records(session_id);
CREATE INDEX IF NOT EXISTS idx_import_records_record ON import_records(record_id);
CREATE INDEX IF NOT EXISTS idx_import_records_venue_session ON import_records(venue_id, session_id);

ALTER TABLE import_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_records"
  ON import_records FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- -----------------------------------------------------------------------------
-- Storage: CSV imports (private; server uploads via service role)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imports',
  'imports',
  false,
  52428800,
  ARRAY['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/csv']
)
ON CONFLICT (id) DO NOTHING;
