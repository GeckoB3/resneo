-- Calendar service assignments are written as diffs, atomically, and a stale
-- save is refused rather than silently undoing somebody else's change.
-- (Docs/collective-one-venue-plan.md W2; findings PB-03, PB-04, PB-08, PB-14.)
--
-- THE HOLES. Both writers of `calendar_service_assignments` deleted every row
-- for the calendar (PUT /api/venue/practitioner-services) or for the service
-- (PATCH /api/venue/appointment-services) and re-inserted the set the client
-- sent, as two separate PostgREST requests:
--   * a failure between the delete and the insert left the calendar or service
--     with no assignments at all (PB-03);
--   * an Edit calendar dialog opened before someone else added a service would,
--     on save, delete that service again (PB-04, a lost update);
--   * every save churned row ids;
--   * the calendar-side PUT accepted service ids from other venues (PB-08).
-- And `service_items.updated_at` was never maintained (PB-14), so the Services
-- page had nothing to detect a concurrent edit with.
--
-- WHY FUNCTIONS. The compare against the set the client loaded, the ownership
-- checks and the write must share one transaction, and PostgREST gives one
-- transaction per request (the same reasoning as 20270129120000). Both take the
-- same per-venue advisory lock, so a calendar-side save and a service-side save
-- touching the same row cannot interleave between their reads and writes.
--
-- WHAT A DIFF MEANS. Rows the caller keeps are not touched, so they keep their
-- id and every custom column. Only added rows are inserted and only removed
-- rows are deleted.
--
-- STALE. When the caller passes the set it loaded and the stored set differs,
-- the function writes nothing and answers {"status":"stale"}; the route turns
-- that into 412 STALE_RESOURCE. A caller that passes NULL (older app builds send
-- no expected set) is not checked: the full set it sends is diffed as before.

