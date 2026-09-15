-- Collective engine, part 8: the host's calendar writes (Docs/collective-one-venue-plan.md §6.7 "Host
-- adds or removes a member calendar", §6.5, Appendix D `collective_set_calendar_offering` and
-- `collective_set_calendar_values`; RT2-17, D6, D29, D56).
--
-- STILL DARK: the offering function acts only for the host of an active replicas-model collective.
--
-- collective_set_calendar_offering: the only writer of another venue's assignment rows. Under the
-- shared collective lock it checks, in order, that the actor hosts the active replicas-model
-- collective (COLLECTIVE_NOT_HOST), the target venue is an active member (COLLECTIVE_VENUE_NOT_MEMBER),
-- the calendar belongs to that venue (COLLECTIVE_CALENDAR_NOT_AT_VENUE), and the offering is active
-- with a service at that venue (COLLECTIVE_REPLICA_NOT_READY): the master at the host, the replica at a
-- member. Assign inserts the row once, stamped. Unassign first counts the calendar's future bookings
-- of that service; unless the route says the host has seen them, it returns them (dates, times and
-- calendar only, no guest fields) and writes nothing. Audited with the before-image; bumped. The
-- routes check the same conditions first and answer them as coded 409s.
--
-- collective_set_calendar_values: writes a calendar's own values for a service. Keys are the seven
-- custom_* columns; an absent key is unchanged and null clears. A value may be set only while the
-- master's staff_may_customize_* flag for that field is on (so never a name or description on an
-- offered service, D29); clearing is always allowed, which is how a flag is turned off (D6). On a
-- card-hold service a set deposit is at least 100 pence. The actor is the calendar's own venue, or
-- the host of a live replicas-model collective the calendar's venue is an active member of. The
-- route is the authorisation point; the function re-checks as defence in depth. Stamped; audited
-- as values_changed and bumped when the calendar's venue is in a live collective.

