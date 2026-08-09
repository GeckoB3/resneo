-- Bookings: remember what the appointment was for.
--
-- A booking stores no service name. The name shown in the dashboard is resolved
-- at read time by looking `service_item_id` up in the live catalogue, so history
-- is only as durable as the catalogue behind it:
--
--   * Deleting a service hard-deletes the row, and `service_item_id` is declared
--     ON DELETE SET NULL, so every past booking silently loses its link and then
--     shows no service at all. Dozens of appointment bookings on the shared
--     database had already been emptied this way before this migration ran.
--   * Renaming a service rewrites the past. Rename "Gents Cut" to "Classic Cut"
--     and every booking ever taken under the old name now reports the new one.
--
-- Money already survives both, because the amounts are written onto the booking
-- (`booking_total_price_pence`, `amount_paid_pence`, `deposit_amount_pence`).
-- This does the same for the name, so a booking describes itself and stops
-- depending on rows that outlive it only by luck.
--
-- Why a trigger rather than the create routes: bookings are inserted from at
-- least five places (public create, multi-service, group, the staff surface,
-- imports), and support scripts write them too. A trigger cannot be forgotten by
-- a path nobody remembered, including paths added later.
--
-- WHAT THIS DOES NOT DO:
--   * It does not change how anything is displayed. Reading code prefers the
--     snapshot and still falls back to the live lookup, so rows predating this
--     migration behave exactly as before.
--   * It does not freeze the name against deliberate edits: the snapshot is
--     written once, at insert, and never updated. That is the point.
--   * It does not cover classes, events or resources. They resolve their names
--     from their own tables and have the same exposure, but that is a separate
--     change with its own delete semantics to think about.
--   * It does not stop services being deleted. Deletion is now simply survivable.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_name_snapshot text,
  ADD COLUMN IF NOT EXISTS service_variant_name_snapshot text;

COMMENT ON COLUMN public.bookings.service_name_snapshot IS
  'The service name as it read when this booking was taken. Written once by trigger; never updated. History must not depend on the catalogue, which can be renamed or deleted.';

COMMENT ON COLUMN public.bookings.service_variant_name_snapshot IS
  'The chosen option''s name as it read when this booking was taken. Variants are ON DELETE CASCADE from their service, so deleting a service takes the option with it and nulls this booking''s link.';

-- Resolve the name from whichever service reference the booking carries, in the
-- same order the application uses when it resolves names live.
CREATE OR REPLACE FUNCTION public.set_booking_service_name_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Respect a name the caller supplied deliberately.
  IF NEW.service_name_snapshot IS NOT NULL AND btrim(NEW.service_name_snapshot) <> '' THEN
    RETURN NEW;
  END IF;

  IF NEW.service_item_id IS NOT NULL THEN
    SELECT si.name INTO NEW.service_name_snapshot
    FROM public.service_items si
    WHERE si.id = NEW.service_item_id;
  END IF;

  IF NEW.service_name_snapshot IS NULL AND NEW.appointment_service_id IS NOT NULL THEN
    SELECT a.name INTO NEW.service_name_snapshot
    FROM public.appointment_services a
    WHERE a.id = NEW.appointment_service_id;
  END IF;

  IF NEW.service_name_snapshot IS NULL AND NEW.service_id IS NOT NULL THEN
    SELECT vs.name INTO NEW.service_name_snapshot
    FROM public.venue_services vs
    WHERE vs.id = NEW.service_id;
  END IF;

  -- The chosen option, which is what actually distinguishes a 30 minute cut
  -- from a 60 minute one on the record.
  IF NEW.service_variant_id IS NOT NULL
     AND (NEW.service_variant_name_snapshot IS NULL
          OR btrim(NEW.service_variant_name_snapshot) = '') THEN
    SELECT sv.name INTO NEW.service_variant_name_snapshot
    FROM public.service_variants sv
    WHERE sv.id = NEW.service_variant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_booking_service_name_snapshot ON public.bookings;
CREATE TRIGGER trg_booking_service_name_snapshot
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_booking_service_name_snapshot();

-- Backfill what is still recoverable. Bookings whose service has already been
-- deleted cannot be recovered from anywhere and are left null, which reads the
-- same as they do today.
UPDATE public.bookings b
SET service_name_snapshot = si.name
FROM public.service_items si
WHERE b.service_item_id = si.id
  AND b.service_name_snapshot IS NULL
  AND si.name IS NOT NULL;

UPDATE public.bookings b
SET service_name_snapshot = a.name
FROM public.appointment_services a
WHERE b.appointment_service_id = a.id
  AND b.service_name_snapshot IS NULL
  AND a.name IS NOT NULL;

UPDATE public.bookings b
SET service_name_snapshot = vs.name
FROM public.venue_services vs
WHERE b.service_id = vs.id
  AND b.service_name_snapshot IS NULL
  AND vs.name IS NOT NULL;

UPDATE public.bookings b
SET service_variant_name_snapshot = sv.name
FROM public.service_variants sv
WHERE b.service_variant_id = sv.id
  AND b.service_variant_name_snapshot IS NULL
  AND sv.name IS NOT NULL;
