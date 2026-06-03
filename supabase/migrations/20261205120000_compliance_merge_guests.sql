-- Reserve NI: re-point compliance data during guest merge (spec data-integrity).
--
-- merge_guests_into (20260702120100) re-points CRM/booking FKs to the target guest
-- then DELETEs the source guests. compliance_records.guest_id is ON DELETE CASCADE,
-- so without re-pointing, a merge would silently DESTROY the source guest's
-- compliance records (and form links). This CREATE OR REPLACE adds the missing
-- re-pointing for compliance_records, compliance_form_links and (best-effort)
-- compliance_audit_events. Identical to the prior definition otherwise.

CREATE OR REPLACE FUNCTION public.merge_guests_into(
  p_venue_id uuid,
  p_target uuid,
  p_sources uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s uuid;
  rec RECORD;
BEGIN
  IF p_sources IS NULL OR array_length(p_sources, 1) IS NULL THEN
    RAISE EXCEPTION 'merge_guests_into: no sources';
  END IF;

  IF p_target = ANY (p_sources) THEN
    RAISE EXCEPTION 'merge_guests_into: target in sources';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.guests WHERE id = p_target AND venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'merge_guests_into: target not found';
  END IF;

  FOREACH s IN ARRAY p_sources LOOP
    IF NOT EXISTS (SELECT 1 FROM public.guests WHERE id = s AND venue_id = p_venue_id) THEN
      RAISE EXCEPTION 'merge_guests_into: source % not found', s;
    END IF;
  END LOOP;

  UPDATE public.bookings
  SET guest_id = p_target, updated_at = now()
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.communications
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.guest_documents
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources) AND deleted_at IS NULL;

  UPDATE public.guest_loyalty_ledger
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.class_course_enrollments
  SET guest_id = p_target, updated_at = now()
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  -- Compliance: re-point records + form links so the merged guest keeps them.
  -- (compliance_audit_events is append-only — its guest_id is ON DELETE SET NULL,
  -- so source-guest deletion nulls old audit links; we must not UPDATE it here.)
  UPDATE public.compliance_records
  SET guest_id = p_target, updated_at = now()
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.compliance_form_links
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  FOREACH s IN ARRAY p_sources LOOP
    FOR rec IN SELECT household_id FROM public.guest_household_members WHERE guest_id = s LOOP
      IF EXISTS (
        SELECT 1 FROM public.guest_household_members m
        WHERE m.household_id = rec.household_id AND m.guest_id = p_target
      ) THEN
        DELETE FROM public.guest_household_members
        WHERE household_id = rec.household_id AND guest_id = s;
      ELSE
        UPDATE public.guest_household_members
        SET guest_id = p_target
        WHERE household_id = rec.household_id AND guest_id = s;
      END IF;
    END LOOP;
  END LOOP;

  IF to_regclass('public.import_booking_rows') IS NOT NULL THEN
    UPDATE public.import_booking_rows
    SET guest_id = p_target
    WHERE guest_id = ANY (p_sources);
  END IF;

  DELETE FROM public.guests
  WHERE venue_id = p_venue_id AND id = ANY (p_sources);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) TO service_role;