CREATE OR REPLACE FUNCTION public.set_calendar_service_assignments(
  p_venue_id uuid,
  p_calendar_id uuid,
  p_service_item_ids uuid[],
  p_expected_service_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wanted uuid[] := ARRAY(SELECT DISTINCT s FROM unnest(COALESCE(p_service_item_ids, '{}'::uuid[])) AS s ORDER BY 1);
  v_current uuid[];
  v_added uuid[];
  v_removed uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('calendar_service_assignments:' || p_venue_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.unified_calendars c WHERE c.id = p_calendar_id AND c.venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_AT_VENUE: calendar % is not at venue %', p_calendar_id, p_venue_id
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_wanted) AS w(id)
    LEFT JOIN public.service_items s ON s.id = w.id AND s.venue_id = p_venue_id
    WHERE s.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_AT_VENUE: a service is not at venue %', p_venue_id
      USING ERRCODE = '22023';
  END IF;

  v_current := ARRAY(
    SELECT a.service_item_id FROM public.calendar_service_assignments a
    WHERE a.calendar_id = p_calendar_id ORDER BY 1
  );

  IF p_expected_service_item_ids IS NOT NULL
     AND v_current IS DISTINCT FROM ARRAY(SELECT DISTINCT e FROM unnest(p_expected_service_item_ids) AS e ORDER BY 1) THEN
    RETURN jsonb_build_object('status', 'stale', 'added', '[]'::jsonb, 'removed', '[]'::jsonb);
  END IF;

  v_removed := ARRAY(SELECT x FROM unnest(v_current) AS x WHERE NOT (x = ANY (v_wanted)) ORDER BY 1);
  v_added := ARRAY(SELECT x FROM unnest(v_wanted) AS x WHERE NOT (x = ANY (v_current)) ORDER BY 1);

  DELETE FROM public.calendar_service_assignments a
  WHERE a.calendar_id = p_calendar_id AND a.service_item_id = ANY (v_removed);

  INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
  SELECT p_calendar_id, x FROM unnest(v_added) AS x
  ON CONFLICT (calendar_id, service_item_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'ok', 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
END;
$$;

COMMENT ON FUNCTION public.set_calendar_service_assignments(uuid, uuid, uuid[], uuid[]) IS
  'W2: set which services one calendar offers, as an atomic diff with a stale check. '
  'Service role only; the route authorises the caller first.';

-- `p_scope_calendar_ids`: NULL for an admin (every calendar at the venue may
-- change); for a non-admin, the calendars they manage. Assignments on calendars
-- outside the scope are never added or removed, whatever the caller sends.
CREATE OR REPLACE FUNCTION public.set_service_calendar_assignments(
  p_venue_id uuid,
  p_service_item_id uuid,
  p_calendar_ids uuid[],
  p_scope_calendar_ids uuid[],
  p_expected_calendar_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_wanted uuid[] := ARRAY(SELECT DISTINCT c FROM unnest(COALESCE(p_calendar_ids, '{}'::uuid[])) AS c ORDER BY 1);
  v_current uuid[];
  v_added uuid[];
  v_removed uuid[];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('calendar_service_assignments:' || p_venue_id::text, 0));

  IF NOT EXISTS (
    SELECT 1 FROM public.service_items s WHERE s.id = p_service_item_id AND s.venue_id = p_venue_id
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_AT_VENUE: service % is not at venue %', p_service_item_id, p_venue_id
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_wanted) AS w(id)
    LEFT JOIN public.unified_calendars c ON c.id = w.id AND c.venue_id = p_venue_id
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_AT_VENUE: a calendar is not at venue %', p_venue_id
      USING ERRCODE = '22023';
  END IF;

  IF p_scope_calendar_ids IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(v_wanted) AS w WHERE NOT (w = ANY (p_scope_calendar_ids))) THEN
    RAISE EXCEPTION 'ASSIGNMENT_OUTSIDE_SCOPE: a calendar is outside the caller''s scope'
      USING ERRCODE = '42501';
  END IF;

  v_current := ARRAY(
    SELECT a.calendar_id FROM public.calendar_service_assignments a
    WHERE a.service_item_id = p_service_item_id ORDER BY 1
  );

  IF p_expected_calendar_ids IS NOT NULL
     AND v_current IS DISTINCT FROM ARRAY(SELECT DISTINCT e FROM unnest(p_expected_calendar_ids) AS e ORDER BY 1) THEN
    RETURN jsonb_build_object('status', 'stale', 'added', '[]'::jsonb, 'removed', '[]'::jsonb);
  END IF;

  v_removed := ARRAY(
    SELECT x FROM unnest(v_current) AS x
    WHERE NOT (x = ANY (v_wanted))
      AND (p_scope_calendar_ids IS NULL OR x = ANY (p_scope_calendar_ids))
    ORDER BY 1
  );
  v_added := ARRAY(SELECT x FROM unnest(v_wanted) AS x WHERE NOT (x = ANY (v_current)) ORDER BY 1);

  DELETE FROM public.calendar_service_assignments a
  WHERE a.service_item_id = p_service_item_id AND a.calendar_id = ANY (v_removed);

  INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
  SELECT x, p_service_item_id FROM unnest(v_added) AS x
  ON CONFLICT (calendar_id, service_item_id) DO NOTHING;

  RETURN jsonb_build_object('status', 'ok', 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
END;
$$;

COMMENT ON FUNCTION public.set_service_calendar_assignments(uuid, uuid, uuid[], uuid[], uuid[]) IS
  'W2: set which calendars offer one service, as an atomic diff with a stale check, limited to '
  'the caller''s calendars when a scope is given. Service role only; the route authorises first.';

-- Both write rows and authorise nothing themselves. PostgreSQL grants EXECUTE to
-- PUBLIC by default and hosted Supabase grants the client roles, so all three
-- are revoked (see 20270108120000).
REVOKE ALL ON FUNCTION public.set_calendar_service_assignments(uuid, uuid, uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_service_calendar_assignments(uuid, uuid, uuid[], uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_calendar_service_assignments(uuid, uuid, uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_service_calendar_assignments(uuid, uuid, uuid[], uuid[], uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- service_items.updated_at, maintained at last (PB-14).
--
-- A save that changes only `sort_order` keeps the old value: dragging services
-- into a new order is not an edit to any of them, and bumping it would make the
-- next save of an open service form answer "changed while you were editing".
-- The value is always set by the database, so a client cannot forge it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_items_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'sort_order' - 'updated_at') = (to_jsonb(OLD) - 'sort_order' - 'updated_at') THEN
    NEW.updated_at := OLD.updated_at;
  ELSE
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.service_items_touch_updated_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS service_items_touch_updated_at ON public.service_items;
CREATE TRIGGER service_items_touch_updated_at
  BEFORE UPDATE ON public.service_items
  FOR EACH ROW EXECUTE FUNCTION public.service_items_touch_updated_at();
