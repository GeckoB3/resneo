-- Enrich booking_status_changed events when status becomes Confirmed (guest vs staff).

CREATE OR REPLACE FUNCTION log_booking_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  evt_type text;
  evt_payload jsonb;
  confirmed_by text;
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
    IF NEW.status = 'Confirmed' THEN
      confirmed_by := 'unknown';
      IF NEW.guest_attendance_confirmed_at IS NOT NULL
        AND (OLD.guest_attendance_confirmed_at IS NULL
          OR OLD.guest_attendance_confirmed_at IS DISTINCT FROM NEW.guest_attendance_confirmed_at) THEN
        confirmed_by := 'guest';
      END IF;
      IF NEW.staff_attendance_confirmed_at IS NOT NULL
        AND (OLD.staff_attendance_confirmed_at IS NULL
          OR OLD.staff_attendance_confirmed_at IS DISTINCT FROM NEW.staff_attendance_confirmed_at) THEN
        IF confirmed_by = 'guest' THEN
          confirmed_by := 'both';
        ELSE
          confirmed_by := 'staff';
        END IF;
      ELSIF confirmed_by = 'unknown' AND NEW.staff_attendance_confirmed_at IS NOT NULL THEN
        confirmed_by := 'staff';
      ELSIF confirmed_by = 'unknown' AND NEW.guest_attendance_confirmed_at IS NOT NULL THEN
        confirmed_by := 'guest';
      END IF;
      evt_payload := evt_payload || jsonb_build_object('confirmed_by', confirmed_by);
    END IF;
    INSERT INTO events (venue_id, booking_id, event_type, payload)
    VALUES (NEW.venue_id, NEW.id, evt_type, evt_payload);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;
