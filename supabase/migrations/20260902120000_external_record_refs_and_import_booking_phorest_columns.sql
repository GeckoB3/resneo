-- Reserve NI: external source IDs for imports (e.g. Phorest client/appointment IDs) + staging columns on import_booking_rows.

-- -----------------------------------------------------------------------------
-- external_record_refs
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_record_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('guest', 'booking')),
  entity_id uuid NOT NULL,
  external_id text NOT NULL,
  external_parent_id text,
  source_branch_id text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venue_id, provider, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_record_refs_venue_entity
  ON external_record_refs(venue_id, entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_external_record_refs_lookup
  ON external_record_refs(venue_id, provider, entity_type, external_id);

ALTER TABLE external_record_refs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_external_record_refs"
  ON external_record_refs FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

COMMENT ON TABLE external_record_refs IS 'Maps venue entities to external system IDs from CSV/API imports (e.g. Phorest clientId, appointmentId).';

-- -----------------------------------------------------------------------------
-- import_booking_rows: Phorest / rich exports
-- -----------------------------------------------------------------------------
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_external_appointment_id text;
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_external_booking_id text;
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_external_client_id text;
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_group_booking_id text;
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_booking_end_time text;
ALTER TABLE import_booking_rows ADD COLUMN IF NOT EXISTS raw_import_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN import_booking_rows.raw_external_appointment_id IS 'Source appointment ID (e.g. Phorest appointmentId).';
COMMENT ON COLUMN import_booking_rows.raw_import_metadata IS 'Extra columns from export (activation state, room, course, etc.).';
