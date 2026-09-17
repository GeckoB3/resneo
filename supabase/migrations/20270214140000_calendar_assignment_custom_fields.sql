-- The five missing per-calendar values get storage (Docs/collective-one-venue-plan.md W8, D5;
-- PB-01; Appendix C.2).
--
-- THE HOLE. The Services page and the mobile app let a staff member set seven values of their own
-- for a service on their calendar: name, description, length, buffer, price, deposit and colour.
-- `calendar_service_assignments` stores two of them (length and price). The other five were
-- dropped: silently when sent with a length or price, otherwise as a confusing 400, while the help
-- centre documents all seven. Every venue is on unified scheduling, so no venue could use them.
--
-- THIS MIGRATION adds the five columns, "last changed by" stamps, and range CHECKs on all seven
-- mirroring the overrides route's own schema (name 1-200 characters, description up to 2000,
-- length 5-480, buffer 0-120, price and deposit at least 0, colour up to 20). The 100p card-hold
-- floor depends on the service's payment rule, so it lives in the route, never in a CHECK.
-- Existing rows were checked on staging before writing (no length or price out of range).
--
-- The anonymous read policy that exposed every row is already gone (20270214120000, W15);
-- `updated_by_user_id` is an auth.users id and must never be anonymously readable.
--
-- NAME SNAPSHOT. A booking records its service name by trigger. With a calendar's own name now
-- storable, the snapshot takes it when the service lets staff customise the name, so the record
-- matches what the guest was shown.

ALTER TABLE public.calendar_service_assignments
  ADD COLUMN IF NOT EXISTS custom_name text,
  ADD COLUMN IF NOT EXISTS custom_description text,
  ADD COLUMN IF NOT EXISTS custom_buffer_minutes integer,
  ADD COLUMN IF NOT EXISTS custom_deposit_pence integer,
  ADD COLUMN IF NOT EXISTS custom_colour text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by_venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_service_assignments_custom_name_len') THEN
    ALTER TABLE public.calendar_service_assignments
      ADD CONSTRAINT calendar_service_assignments_custom_name_len
        CHECK (custom_name IS NULL OR char_length(btrim(custom_name)) BETWEEN 1 AND 200),
      ADD CONSTRAINT calendar_service_assignments_custom_description_len
        CHECK (custom_description IS NULL OR char_length(custom_description) <= 2000),
      ADD CONSTRAINT calendar_service_assignments_custom_duration_range
        CHECK (custom_duration_minutes IS NULL OR custom_duration_minutes BETWEEN 5 AND 480),
      ADD CONSTRAINT calendar_service_assignments_custom_buffer_range
        CHECK (custom_buffer_minutes IS NULL OR custom_buffer_minutes BETWEEN 0 AND 120),
      ADD CONSTRAINT calendar_service_assignments_custom_price_nonneg
        CHECK (custom_price_pence IS NULL OR custom_price_pence >= 0),
      ADD CONSTRAINT calendar_service_assignments_custom_deposit_nonneg
        CHECK (custom_deposit_pence IS NULL OR custom_deposit_pence >= 0),
      ADD CONSTRAINT calendar_service_assignments_custom_colour_len
        CHECK (custom_colour IS NULL OR char_length(custom_colour) <= 20);
  END IF;
END $$;

COMMENT ON COLUMN public.calendar_service_assignments.custom_name IS
  'This calendar''s own name for the service. Applies only while service_items.staff_may_customize_name is on.';
COMMENT ON COLUMN public.calendar_service_assignments.custom_buffer_minutes IS
  'This calendar''s own buffer. Applies only while service_items.staff_may_customize_buffer is on.';
COMMENT ON COLUMN public.calendar_service_assignments.custom_deposit_pence IS
  'This calendar''s own deposit (or no-show fee on a card-hold service). Applies only while service_items.staff_may_customize_deposit is on.';
COMMENT ON COLUMN public.calendar_service_assignments.updated_by_user_id IS
  'The signed-in user who last changed this calendar''s values. An auth.users id: never anonymously readable.';

-- updated_at follows real changes to a calendar's values, for "Last changed by".
CREATE OR REPLACE FUNCTION public.calendar_service_assignments_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.custom_name, NEW.custom_description, NEW.custom_duration_minutes, NEW.custom_buffer_minutes,
      NEW.custom_price_pence, NEW.custom_deposit_pence, NEW.custom_colour)
     IS DISTINCT FROM
     (OLD.custom_name, OLD.custom_description, OLD.custom_duration_minutes, OLD.custom_buffer_minutes,
      OLD.custom_price_pence, OLD.custom_deposit_pence, OLD.custom_colour)
     AND NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.calendar_service_assignments_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_calendar_service_assignments_touch_updated_at ON public.calendar_service_assignments;
CREATE TRIGGER trg_calendar_service_assignments_touch_updated_at
  BEFORE UPDATE ON public.calendar_service_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.calendar_service_assignments_touch_updated_at();

-- The booking's service name: this calendar's own name when the service lets staff customise it,
-- else the service's name. Otherwise unchanged from 20270103125000.
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
    SELECT COALESCE(
             CASE WHEN si.staff_may_customize_name THEN NULLIF(btrim(a.custom_name), '') END,
             si.name)
      INTO NEW.service_name_snapshot
    FROM public.service_items si
    LEFT JOIN public.calendar_service_assignments a
      ON a.service_item_id = si.id AND a.calendar_id = NEW.calendar_id
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
