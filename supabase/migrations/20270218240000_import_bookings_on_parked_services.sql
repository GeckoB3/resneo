-- Imported bookings are kept on parked services (owner's decision, 2026-09-17).
--
-- Parking stops NEW bookings on a member's services that are not on the collective page, and keeps
-- the bookings already made. An import copies bookings already made in another system, so it
-- belongs with the kept ones: past and future rows are written, and the import report warns about
-- future ones (src/lib/import/run-execute.ts). Before this, the RN007 check refused them, past
-- ones included, and the import skipped the row with the raw database message.
--
-- The import's own insert function marks its transaction with `resneo.import_insert`, which the
-- check honours as it honours the collective engine's flag. Only this SECURITY DEFINER function,
-- executable by the service role alone, sets it.

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
     OR coalesce(current_setting('resneo.import_insert', true), '') = 'on'
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

CREATE OR REPLACE FUNCTION public.import_insert_booking_with_audit(
  p_session_id uuid,
  p_venue_id uuid,
  p_booking jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cols text;
  v_id uuid;
BEGIN
  IF p_booking IS NULL OR jsonb_typeof(p_booking) <> 'object' THEN
    RAISE EXCEPTION 'import_insert_booking_with_audit: booking payload must be a JSON object';
  END IF;
  IF (p_booking->>'venue_id')::uuid IS DISTINCT FROM p_venue_id THEN
    RAISE EXCEPTION 'import_insert_booking_with_audit: booking venue mismatch';
  END IF;

  SELECT string_agg(quote_ident(key), ', ' ORDER BY key)
    INTO v_cols
    FROM jsonb_object_keys(p_booking) AS t(key);

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'import_insert_booking_with_audit: empty booking payload';
  END IF;

  -- An imported booking was already made elsewhere, so a parked service keeps it (see above).
  PERFORM set_config('resneo.import_insert', 'on', true);
  EXECUTE format(
    'INSERT INTO public.bookings (%s) SELECT %s FROM jsonb_populate_record(NULL::public.bookings, $1) RETURNING id',
    v_cols, v_cols
  )
  INTO v_id
  USING p_booking;
  PERFORM set_config('resneo.import_insert', '', true);

  INSERT INTO public.import_records (session_id, venue_id, record_type, record_id, action, previous_data)
  VALUES (p_session_id, p_venue_id, 'booking', v_id, 'created', NULL);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_insert_booking_with_audit(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_insert_booking_with_audit(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.import_insert_booking_with_audit(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_insert_booking_with_audit(uuid, uuid, jsonb) TO service_role;
