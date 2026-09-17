-- Collective booking switch, part 1b: event and class sessions are never parked (plan §6.6, §6.14).
--
-- STILL DARK. 20270217120000's trigger looked only at bookings.service_item_id, but a booking on an
-- event session carries its session's service_item_id too, so a class or event booking at a live
-- venue would have been refused as parked. The plan parks appointment services only; classes, events
-- and resources are untouched. The trigger now skips a booking with an event_session_id.

CREATE OR REPLACE FUNCTION public.bookings_refuse_parked_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.service_item_id IS NULL
     OR NEW.event_session_id IS NOT NULL
     OR coalesce(current_setting('resneo.collective_engine', true), '') = 'on'
     OR (TG_OP = 'UPDATE' AND NEW.service_item_id IS NOT DISTINCT FROM OLD.service_item_id) THEN
    RETURN NEW;
  END IF;
  IF public.collective_service_parked(NEW.venue_id, NEW.service_item_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_SERVICE_PARKED: this service is not on the collective page, so it cannot take new bookings while the venue is part of the collective'
      USING ERRCODE = 'RN007';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.bookings_refuse_parked_service() FROM PUBLIC, anon, authenticated;
