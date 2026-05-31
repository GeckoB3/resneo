-- Resneo: booking import staging — session flags, import_booking_references, import_booking_rows

-- -----------------------------------------------------------------------------
-- import_sessions: booking file + Step 3b completion
-- references_resolved defaults TRUE so existing sessions without booking files stay valid.
-- New uploads of booking files clear this via application logic (see sync).
-- -----------------------------------------------------------------------------
ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS has_booking_file boolean NOT NULL DEFAULT false;
ALTER TABLE import_sessions ADD COLUMN IF NOT EXISTS references_resolved boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN import_sessions.has_booking_file IS 'True when any file in the session is labelled bookings.';
COMMENT ON COLUMN import_sessions.references_resolved IS 'False until Step 3b (Match Booking References) is satisfied for this session.';

-- Backfill: mark sessions that have a bookings file; resolve Step 3b requirement for in-flight vs legacy
UPDATE import_sessions s
SET has_booking_file = EXISTS (
  SELECT 1 FROM import_files f
  WHERE f.session_id = s.id AND f.file_type = 'bookings'
);

UPDATE import_sessions
SET references_resolved = CASE
  WHEN NOT has_booking_file THEN true
  WHEN status IN ('uploading', 'mapping') THEN false
  ELSE true
END;

-- -----------------------------------------------------------------------------
-- import_booking_references
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_booking_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  reference_type text NOT NULL,

  raw_value text NOT NULL,

  instance_date date,
  instance_time time,
  instance_end_time time,

  booking_count int NOT NULL DEFAULT 0,

  ai_suggested_entity_id uuid,
  ai_suggested_entity_name text,
  ai_confidence text,
  ai_reasoning text,

  resolution_action text,

  resolved_entity_id uuid,
  resolved_entity_type text,

  created_entity_id uuid,
  created_entity_type text,

  is_resolved boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS uq_import_booking_references_session_file_type_raw_inst;
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_booking_references_session_file_type_raw_inst
  ON import_booking_references (
    session_id,
    file_id,
    reference_type,
    raw_value,
    COALESCE(instance_date, '1970-01-01'::date),
    COALESCE(instance_time::text, ''),
    COALESCE(instance_end_time::text, '')
  );

CREATE INDEX IF NOT EXISTS idx_import_refs_session ON import_booking_references(session_id);
CREATE INDEX IF NOT EXISTS idx_import_refs_type ON import_booking_references(session_id, reference_type);

ALTER TABLE import_booking_references ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_booking_references"
  ON import_booking_references FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- -----------------------------------------------------------------------------
-- import_booking_rows
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_booking_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES import_sessions(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES import_files(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,

  row_number int NOT NULL,

  booking_date date NOT NULL,
  booking_time time NOT NULL,
  booking_end_time time,
  duration_minutes int,
  party_size int DEFAULT 1,

  raw_service_name text,
  raw_staff_name text,
  raw_event_name text,
  raw_class_name text,
  raw_resource_name text,
  raw_table_ref text,
  raw_status text,
  raw_price text,
  raw_notes text,

  resolved_service_id uuid,
  resolved_calendar_id uuid,
  resolved_event_session_id uuid,
  resolved_class_instance_id uuid,
  resolved_resource_id uuid,

  guest_id uuid REFERENCES guests(id),
  raw_client_email text,
  raw_client_phone text,
  raw_client_name text,

  import_status text NOT NULL DEFAULT 'pending',

  skip_reason text,
  error_message text,

  is_future_booking boolean NOT NULL DEFAULT false,

  suppress_all_comms boolean NOT NULL DEFAULT false,
  reminder_already_sent boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (session_id, file_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_import_booking_rows_session ON import_booking_rows(session_id);
CREATE INDEX IF NOT EXISTS idx_import_booking_rows_future ON import_booking_rows(session_id, is_future_booking);

ALTER TABLE import_booking_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_import_booking_rows"
  ON import_booking_rows FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));
