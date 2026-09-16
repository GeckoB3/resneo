-- D46 revised, both service models (2026-09-16): the move also works on a collective still on the
-- older model ("legacy_copies"), where each venue offers its own copy of a service and the page
-- links them through collective_service_providers. Found on staging, whose only collective is on
-- that model: a Beard Trim booking at the host could not move to the member's calendar that offers
-- the member's own Beard Trim, because the function only looked for shared-services replicas.
--
-- collective_move_booking keeps its signature. What changes:
--   * any live collective both venues belong to qualifies (active, a combined page, not paused);
--   * on the older model the offering is an active item with an active provider for the booked
--     service at the booking's venue, and the target service is that item's active provider at
--     the target venue for the target calendar (named on the provider, or the venue-wide provider
--     with the calendar assigned to its service); options and add-ons are matched by name, since
--     the older copies carry no replica_of keys;
--   * the shared-services path is unchanged.

CREATE OR REPLACE FUNCTION public.collective_move_booking(
  p_booking_id uuid,
  p_target_calendar_id uuid,
  p_booking_date date,
  p_booking_time time,
  p_target_guest_id uuid,
  p_actor_venue_id uuid,
  p_actor_staff_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_old public.bookings%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_target_venue uuid;
  v_item uuid;
  v_master uuid;
  v_target_service uuid;
  v_variant_key uuid;
  v_target_variant uuid;
  v_shift interval;
  v_row jsonb;
  v_key text;
  v_new uuid := gen_random_uuid();
  v_addon record;
  v_target_addon uuid;
  v_target_group uuid;
BEGIN
  SELECT * INTO v_old FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_NOT_ALLOWED: the booking was not found';
  END IF;

  SELECT venue_id INTO v_target_venue FROM public.unified_calendars
  WHERE id = p_target_calendar_id AND is_active;
  IF v_target_venue IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar is not taking bookings';
  END IF;
  IF v_target_venue = v_old.venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_NOT_ALLOWED: the calendar is at the same venue';
  END IF;

  -- The one live shared-services collective both venues are in, and the actor with them.
  SELECT c.* INTO v_collective
  FROM public.venue_collectives c
  WHERE c.status = 'active' AND c.page_mode = 'unified_catalog' AND c.paused_at IS NULL
    AND EXISTS (SELECT 1 FROM public.venue_collective_members m
                WHERE m.collective_id = c.id AND m.venue_id = v_old.venue_id AND m.status = 'active')
    AND EXISTS (SELECT 1 FROM public.venue_collective_members m
                WHERE m.collective_id = c.id AND m.venue_id = v_target_venue AND m.status = 'active')
    AND EXISTS (SELECT 1 FROM public.venue_collective_members m
                WHERE m.collective_id = c.id AND m.venue_id = p_actor_venue_id AND m.status = 'active')
  ORDER BY c.id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_NOT_ALLOWED: both venues must be in the same live collective';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || v_collective.id::text, 0));

  IF v_old.status NOT IN ('Booked', 'Confirmed') THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_ATTACHED: status';
  END IF;
  IF v_old.group_booking_id IS NOT NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_ATTACHED: visit';
  END IF;
  IF coalesce(v_old.deposit_status, 'Not Required') NOT IN ('Not Required', 'Waived')
     OR coalesce(v_old.deposit_amount_pence, 0) <> 0
     OR v_old.stripe_payment_intent_id IS NOT NULL
     OR coalesce(v_old.payment_state, 'unpaid') <> 'unpaid'
     OR coalesce(v_old.amount_paid_pence, 0) <> 0
     OR coalesce(v_old.tip_amount_pence, 0) <> 0
     OR EXISTS (SELECT 1 FROM public.booking_card_holds h WHERE h.booking_id = p_booking_id)
     OR EXISTS (SELECT 1 FROM public.booking_payments p WHERE p.booking_id = p_booking_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_ATTACHED: payment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.compliance_records r
             WHERE r.booking_id = p_booking_id AND r.status = 'completed') THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_ATTACHED: forms';
  END IF;

  IF p_target_guest_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.guests g WHERE g.id = p_target_guest_id AND g.venue_id = v_target_venue
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_MOVE_NOT_ALLOWED: the client record must belong to the new venue';
  END IF;

  IF v_collective.service_model = 'replicas' THEN
    -- The offering the booked service stands for: a live replica at the booking's venue, or the master.
    SELECT r.collective_service_item_id INTO v_item
    FROM public.collective_service_replicas r
    WHERE r.collective_id = v_collective.id AND r.venue_id = v_old.venue_id
      AND r.replica_service_id = v_old.service_item_id AND r.released_at IS NULL
    LIMIT 1;
    IF v_item IS NULL THEN
      SELECT i.id INTO v_item FROM public.collective_service_items i
      WHERE i.collective_id = v_collective.id AND i.master_service_id = v_old.service_item_id
        AND v_old.venue_id = v_collective.host_venue_id
      LIMIT 1;
    END IF;
    SELECT i.master_service_id INTO v_master FROM public.collective_service_items i
    WHERE i.id = v_item AND i.status = 'active';
    IF v_master IS NULL THEN
      RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: the service is not on the collective page';
    END IF;

    IF v_target_venue = v_collective.host_venue_id THEN
      v_target_service := v_master;
    ELSE
      SELECT r.replica_service_id INTO v_target_service
      FROM public.collective_service_replicas r
      WHERE r.collective_service_item_id = v_item AND r.venue_id = v_target_venue
        AND r.released_at IS NULL AND r.applied_revision = r.desired_revision;
    END IF;
    IF v_target_service IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.calendar_service_assignments a
      WHERE a.calendar_id = p_target_calendar_id AND a.service_item_id = v_target_service
    ) THEN
      RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar does not offer the service';
    END IF;

    IF v_old.service_variant_id IS NOT NULL THEN
      SELECT coalesce(v.replica_of_variant_id, v.id) INTO v_variant_key
      FROM public.service_variants v WHERE v.id = v_old.service_variant_id;
      SELECT v.id INTO v_target_variant FROM public.service_variants v
      WHERE v.service_item_id = v_target_service AND v.is_active
        AND coalesce(v.replica_of_variant_id, v.id) = v_variant_key
      LIMIT 1;
      IF v_target_variant IS NULL THEN
        RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar does not offer the chosen option';
      END IF;
    END IF;
  ELSE
    -- The older model: the page's offering links each venue's own copy through its providers.
    SELECT p.item_id INTO v_item
    FROM public.collective_service_providers p
    JOIN public.collective_service_items i ON i.id = p.item_id
    WHERE i.collective_id = v_collective.id AND i.status = 'active' AND p.status = 'active'
      AND p.venue_id = v_old.venue_id AND p.source_service_id = v_old.service_item_id
    ORDER BY (i.id = v_old.collective_service_item_id) DESC NULLS LAST, i.id
    LIMIT 1;
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: the service is not on the collective page';
    END IF;
    SELECT p.source_service_id INTO v_target_service
    FROM public.collective_service_providers p
    JOIN public.service_items s ON s.id = p.source_service_id AND s.venue_id = v_target_venue AND s.is_active
    WHERE p.item_id = v_item AND p.status = 'active' AND p.venue_id = v_target_venue
      AND (p.practitioner_id = p_target_calendar_id
           OR (p.practitioner_id IS NULL AND EXISTS (
                 SELECT 1 FROM public.calendar_service_assignments a
                 WHERE a.calendar_id = p_target_calendar_id AND a.service_item_id = p.source_service_id)))
    ORDER BY (p.practitioner_id IS NULL), p.id
    LIMIT 1;
    IF v_target_service IS NULL THEN
      RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar does not offer the service';
    END IF;

    IF v_old.service_variant_id IS NOT NULL THEN
      SELECT t.id INTO v_target_variant
      FROM public.service_variants s
      JOIN public.service_variants t
        ON t.service_item_id = v_target_service AND t.is_active AND lower(t.name) = lower(s.name)
      WHERE s.id = v_old.service_variant_id
      LIMIT 1;
      IF v_target_variant IS NULL THEN
        RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar does not offer the chosen option';
      END IF;
    END IF;
  END IF;

  -- The copy: every column, less what describes the original's own history.
  v_shift := (p_booking_date + p_booking_time) - (v_old.booking_date + v_old.booking_time);
  v_row := to_jsonb(v_old) - ARRAY[
    'confirm_token_hash', 'confirm_token_used_at', 'client_arrived_at', 'checked_in_at',
    'staff_attendance_confirmed_at', 'guest_attendance_confirmed_at', 'actual_seated_time',
    'actual_departed_time', 'cancellation_actor_type', 'cancelled_by_staff_id',
    'last_modified_by_linked_venue_id'];
  FOR v_key IN SELECT k FROM jsonb_object_keys(v_row) AS k LOOP
    IF v_key LIKE '%\_sent\_at' OR v_key LIKE '%token%' THEN
      v_row := v_row - v_key;
    END IF;
  END LOOP;
  v_row := v_row || jsonb_build_object(
    'id', v_new,
    'venue_id', v_target_venue,
    'guest_id', p_target_guest_id,
    'calendar_id', p_target_calendar_id,
    'practitioner_id', NULL,
    'service_item_id', v_target_service,
    'service_variant_id', v_target_variant,
    'booking_date', p_booking_date,
    'booking_time', p_booking_time,
    'booking_end_time', CASE WHEN v_old.booking_end_time IS NULL THEN NULL
                             ELSE (v_old.booking_date + v_old.booking_end_time + v_shift)::time END,
    'estimated_end_time', CASE WHEN v_old.estimated_end_time IS NULL THEN NULL
                               ELSE v_old.estimated_end_time + v_shift END,
    'cancellation_deadline', CASE WHEN v_old.cancellation_deadline IS NULL THEN NULL
                                  ELSE v_old.cancellation_deadline + v_shift END,
    'collective_id', v_collective.id,
    'collective_service_item_id', v_item,
    'created_by_linked_venue_id', CASE WHEN p_actor_venue_id = v_target_venue THEN NULL ELSE p_actor_venue_id END,
    'suppress_import_comms', false,
    'created_at', p_now,
    'updated_at', p_now);
  INSERT INTO public.bookings SELECT * FROM jsonb_populate_record(NULL::public.bookings, v_row);

  FOR v_addon IN SELECT * FROM public.booking_addons WHERE booking_id = p_booking_id LOOP
    v_target_addon := NULL;
    v_target_group := NULL;
    IF v_addon.addon_id IS NOT NULL THEN
      IF v_collective.service_model = 'replicas' THEN
        SELECT t.id INTO v_target_addon FROM public.addons s
        JOIN public.addons t ON coalesce(t.replica_of_addon_id, t.id) = coalesce(s.replica_of_addon_id, s.id)
        WHERE s.id = v_addon.addon_id AND t.venue_id = v_target_venue
        LIMIT 1;
      ELSE
        SELECT t.id INTO v_target_addon
        FROM public.addons t
        JOIN public.service_addon_groups l
          ON l.addon_group_id = t.addon_group_id AND l.service_item_id = v_target_service
        WHERE t.venue_id = v_target_venue AND t.is_active AND lower(t.name) = lower(v_addon.addon_name_snapshot)
        LIMIT 1;
      END IF;
      IF v_target_addon IS NULL THEN
        RAISE EXCEPTION 'COLLECTIVE_MOVE_SERVICE: that calendar does not offer an extra that was booked';
      END IF;
    END IF;
    IF v_addon.addon_group_id IS NOT NULL THEN
      IF v_collective.service_model = 'replicas' THEN
        SELECT t.id INTO v_target_group FROM public.addon_groups s
        JOIN public.addon_groups t
          ON coalesce(t.replica_of_addon_group_id, t.id) = coalesce(s.replica_of_addon_group_id, s.id)
        WHERE s.id = v_addon.addon_group_id AND t.venue_id = v_target_venue
        LIMIT 1;
      ELSE
        SELECT a.addon_group_id INTO v_target_group FROM public.addons a WHERE a.id = v_target_addon;
      END IF;
    END IF;
    INSERT INTO public.booking_addons (
      booking_id, addon_id, addon_group_id, booking_segment_index, addon_name_snapshot,
      addon_group_name_snapshot, price_pence_at_booking, duration_minutes_at_booking,
      cost_to_business_pence_at_booking)
    VALUES (
      v_new, v_target_addon, v_target_group, v_addon.booking_segment_index, v_addon.addon_name_snapshot,
      v_addon.addon_group_name_snapshot, v_addon.price_pence_at_booking, v_addon.duration_minutes_at_booking,
      NULL);
  END LOOP;

  UPDATE public.bookings
  SET status = 'Cancelled', cancellation_actor_type = 'staff', cancelled_by_staff_id = p_actor_staff_id,
      updated_at = p_now
  WHERE id = p_booking_id;

  INSERT INTO public.events (venue_id, booking_id, event_type, payload, created_at)
  VALUES
    (v_old.venue_id, p_booking_id, 'booking_moved_out',
     jsonb_build_object('to_booking_id', v_new, 'to_venue_id', v_target_venue,
                        'collective_id', v_collective.id, 'actor_venue_id', p_actor_venue_id,
                        'actor_staff_id', p_actor_staff_id), p_now),
    (v_target_venue, v_new, 'booking_moved_in',
     jsonb_build_object('from_booking_id', p_booking_id, 'from_venue_id', v_old.venue_id,
                        'collective_id', v_collective.id, 'actor_venue_id', p_actor_venue_id,
                        'actor_staff_id', p_actor_staff_id), p_now);

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_move_booking(uuid, uuid, date, time, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_move_booking(uuid, uuid, date, time, uuid, uuid, uuid, timestamptz) TO service_role;
