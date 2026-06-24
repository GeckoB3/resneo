-- CDE review C1 — atomic capacity / overlap enforcement for classes, events, resources.
--
-- Capacity for class_session / event_ticket / resource_booking was enforced only
-- at the application layer (read availability, then insert) with no lock or DB
-- guard, so concurrent bookers could oversell an event/class or double-book a
-- resource slot. This installs a BEFORE INSERT/UPDATE trigger that:
--   * serialises concurrent writes for the same event/instance/resource via a
--     transaction-scoped advisory lock (mirrors consume_class_credits_atomically),
--   * re-checks count capacity (events, classes) or time-overlap (resources)
--     inside that lock, excluding the row being written,
--   * raises on overshoot so the booking is rejected.
--
-- A trigger (not an EXCLUDE constraint) is used deliberately: it installs cleanly
-- even if legacy rows already overlap (it only governs new/changed rows), and it
-- early-returns for appointment/table rows so their insert path is unaffected.
--
-- The application maps the raised error (SQLSTATE 23P01 / message prefix
-- 'CDE_CAPACITY') to a 409 "fully booked / slot taken" response.

CREATE OR REPLACE FUNCTION public.enforce_cde_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_capacity int;
  v_booked int;
  v_party int := COALESCE(NEW.party_size, 1);
  v_overlap boolean;
BEGIN
  -- Only capacity-consuming statuses occupy a seat/slot. Cancelled / No-Show /
  -- Completed etc. never block, so skip the checks for them.
  IF NEW.status::text NOT IN ('Pending', 'Booked', 'Confirmed', 'Seated') THEN
    RETURN NEW;
  END IF;

  -- ----- Resources: no overlapping active booking on the same resource. -----
  IF NEW.resource_id IS NOT NULL THEN
    -- Malformed/zero-length windows can't be range-checked; let them through
    -- (the application validates resource windows; this is the concurrency guard).
    IF NEW.booking_end_time IS NULL OR NEW.booking_time IS NULL
       OR NEW.booking_end_time <= NEW.booking_time THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('cde_resource:' || NEW.resource_id::text, 0));

    SELECT EXISTS (
      SELECT 1
      FROM public.bookings b
      WHERE b.resource_id = NEW.resource_id
        AND b.id <> NEW.id
        AND b.booking_date = NEW.booking_date
        AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated')
        AND b.booking_time IS NOT NULL
        AND b.booking_end_time IS NOT NULL
        -- half-open overlap: a.start < b.end AND b.start < a.end
        AND b.booking_time < NEW.booking_end_time
        AND NEW.booking_time < b.booking_end_time
    ) INTO v_overlap;

    IF v_overlap THEN
      RAISE EXCEPTION 'CDE_CAPACITY: resource slot already booked'
        USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
  END IF;

  -- ----- Events: total party_size across active bookings <= event capacity. -----
  IF NEW.experience_event_id IS NOT NULL THEN
    SELECT capacity INTO v_capacity
    FROM public.experience_events
    WHERE id = NEW.experience_event_id;

    -- Unknown / uncapped event: nothing to enforce here.
    IF v_capacity IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('cde_event:' || NEW.experience_event_id::text, 0));

    SELECT COALESCE(SUM(b.party_size), 0) INTO v_booked
    FROM public.bookings b
    WHERE b.experience_event_id = NEW.experience_event_id
      AND b.id <> NEW.id
      AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated');

    IF v_booked + v_party > v_capacity THEN
      RAISE EXCEPTION 'CDE_CAPACITY: event % is full (% / %)', NEW.experience_event_id, v_booked, v_capacity
        USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
  END IF;

  -- ----- Classes: total party_size across active bookings <= effective capacity. -----
  IF NEW.class_instance_id IS NOT NULL THEN
    SELECT COALESCE(ci.capacity_override, ct.capacity) INTO v_capacity
    FROM public.class_instances ci
    JOIN public.class_types ct ON ct.id = ci.class_type_id
    WHERE ci.id = NEW.class_instance_id;

    IF v_capacity IS NULL THEN
      RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('cde_class:' || NEW.class_instance_id::text, 0));

    SELECT COALESCE(SUM(b.party_size), 0) INTO v_booked
    FROM public.bookings b
    WHERE b.class_instance_id = NEW.class_instance_id
      AND b.id <> NEW.id
      AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated');

    IF v_booked + v_party > v_capacity THEN
      RAISE EXCEPTION 'CDE_CAPACITY: class % is full (% / %)', NEW.class_instance_id, v_booked, v_capacity
        USING ERRCODE = '23P01';
    END IF;

    RETURN NEW;
  END IF;

  -- Appointment / table rows: not governed here.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_cde_capacity() IS
  'CDE review C1 — advisory-lock-serialised capacity/overlap guard for class/event/resource bookings; raises SQLSTATE 23P01 on oversell.';

DROP TRIGGER IF EXISTS trg_enforce_cde_capacity ON public.bookings;
CREATE TRIGGER trg_enforce_cde_capacity
  BEFORE INSERT OR UPDATE OF status, party_size, booking_date, booking_time, booking_end_time,
    experience_event_id, class_instance_id, resource_id
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_cde_capacity();

-- Supporting indexes so the per-row count/overlap queries stay fast.
CREATE INDEX IF NOT EXISTS idx_bookings_experience_event_id
  ON public.bookings (experience_event_id) WHERE experience_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_class_instance_id
  ON public.bookings (class_instance_id) WHERE class_instance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_resource_date
  ON public.bookings (resource_id, booking_date) WHERE resource_id IS NOT NULL;
