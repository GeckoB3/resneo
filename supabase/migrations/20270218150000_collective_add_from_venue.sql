-- W7: host-initiated adoption, "Add from another venue" (plan §6.7; Appendix E contract 1 and 10;
-- UX spec `svc.addFrom.*`, `svc.member.adopt.*`, N26; test OFF-06).
--
-- STILL DARK: both functions refuse a collective that is not on the replicas model.
--
-- collective_add_from_venue(collective, source venue, source service, actor venue, actor user, now)
--   The host picks one of a member's own services. It is copied into a new service at the host
--   (the registry's host columns, with the member's capacity and instructions as the seed, and its
--   active options), offered through collective_offer_service_core, and recorded as a pending
--   adoption for that member: adoption_requested, and an N26 notice job. The member's own link for
--   the new offering is held back (released before it was ever applied), so nothing is copied into
--   the member's account until it answers.
--
-- collective_answer_adoption(collective, item, venue, choice, option map, actor venue, actor user, now)
--   'use_mine': the member's service becomes the replica (provenance adopted), its bookings are
--   snapshotted first (PRICE-10) and its options mapped to the host's. 'keep_separate': a new
--   replica is created and the member's service stays its own, parked while the member is live
--   (D2). The member answers for itself; the system (both actor ids NULL) applies the day-14 default.
--   Only the one adoption named is settled, never any other that is still waiting.
--
-- Pending is derived from the append-only audit: an adoption_requested row for the item and venue
-- with no adoption_answered row after it. No table records it.

