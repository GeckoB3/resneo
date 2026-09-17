-- A calendar's own price applies only while the service lets staff customise price (D56, owner
-- 2026-09-15; TERMS-02).
--
-- Until now a price stored on a calendar applied whatever the service's `staff_may_customize_price`
-- flag said: unticking the box stopped staff editing the price but kept charging it (SB-12). The
-- owner chose to gate it straight away, so a calendar holding a price with the flag off goes back
-- to the service's price. The application resolver (`applicableCalendarValues`) gates every read
-- from the same release; this brings the booking's price snapshot, written by trigger
-- (20270212120000), into line so the record matches what is charged.
--
-- Existing bookings keep their snapshot: nothing is re-priced. Only bookings made (or re-priced by
-- a change of service or option) after this lands use the gated price.

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
  v_price_flag boolean;
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

  SELECT si.price_pence, si.staff_may_customize_price INTO v_service, v_price_flag
  FROM public.service_items si
  WHERE si.id = p_service_item_id;

  IF p_calendar_id IS NOT NULL AND v_price_flag IS TRUE THEN
    SELECT a.custom_price_pence INTO v_custom
    FROM public.calendar_service_assignments a
    WHERE a.calendar_id = p_calendar_id AND a.service_item_id = p_service_item_id;
    IF v_custom IS NOT NULL THEN
      RETURN v_custom;
    END IF;
  END IF;

  IF v_service IS NOT NULL THEN
    RETURN v_service;
  END IF;

  RETURN v_variant;
END;
$$;

REVOKE ALL ON FUNCTION public.booking_service_price_pence(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_service_price_pence(uuid, uuid, uuid) TO service_role;
