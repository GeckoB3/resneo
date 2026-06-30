-- Reserve NI: harden guest-merge against duplicate pending compliance links (audit H5, part 2).
--
-- 20261230120000 fixed the target-vs-source collision but left a gap: if TWO source guests
-- each hold a PENDING link for the same compliance_type (and the target holds none), re-pointing
-- both to the target still violates uq_compliance_form_links_pending
-- (venue_id, guest_id, compliance_type_id) WHERE status='pending', raising 23505 and aborting
-- the whole merge. Fix: before re-pointing, keep exactly ONE pending link per compliance_type
-- across the full {target} ∪ {sources} set (preferring the target's, then the most recent) and
-- revoke the rest. Idempotent and covers every collision shape. Body otherwise identical.

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

  -- audit H5: keep exactly one pending link per compliance_type across the whole
  -- {target} ∪ {sources} guest set (prefer the target's, then the most recent) and revoke
  -- the rest, so re-pointing below cannot collide with uq_compliance_form_links_pending.
  -- This covers both target-vs-source and source-vs-source duplicates.
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY compliance_type_id
        ORDER BY (guest_id = p_target) DESC, created_at DESC, id
      ) AS rn
    FROM public.compliance_form_links
    WHERE venue_id = p_venue_id
      AND status = 'pending'
      AND (guest_id = p_target OR guest_id = ANY (p_sources))
  )
  UPDATE public.compliance_form_links l
  SET status = 'revoked', revoked_at = now()
  FROM ranked
  WHERE l.id = ranked.id AND ranked.rn > 1;

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
