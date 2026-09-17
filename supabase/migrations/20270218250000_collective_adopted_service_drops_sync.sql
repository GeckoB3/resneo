-- A service adopted as a replica drops the older model's sync bookkeeping
-- (Docs/collective-one-venue-plan.md W9; invariant I23).
--
-- Found on production 2026-09-17, migrating Caireen Langsford Hair: two services the owner chose to
-- add to the page were adopted as replicas ("use mine") while still carrying `sync_state = 'linked'`
-- and a `synced_from_service_id`. The migration's own clearing runs in `_begin`, over the links it
-- creates there; an adoption in `_finish`, and every live "Add from another venue" answer, missed it.
--
-- Two writers for one row is the harm: the engine applies the master's shape, and the legacy
-- service-sync pushes the origin's shape over it. Nothing a guest sees, but the row is no longer
-- the engine's alone, and I23 is a gate invariant.

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

    -- The engine owns this service from now on, so the older model's bookkeeping goes with the
    -- adoption. Left behind, `sync_state = 'linked'` keeps the legacy service-sync pushing the
    -- origin's shape onto a row the engine also writes, and I23 fails (production, 2026-09-17).
    UPDATE public.service_items
    SET synced_from_service_id = NULL, sync_state = 'independent', synced_at = NULL
    WHERE id = v_mine.id
      AND (synced_from_service_id IS NOT NULL OR sync_state <> 'independent' OR synced_at IS NOT NULL);

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

-- The rows this already left behind, on any environment: a live replica never follows a legacy
-- origin. Narrow by design (live replicas only), so a legacy_copies collective is untouched.
UPDATE public.service_items s
SET synced_from_service_id = NULL, sync_state = 'independent', synced_at = NULL
WHERE (s.synced_from_service_id IS NOT NULL OR s.sync_state <> 'independent' OR s.synced_at IS NOT NULL)
  AND EXISTS (SELECT 1 FROM public.collective_service_replicas r
              WHERE r.replica_service_id = s.id AND r.released_at IS NULL);
