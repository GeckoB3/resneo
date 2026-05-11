-- Reserve NI: on booking insert or status change, append an event row
-- Idempotent: Supabase Preview / branched DBs may already have this trigger.

CREATE OR REPLACE FUNCTION log_booking_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  evt_type text;
  evt_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    evt_type := 'booking_created';
    evt_payload := jsonb_build_object(
      'booking_id', NEW.id,
      'guest_id', NEW.guest_id,
      'booking_date', NEW.booking_date,
      'booking_time', NEW.booking_time,
      'party_size', NEW.party_size,
      'status', NEW.status,
      'source', NEW.source
    );
    INSERT INTO events (venue_id, booking_id, event_type, payload)
    VALUES (NEW.venue_id, NEW.id, evt_type, evt_payload);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    evt_type := 'booking_status_changed';
    evt_payload := jsonb_build_object(
      'booking_id', NEW.id,
      'old_status', OLD.status,
      'new_status', NEW.status
    );
    INSERT INTO events (venue_id, booking_id, event_type, payload)
    VALUES (NEW.venue_id, NEW.id, evt_type, evt_payload);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_events_trigger ON bookings;
CREATE TRIGGER booking_events_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE PROCEDURE log_booking_event();