CREATE OR REPLACE FUNCTION public.collective_set_calendar_offering_core(
  p_collective_id uuid,
  p_item_id uuid,
  p_venue_id uuid,
  p_calendar_id uuid,
  p_action text,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_acknowledge_affected boolean,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_item public.collective_service_items%ROWTYPE;
  v_service_id uuid;
  v_assignment_id uuid;
  v_before jsonb;
  v_affected jsonb;
  v_today date;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('assign', 'unassign') THEN
    RAISE EXCEPTION 'collective_set_calendar_offering: unknown action %', p_action;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));

  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' OR v_collective.service_model <> 'replicas'
     OR p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host of an active collective may change its calendars';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.venue_collective_members
                 WHERE collective_id = p_collective_id AND venue_id = p_venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: that venue is not an active member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.unified_calendars WHERE id = p_calendar_id AND venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_CALENDAR_NOT_AT_VENUE: that calendar is not at that venue';
  END IF;
  SELECT * INTO v_item FROM public.collective_service_items WHERE id = p_item_id AND collective_id = p_collective_id;
  IF NOT FOUND OR v_item.status <> 'active' OR v_item.master_service_id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_REPLICA_NOT_READY: that service is not on the collective page';
  END IF;
  IF p_venue_id = v_collective.host_venue_id THEN
    v_service_id := v_item.master_service_id;
  ELSE
    SELECT replica_service_id INTO v_service_id FROM public.collective_service_replicas
    WHERE collective_service_item_id = p_item_id AND venue_id = p_venue_id AND released_at IS NULL;
    IF v_service_id IS NULL THEN
      RAISE EXCEPTION 'COLLECTIVE_REPLICA_NOT_READY: the service is not ready at that venue yet';
    END IF;
  END IF;
  PERFORM public.collective_engine_test_point('after_membership_check');

  IF p_action = 'assign' THEN
    INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id, updated_at, updated_by_venue_id, updated_by_user_id)
    VALUES (p_calendar_id, v_service_id, p_now, p_actor_venue_id, p_actor_user_id)
    ON CONFLICT (calendar_id, service_item_id) DO NOTHING
    RETURNING id INTO v_assignment_id;
    IF v_assignment_id IS NULL THEN
      SELECT id INTO v_assignment_id FROM public.calendar_service_assignments
      WHERE calendar_id = p_calendar_id AND service_item_id = v_service_id;
      RETURN jsonb_build_object('assignment_id', v_assignment_id, 'affected_bookings', '[]'::jsonb, 'written', false);
    END IF;
    PERFORM public.collective_write_audit(
      p_collective_id, 'calendar_assigned', p_actor_venue_id, p_actor_user_id, NULL, p_venue_id,
      p_item_id, v_service_id, NULL, NULL,
      jsonb_build_object('after', (SELECT to_jsonb(a) FROM public.calendar_service_assignments a WHERE a.id = v_assignment_id)),
      NULL, p_now);
    PERFORM public.collective_bump_revision(p_collective_id, p_now);
    RETURN jsonb_build_object('assignment_id', v_assignment_id, 'affected_bookings', '[]'::jsonb, 'written', true);
  END IF;

  -- Unassign.
  SELECT id, to_jsonb(a) INTO v_assignment_id, v_before FROM public.calendar_service_assignments a
  WHERE calendar_id = p_calendar_id AND service_item_id = v_service_id;
  IF v_assignment_id IS NULL THEN
    RETURN jsonb_build_object('assignment_id', NULL, 'affected_bookings', '[]'::jsonb, 'written', false);
  END IF;

  SELECT (p_now AT TIME ZONE coalesce(v.timezone, 'Europe/London'))::date INTO v_today
  FROM public.venues v WHERE v.id = p_venue_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('booking_date', b.booking_date, 'booking_time', b.booking_time,
                                               'calendar_id', b.calendar_id)
                            ORDER BY b.booking_date, b.booking_time), '[]'::jsonb)
    INTO v_affected
  FROM public.bookings b
  WHERE b.venue_id = p_venue_id AND b.service_item_id = v_service_id AND b.calendar_id = p_calendar_id
    AND b.booking_date >= v_today AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated');
  IF jsonb_array_length(v_affected) > 0 AND NOT coalesce(p_acknowledge_affected, false) THEN
    RETURN jsonb_build_object('assignment_id', v_assignment_id, 'affected_bookings', v_affected, 'written', false);
  END IF;

  DELETE FROM public.calendar_service_assignments WHERE id = v_assignment_id;
  PERFORM public.collective_write_audit(
    p_collective_id, 'calendar_unassigned', p_actor_venue_id, p_actor_user_id, NULL, p_venue_id,
    p_item_id, v_service_id, NULL, NULL,
    jsonb_build_object('before', v_before, 'affected_bookings', jsonb_array_length(v_affected)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);
  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'affected_bookings', v_affected, 'written', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_set_calendar_offering(
  p_collective_id uuid,
  p_item_id uuid,
  p_venue_id uuid,
  p_calendar_id uuid,
  p_action text,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_acknowledge_affected boolean DEFAULT false,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev text := public.collective_engine_enter();
  v_result jsonb;
BEGIN
  v_result := public.collective_set_calendar_offering_core(p_collective_id, p_item_id, p_venue_id, p_calendar_id, p_action,
    p_actor_venue_id, p_actor_user_id, p_acknowledge_affected, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_set_calendar_values_core(
  p_calendar_id uuid,
  p_service_item_id uuid,
  p_values jsonb,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_calendar_venue uuid;
  v_live record;
  v_master public.service_items%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_assignment_id uuid;
  v_key text;
  v_flag boolean;
BEGIN
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'collective_set_calendar_values: values must be an object';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    IF v_key NOT IN ('custom_name', 'custom_description', 'custom_duration_minutes', 'custom_buffer_minutes',
                     'custom_price_pence', 'custom_deposit_pence', 'custom_colour') THEN
      RAISE EXCEPTION 'collective_set_calendar_values: unknown value %', v_key;
    END IF;
  END LOOP;

  SELECT venue_id INTO v_calendar_venue FROM public.unified_calendars WHERE id = p_calendar_id;
  IF v_calendar_venue IS NULL THEN
    RAISE EXCEPTION 'collective_set_calendar_values: calendar not found';
  END IF;

  -- The calendar's venue's live replicas-model collective, if any.
  SELECT c.id AS collective_id, c.host_venue_id INTO v_live
  FROM public.venue_collective_members m JOIN public.venue_collectives c ON c.id = m.collective_id
  WHERE m.venue_id = v_calendar_venue AND m.status = 'active' AND c.status = 'active' AND c.service_model = 'replicas'
  LIMIT 1;

  IF p_actor_venue_id IS DISTINCT FROM v_calendar_venue
     AND (v_live.collective_id IS NULL OR p_actor_venue_id IS DISTINCT FROM v_live.host_venue_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the calendar''s venue or its collective''s host may change these values';
  END IF;
  IF v_live.collective_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || v_live.collective_id::text, 0));
  END IF;

  SELECT a.id, jsonb_build_object(
           'custom_name', a.custom_name, 'custom_description', a.custom_description,
           'custom_duration_minutes', a.custom_duration_minutes, 'custom_buffer_minutes', a.custom_buffer_minutes,
           'custom_price_pence', a.custom_price_pence, 'custom_deposit_pence', a.custom_deposit_pence,
           'custom_colour', a.custom_colour)
    INTO v_assignment_id, v_before
  FROM public.calendar_service_assignments a
  WHERE a.calendar_id = p_calendar_id AND a.service_item_id = p_service_item_id
  FOR UPDATE;
  IF v_assignment_id IS NULL THEN
    RAISE EXCEPTION 'collective_set_calendar_values: that calendar does not offer that service';
  END IF;

  -- The master decides the flags: the service itself, or its master through a live link.
  SELECT s.* INTO v_master
  FROM public.collective_service_replicas l
  JOIN public.collective_service_items i ON i.id = l.collective_service_item_id
  JOIN public.service_items s ON s.id = i.master_service_id
  WHERE l.replica_service_id = p_service_item_id AND l.released_at IS NULL;
  IF v_master.id IS NULL THEN
    SELECT * INTO v_master FROM public.service_items WHERE id = p_service_item_id;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_values) LOOP
    CONTINUE WHEN p_values->v_key = 'null'::jsonb;
    v_flag := CASE v_key
      WHEN 'custom_name' THEN v_master.staff_may_customize_name
      WHEN 'custom_description' THEN v_master.staff_may_customize_description
      WHEN 'custom_duration_minutes' THEN v_master.staff_may_customize_duration
      WHEN 'custom_buffer_minutes' THEN v_master.staff_may_customize_buffer
      WHEN 'custom_price_pence' THEN v_master.staff_may_customize_price
      WHEN 'custom_deposit_pence' THEN v_master.staff_may_customize_deposit
      WHEN 'custom_colour' THEN v_master.staff_may_customize_colour
    END;
    IF v_flag IS NOT TRUE THEN
      RAISE EXCEPTION 'collective_set_calendar_values: % is not allowed on this service', v_key;
    END IF;
  END LOOP;
  IF v_master.payment_requirement::text = 'card_hold'
     AND jsonb_typeof(p_values->'custom_deposit_pence') = 'number'
     AND (p_values->>'custom_deposit_pence')::integer < 100 THEN
    RAISE EXCEPTION 'collective_set_calendar_values: a no-show fee is at least 100 pence';
  END IF;

  UPDATE public.calendar_service_assignments a SET
    custom_name = CASE WHEN p_values ? 'custom_name' THEN p_values->>'custom_name' ELSE a.custom_name END,
    custom_description = CASE WHEN p_values ? 'custom_description' THEN p_values->>'custom_description' ELSE a.custom_description END,
    custom_duration_minutes = CASE WHEN p_values ? 'custom_duration_minutes' THEN (p_values->>'custom_duration_minutes')::integer ELSE a.custom_duration_minutes END,
    custom_buffer_minutes = CASE WHEN p_values ? 'custom_buffer_minutes' THEN (p_values->>'custom_buffer_minutes')::integer ELSE a.custom_buffer_minutes END,
    custom_price_pence = CASE WHEN p_values ? 'custom_price_pence' THEN (p_values->>'custom_price_pence')::integer ELSE a.custom_price_pence END,
    custom_deposit_pence = CASE WHEN p_values ? 'custom_deposit_pence' THEN (p_values->>'custom_deposit_pence')::integer ELSE a.custom_deposit_pence END,
    custom_colour = CASE WHEN p_values ? 'custom_colour' THEN p_values->>'custom_colour' ELSE a.custom_colour END,
    updated_by_venue_id = p_actor_venue_id,
    updated_by_user_id = p_actor_user_id
  WHERE a.id = v_assignment_id
  RETURNING jsonb_build_object(
           'custom_name', a.custom_name, 'custom_description', a.custom_description,
           'custom_duration_minutes', a.custom_duration_minutes, 'custom_buffer_minutes', a.custom_buffer_minutes,
           'custom_price_pence', a.custom_price_pence, 'custom_deposit_pence', a.custom_deposit_pence,
           'custom_colour', a.custom_colour)
    INTO v_after;

  IF v_live.collective_id IS NOT NULL AND v_after IS DISTINCT FROM v_before THEN
    PERFORM public.collective_write_audit(
      v_live.collective_id, 'values_changed', p_actor_venue_id, p_actor_user_id, NULL, v_calendar_venue,
      NULL, p_service_item_id, NULL, NULL,
      jsonb_build_object('before', v_before, 'after', v_after, 'calendar_id', p_calendar_id),
      NULL, p_now);
    PERFORM public.collective_bump_revision(v_live.collective_id, p_now);
  END IF;

  RETURN jsonb_build_object('assignment_id', v_assignment_id, 'before', v_before, 'after', v_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_set_calendar_values(
  p_calendar_id uuid,
  p_service_item_id uuid,
  p_values jsonb,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev text := public.collective_engine_enter();
  v_result jsonb;
BEGIN
  v_result := public.collective_set_calendar_values_core(p_calendar_id, p_service_item_id, p_values, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_set_calendar_offering_core(uuid, uuid, uuid, uuid, text, uuid, uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_set_calendar_offering(uuid, uuid, uuid, uuid, text, uuid, uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_set_calendar_values_core(uuid, uuid, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_set_calendar_values(uuid, uuid, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_set_calendar_offering(uuid, uuid, uuid, uuid, text, uuid, uuid, boolean, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_set_calendar_values(uuid, uuid, jsonb, uuid, uuid, timestamptz) TO service_role;
