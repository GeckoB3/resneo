-- Import execution: insert a guest and its undo-audit record atomically.
--
-- Previously the import inserted the guest, then separately inserted the
-- import_records audit row. If the audit insert failed after the guest insert
-- succeeded, the guest existed with no undo record — invisible to undo and
-- orphaned after a later undo. This mirrors import_insert_booking_with_audit
-- (20261218120000) so guest creation has the same one-transaction guarantee.
--
-- The guest payload's keys are produced exclusively by server code
-- (run-execute.ts); jsonb_populate_record coerces values to the guests row type,
-- and only the provided columns are inserted so column defaults still apply.

CREATE OR REPLACE FUNCTION public.import_insert_guest_with_audit(
  p_session_id uuid,
  p_venue_id uuid,
  p_guest jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cols text;
  v_id uuid;
BEGIN
  IF p_guest IS NULL OR jsonb_typeof(p_guest) <> 'object' THEN
    RAISE EXCEPTION 'import_insert_guest_with_audit: guest payload must be a JSON object';
  END IF;
  IF (p_guest->>'venue_id')::uuid IS DISTINCT FROM p_venue_id THEN
    RAISE EXCEPTION 'import_insert_guest_with_audit: guest venue mismatch';
  END IF;

  SELECT string_agg(quote_ident(key), ', ' ORDER BY key)
    INTO v_cols
    FROM jsonb_object_keys(p_guest) AS t(key);

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'import_insert_guest_with_audit: empty guest payload';
  END IF;

  EXECUTE format(
    'INSERT INTO public.guests (%s) SELECT %s FROM jsonb_populate_record(NULL::public.guests, $1) RETURNING id',
    v_cols, v_cols
  )
  INTO v_id
  USING p_guest;

  INSERT INTO public.import_records (session_id, venue_id, record_type, record_id, action, previous_data)
  VALUES (p_session_id, p_venue_id, 'guest', v_id, 'created', NULL);

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_insert_guest_with_audit(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_insert_guest_with_audit(uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.import_insert_guest_with_audit(uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.import_insert_guest_with_audit(uuid, uuid, jsonb) TO service_role;
