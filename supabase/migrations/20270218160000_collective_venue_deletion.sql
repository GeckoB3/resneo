-- W7: deleting a venue that is part of a collective (plan §6.7 "Venue deletion", T22; CB-16, DB-09).
--
-- A cascade fires no status trigger, so admin_hard_delete_venue now runs the engine first:
--   * a member of a shared-services collective is released with the reason 'venue_deleted';
--   * a host's shared-services collective ends through collective_dissolve ('host_venue_deleted'),
--     which releases every member with its services and clears the replica_of_* pointers that would
--     otherwise stop the host's services from being deleted.
-- Then, as before, the venue's account links are terminated and the venue deleted.
--
-- The host's collective row, its memberships and its links cascade away with the host venue. The
-- notice jobs do not (collective_operations has no foreign keys), so the end notice (N19) is given
-- what it needs to be sent without them: the collective's name and the venues that were live. A
-- deleted member's release follow-up carries the venue's name for the host's notice (N16).
--
-- Older (legacy_copies) collectives are left to the cascade, exactly as before.
--
-- Also fixed here: the function still switched off events_append_only, a trigger 20260624150000
-- dropped. ALTER TABLE ... DISABLE TRIGGER on a missing trigger raises, so every hard delete (the
-- venue-hard-delete cron) has failed since that migration. The events rows are deleted as before.

CREATE OR REPLACE FUNCTION public.admin_hard_delete_venue(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_ids uuid[];
  v_link_partners jsonb;
  v_venue_name text;
  r record;
  v_live jsonb;
BEGIN
  IF p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue id required';
  END IF;

  SELECT name INTO v_venue_name FROM venues WHERE id = p_venue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'venue not found: %', p_venue_id;
  END IF;

  -- Collectives the venue hosts end, through the engine.
  FOR r IN
    SELECT c.id, c.name FROM public.venue_collectives c
    WHERE c.host_venue_id = p_venue_id AND c.status = 'active' AND c.service_model IN ('migrating', 'replicas')
    ORDER BY c.id
  LOOP
    SELECT coalesce(jsonb_agg(m.venue_id ORDER BY m.venue_id), '[]'::jsonb) INTO v_live
    FROM public.venue_collective_members m
    WHERE m.collective_id = r.id AND m.status = 'active' AND m.venue_id <> p_venue_id;
    PERFORM public.collective_dissolve(r.id, 'host_venue_deleted', NULL, NULL, now());
    UPDATE public.collective_operations
    SET progress = progress || jsonb_build_object('collective_name', r.name, 'venue_ids', v_live,
                                                  'host_name', v_venue_name, 'host_deleted', true),
        venue_id = NULL
    WHERE collective_id = r.id AND kind = 'notice' AND idempotency_key = 'dissolve:' || r.id::text;
  END LOOP;

  -- Collectives the venue belongs to release it, through the engine.
  FOR r IN
    SELECT m.id, m.collective_id FROM public.venue_collective_members m
    JOIN public.venue_collectives c ON c.id = m.collective_id
    WHERE m.venue_id = p_venue_id AND m.status = 'active' AND c.status = 'active'
      AND c.service_model IN ('migrating', 'replicas')
    ORDER BY m.id
  LOOP
    PERFORM public.collective_release_member(r.id, 'venue_deleted', NULL, NULL, now());
    UPDATE public.collective_operations
    SET progress = progress || jsonb_build_object('venue_name', v_venue_name)
    WHERE idempotency_key = 'release:' || r.id::text;
  END LOOP;

  v_link_partners := terminate_account_links_for_venue_deletion(p_venue_id);

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO staff_ids FROM staff WHERE venue_id = p_venue_id;

  IF cardinality(staff_ids) > 0 THEN
    UPDATE practitioner_calendar_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE calendar_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE table_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE booking_table_assignments SET assigned_by = NULL WHERE assigned_by = ANY (staff_ids);
    UPDATE table_statuses SET updated_by = NULL WHERE updated_by = ANY (staff_ids);
    UPDATE unified_calendars SET staff_id = NULL WHERE staff_id = ANY (staff_ids);
  END IF;

  UPDATE table_statuses ts
  SET booking_id = NULL
  FROM venue_tables vt
  WHERE ts.table_id = vt.id AND vt.venue_id = p_venue_id;

  -- events_append_only was dropped by 20260624150000, so there is no trigger to switch off here;
  -- the old DISABLE TRIGGER line raised "does not exist" and failed every hard delete since.
  DELETE FROM events e
  WHERE e.venue_id = p_venue_id
     OR e.booking_id IN (SELECT b.id FROM bookings b WHERE b.venue_id = p_venue_id);

  ALTER TABLE booking_table_assignments DISABLE TRIGGER trg_log_table_assignment;
  DELETE FROM booking_table_assignments
  WHERE booking_id IN (SELECT b.id FROM bookings b WHERE b.venue_id = p_venue_id);
  ALTER TABLE booking_table_assignments ENABLE TRIGGER trg_log_table_assignment;

  DELETE FROM bookings WHERE venue_id = p_venue_id;

  DELETE FROM venues WHERE id = p_venue_id;

  RETURN v_link_partners;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_hard_delete_venue(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_hard_delete_venue(uuid) TO service_role;
