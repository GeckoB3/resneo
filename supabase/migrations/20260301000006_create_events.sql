-- Reserve NI: events table (immutable append-only audit log)
-- No UPDATE or DELETE; only INSERT allowed.
-- Idempotent: Supabase Preview / branched DBs may already include this table.

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events (venue_id);
CREATE INDEX IF NOT EXISTS idx_events_booking_id ON events (booking_id);
CREATE INDEX IF NOT EXISTS idx_events_venue_created ON events (venue_id, created_at);

-- Prevent UPDATE and DELETE on events (append-only)
CREATE OR REPLACE FUNCTION events_deny_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'events table is append-only: % not allowed', TG_OP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS events_append_only ON events;
CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE PROCEDURE events_deny_update_delete();
