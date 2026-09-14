-- Bookings keep the price they were made at (Docs/collective-one-venue-plan.md D7, W1a; PB-07).
--
-- THE HOLE. An appointment booking stores its add-on total, deposit and names, but not the price
-- of the service itself. Every screen, balance, charge prefill, reminder and the Booked revenue
-- report recomputes it LIVE from the catalogue (payment-summary.ts loadRowTotalResolver). So any
-- price edit rewrites history: raise a service from 25.00 to 30.00 and every past booking of it
-- reports 30.00 in revenue, and a guest's outstanding balance moves after they booked. A
-- collective host's price change would do the same to every member's history at once.
--
-- THE FIX. `service_price_snapshot_pence`: the service line's price when the booking was made,
-- excluding add-ons (which `addons_total_price_pence` already holds). Written by trigger, like
-- `service_name_snapshot` (20270103125000), because bookings are inserted from many places and a
-- trigger cannot be forgotten by one:
--   * on insert, when the caller has not supplied one;
--   * on an update that changes the service or the option, unless the same statement sets the
--     snapshot itself. Moving a booking to another time or calendar keeps the agreed price.
--
-- THE PRICE is resolved exactly as loadRowTotalResolver resolves it live today, so no stored
-- total, balance or report figure moves on the day this lands: the chosen option's price when it
-- is above zero, else this calendar's custom price, else the service's price, else the option's
-- price. (The plan's future resolver gates a custom price on the staff permission flag; that
-- gating ships with the resolver, not here, so the snapshot matches what guests were quoted.)
--
-- NULL still means "unknown" (a deleted service, a legacy row), and readers then fall back to
-- the live price as before.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS service_price_snapshot_pence integer;

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_service_price_snapshot_nonneg;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_service_price_snapshot_nonneg
  CHECK (service_price_snapshot_pence IS NULL OR service_price_snapshot_pence >= 0);

COMMENT ON COLUMN public.bookings.service_price_snapshot_pence IS
  'The service line''s price, without add-ons, as it stood when this booking was made (or when its service or option last changed). Written by trigger. Readers prefer it to the live catalogue price.';

CREATE OR REPLACE FUNCTION public.booking_service_price_pence(
  p_service_item_id uuid,
  p_service_variant_id uuid,
  p_calendar_id uuid
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_variant integer;
  v_custom integer;
  v_service integer;
BEGIN
  IF p_service_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_service_variant_id IS NOT NULL THEN
    SELECT sv.price_pence INTO v_variant
    FROM public.service_variants sv
    WHERE sv.id = p_service_variant_id;
    IF v_variant IS NOT NULL AND v_variant > 0 THEN
      RETURN v_variant;
    END IF;
  END IF;

  IF p_calendar_id IS NOT NULL THEN
    SELECT a.custom_price_pence INTO v_custom
    FROM public.calendar_service_assignments a
    WHERE a.calendar_id = p_calendar_id AND a.service_item_id = p_service_item_id;
    IF v_custom IS NOT NULL THEN
      RETURN v_custom;
    END IF;
  END IF;

  SELECT si.price_pence INTO v_service
  FROM public.service_items si
  WHERE si.id = p_service_item_id;
  IF v_service IS NOT NULL THEN
    RETURN v_service;
  END IF;

  RETURN v_variant;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_service_price_pence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_service_price_pence(uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_booking_service_price_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.service_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.service_price_snapshot_pence IS NULL THEN
      NEW.service_price_snapshot_pence :=
        public.booking_service_price_pence(NEW.service_item_id, NEW.service_variant_id, NEW.calendar_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only a change of service or option re-prices, and never over a value this same
  -- statement chose to write.
  IF (NEW.service_item_id IS DISTINCT FROM OLD.service_item_id
      OR NEW.service_variant_id IS DISTINCT FROM OLD.service_variant_id)
     AND NEW.service_price_snapshot_pence IS NOT DISTINCT FROM OLD.service_price_snapshot_pence THEN
    NEW.service_price_snapshot_pence :=
      public.booking_service_price_pence(NEW.service_item_id, NEW.service_variant_id, NEW.calendar_id);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_booking_service_price_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_booking_service_price_snapshot ON public.bookings;
CREATE TRIGGER trg_booking_service_price_snapshot
  BEFORE INSERT OR UPDATE OF service_item_id, service_variant_id ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_booking_service_price_snapshot();

-- Backfill every appointment booking, past, future and cancelled, with the price it reads as
-- today (D7). The trigger is already in place, so a booking inserted while this runs is covered;
-- this statement does not touch the service or option columns, so it does not fire it. Rows
-- whose service was deleted stay NULL and keep reading as unknown.
UPDATE public.bookings b
SET service_price_snapshot_pence =
  public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
WHERE b.service_item_id IS NOT NULL
  AND b.service_price_snapshot_pence IS NULL
  AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;
