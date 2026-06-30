-- Reserve NI: fix guest-merge crash on duplicate pending compliance form links (audit H5).
--
-- merge_guests_into (20261205120000) re-points compliance_form_links.guest_id from the
-- source guests to the target. If a source and the target each hold a PENDING link for the
-- same compliance_type, re-pointing violates uq_compliance_form_links_pending
-- (venue_id, guest_id, compliance_type_id) WHERE status='pending' (added 20261207120000),
-- raising 23505 and aborting the whole merge. Fix: revoke the source guests' duplicate
-- pending links BEFORE re-pointing, keeping the target's. Body otherwise identical to
-- 20261205120000.

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

  -- audit H5: revoke a source's pending link when the target already has a pending link of
  -- the same type, so re-pointing below does not collide with uq_compliance_form_links_pending.
  UPDATE public.compliance_form_links src
  SET status = 'revoked', revoked_at = now()
  WHERE src.venue_id = p_venue_id
    AND src.guest_id = ANY (p_sources)
    AND src.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.compliance_form_links tgt
      WHERE tgt.venue_id = p_venue_id
        AND tgt.guest_id = p_target
        AND tgt.status = 'pending'
        AND tgt.compliance_type_id = src.compliance_type_id
    );

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