CREATE OR REPLACE FUNCTION public.collective_adoption_pending(p_item_id uuid, p_venue_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- The member's service named by the open request, or NULL when nothing is waiting.
  SELECT r.service_id FROM public.collective_audit_events r
  WHERE r.item_id = p_item_id AND r.target_venue_id = p_venue_id AND r.event_type = 'adoption_requested'
    AND NOT EXISTS (
      SELECT 1 FROM public.collective_audit_events a
      WHERE a.item_id = p_item_id AND a.target_venue_id = p_venue_id AND a.event_type = 'adoption_answered'
        AND a.created_at >= r.created_at)
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.collective_add_from_venue_core(
  p_collective_id uuid,
  p_source_venue_id uuid,
  p_source_service_id uuid,
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
  v_collective public.venue_collectives%ROWTYPE;
  v_source public.service_items%ROWTYPE;
  v_member_id uuid;
  v_cols text[];
  v_list text;
  v_master_id uuid;
  v_offer jsonb;
  v_item_id uuid;
  v_links jsonb := '[]'::jsonb;
  v_link jsonb;
BEGIN
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may add a service from another venue';
  END IF;
  SELECT id INTO v_member_id FROM public.venue_collective_members
  WHERE collective_id = p_collective_id AND venue_id = p_source_venue_id AND status = 'active';
  IF v_member_id IS NULL OR p_source_venue_id = v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: that venue is not a member of the collective';
  END IF;
  SELECT * INTO v_source FROM public.service_items WHERE id = p_source_service_id;
  IF NOT FOUND OR v_source.venue_id <> p_source_venue_id OR NOT v_source.is_active THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: the service is not one of that venue''s own active services';
  END IF;
  IF EXISTS (SELECT 1 FROM public.collective_service_replicas
             WHERE replica_service_id = p_source_service_id AND released_at IS NULL) THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: that service already comes from the collective';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.collective_service_items i
    WHERE i.collective_id = p_collective_id
      AND public.collective_adoption_pending(i.id, p_source_venue_id) = p_source_service_id
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_ADOPTION_PENDING: that service is already waiting for the venue''s answer';
  END IF;

  -- The host's copy: the host columns, seeded with the venue columns, active.
  v_cols := public.collective_registry_columns('service_items', ARRAY['host', 'venue']);
  SELECT string_agg(pg_catalog.quote_ident(c), ', ') INTO v_list FROM unnest(v_cols) c;
  EXECUTE format(
    'INSERT INTO public.service_items (venue_id, is_active, %1$s) SELECT $1, true, %1$s FROM public.service_items WHERE id = $2 RETURNING id',
    v_list)
  INTO v_master_id USING v_collective.host_venue_id, p_source_service_id;

  v_cols := public.collective_registry_columns('service_variants', ARRAY['host']);
  SELECT string_agg(pg_catalog.quote_ident(c), ', ') INTO v_list FROM unnest(v_cols) c;
  EXECUTE format(
    'INSERT INTO public.service_variants (venue_id, service_item_id, is_active, %1$s) '
    'SELECT $1, $2, true, %1$s FROM public.service_variants WHERE service_item_id = $3 AND is_active ORDER BY sort_order, id',
    v_list)
  USING v_collective.host_venue_id, v_master_id, p_source_service_id;

  v_offer := public.collective_offer_service_core(p_collective_id, v_master_id, p_actor_venue_id, p_actor_user_id, p_now);
  v_item_id := (v_offer->>'item_id')::uuid;

  -- Hold the member's own link back until it answers: released before it was ever applied, so the
  -- answer creates or adopts a fresh one and nothing is copied into its account meanwhile.
  UPDATE public.collective_service_replicas
  SET released_at = p_now, lease_until = NULL
  WHERE collective_service_item_id = v_item_id AND venue_id = p_source_venue_id
    AND released_at IS NULL AND replica_service_id IS NULL;

  FOR v_link IN SELECT l FROM jsonb_array_elements(coalesce(v_offer->'links', '[]'::jsonb)) l LOOP
    IF v_link->>'venue_id' <> p_source_venue_id::text THEN
      v_links := v_links || v_link;
    END IF;
  END LOOP;

  PERFORM public.collective_write_audit(
    p_collective_id, 'adoption_requested', p_actor_venue_id, p_actor_user_id, NULL, p_source_venue_id,
    v_item_id, p_source_service_id, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('source_service_id', p_source_service_id,
                                                   'master_service_id', v_master_id)),
    NULL, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, p_source_venue_id, 'notice',
          'adopt:' || v_item_id::text || ':' || p_source_venue_id::text || ':' || extract(epoch FROM p_now)::bigint::text,
          jsonb_build_object('notice', 'N26', 'item_id', v_item_id, 'source_service_id', p_source_service_id))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('item_id', v_item_id, 'master_service_id', v_master_id, 'links', v_links);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_add_from_venue(
  p_collective_id uuid,
  p_source_venue_id uuid,
  p_source_service_id uuid,
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
  v_result := public.collective_add_from_venue_core(p_collective_id, p_source_venue_id, p_source_service_id,
                                                    p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_answer_adoption_core(
  p_collective_id uuid,
  p_item_id uuid,
  p_venue_id uuid,
  p_choice text,
  p_option_map jsonb,
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
  v_collective public.venue_collectives%ROWTYPE;
  v_item public.collective_service_items%ROWTYPE;
  v_member_id uuid;
  v_mine public.service_items%ROWTYPE;
  v_source_id uuid;
  v_link_id uuid;
  v_map jsonb;
  v_system boolean := p_actor_venue_id IS NULL AND p_actor_user_id IS NULL;
BEGIN
  IF p_choice IS NULL OR p_choice NOT IN ('use_mine', 'keep_separate') THEN
    RAISE EXCEPTION 'collective_answer_adoption: unknown choice %', p_choice;
  END IF;
  IF NOT v_system AND p_actor_venue_id IS DISTINCT FROM p_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: only the venue that was asked may answer';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));

  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  SELECT * INTO v_item FROM public.collective_service_items WHERE id = p_item_id AND collective_id = p_collective_id;
  IF NOT FOUND OR v_item.status <> 'active' OR v_item.master_service_id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_ADOPTION_NOT_PENDING: that service is no longer on the page';
  END IF;
  SELECT id INTO v_member_id FROM public.venue_collective_members
  WHERE collective_id = p_collective_id AND venue_id = p_venue_id AND status = 'active';
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: that venue is not a member of the collective';
  END IF;

  -- One answer per request, under a lock on the member's row so two answers cannot both land.
  PERFORM 1 FROM public.venue_collective_members WHERE id = v_member_id FOR UPDATE;
  v_source_id := public.collective_adoption_pending(p_item_id, p_venue_id);
  IF v_source_id IS NULL OR EXISTS (
    SELECT 1 FROM public.collective_service_replicas
    WHERE collective_service_item_id = p_item_id AND venue_id = p_venue_id AND released_at IS NULL
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_ADOPTION_NOT_PENDING: that question has already been answered';
  END IF;

  IF p_choice = 'use_mine' THEN
    SELECT * INTO v_mine FROM public.service_items WHERE id = v_source_id;
    IF NOT FOUND OR v_mine.venue_id <> p_venue_id
       OR EXISTS (SELECT 1 FROM public.collective_service_replicas
                  WHERE replica_service_id = v_mine.id AND released_at IS NULL) THEN
      RAISE EXCEPTION 'COLLECTIVE_ADOPTION_NOT_PENDING: that service can no longer be used for this';
    END IF;

    -- PRICE-10: the bookings keep the price they were made at before the apply converges it.
    UPDATE public.bookings b
    SET service_price_snapshot_pence = public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
    WHERE b.service_item_id = v_mine.id AND b.service_price_snapshot_pence IS NULL
      AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;

    FOR v_map IN SELECT m FROM jsonb_array_elements(coalesce(p_option_map, '[]'::jsonb)) m LOOP
      UPDATE public.service_variants mv
      SET replica_of_variant_id = hv.id
      FROM public.service_variants hv
      WHERE mv.id = (v_map->>'my_variant_id')::uuid AND mv.service_item_id = v_mine.id
        AND hv.id = nullif(v_map->>'host_variant_id', '')::uuid AND hv.service_item_id = v_item.master_service_id;
    END LOOP;

    INSERT INTO public.collective_service_replicas
      (collective_id, collective_service_item_id, member_id, venue_id, replica_service_id, provenance, behind_since)
    VALUES (p_collective_id, p_item_id, v_member_id, p_venue_id, v_mine.id, 'adopted', p_now)
    RETURNING id INTO v_link_id;
  ELSE
    INSERT INTO public.collective_service_replicas
      (collective_id, collective_service_item_id, member_id, venue_id, provenance, behind_since)
    VALUES (p_collective_id, p_item_id, v_member_id, p_venue_id, 'created', p_now)
    RETURNING id INTO v_link_id;
  END IF;

  PERFORM public.collective_write_audit(
    p_collective_id, 'adoption_answered', p_actor_venue_id, p_actor_user_id,
    CASE WHEN v_system THEN 'collective-adoption-default' END,
    p_venue_id, p_item_id, v_source_id, v_link_id, NULL,
    jsonb_build_object('after', jsonb_build_object(
      'choice', p_choice, 'my_service_id', v_source_id, 'default', v_system,
      'option_map', CASE WHEN p_choice = 'use_mine' THEN coalesce(p_option_map, '[]'::jsonb) ELSE '[]'::jsonb END)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  RETURN jsonb_build_object('link_id', v_link_id, 'choice', p_choice,
                            'provenance', CASE WHEN p_choice = 'use_mine' THEN 'adopted' ELSE 'created' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_answer_adoption(
  p_collective_id uuid,
  p_item_id uuid,
  p_venue_id uuid,
  p_choice text,
  p_option_map jsonb,
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
  v_result := public.collective_answer_adoption_core(p_collective_id, p_item_id, p_venue_id, p_choice, p_option_map,
                                                     p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_adoption_pending(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_add_from_venue_core(uuid, uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_add_from_venue(uuid, uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_answer_adoption_core(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_answer_adoption(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_adoption_pending(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_add_from_venue(uuid, uuid, uuid, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_answer_adoption(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz) TO service_role;
