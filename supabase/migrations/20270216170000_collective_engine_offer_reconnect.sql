-- Collective engine, part 8b: re-offering reconnects only unchanged services (DL5).
--
-- STILL DARK. collective_offer_service revived a member's released link for the same offering
-- whatever the member had done to the released service since, so the next apply would overwrite the
-- member's own changes. It now follows collective_join_member's rule: reconnect only when the
-- released service is unchanged since its release (updated_at <= released_at) and follows no other
-- live link; otherwise the member gets a new link and keeps its changed service as its own. Only
-- the core body changes; the wrapper and grants from 20270215130000 stand.

CREATE OR REPLACE FUNCTION public.collective_offer_service_core(
  p_collective_id uuid,
  p_master_service_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
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
  v_master public.service_items%ROWTYPE;
  v_item_id uuid;
  v_reoffered boolean := false;
  v_member record;
  v_link_id uuid;
  v_links jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));

  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may offer a service';
  END IF;
  SELECT * INTO v_master FROM public.service_items WHERE id = p_master_service_id;
  IF NOT FOUND OR v_master.venue_id <> v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: the service is not the host''s';
  END IF;
  PERFORM public.collective_engine_test_point('after_membership_check');

  SELECT id INTO v_item_id FROM public.collective_service_items
  WHERE collective_id = p_collective_id AND master_service_id = p_master_service_id AND status = 'active';
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM public.collective_service_items
    WHERE collective_id = p_collective_id AND master_service_id = p_master_service_id
    ORDER BY created_at DESC LIMIT 1;
    IF v_item_id IS NOT NULL THEN
      UPDATE public.collective_service_items SET status = 'active', updated_at = p_now WHERE id = v_item_id;
      v_reoffered := true;
    ELSE
      INSERT INTO public.collective_service_items (collective_id, name, status, master_service_id)
      VALUES (p_collective_id, v_master.name, 'active', p_master_service_id)
      RETURNING id INTO v_item_id;
    END IF;
  END IF;

  -- D29: one name and description everywhere for an offered service.
  UPDATE public.service_items
  SET staff_may_customize_name = false, staff_may_customize_description = false
  WHERE id = p_master_service_id AND (staff_may_customize_name OR staff_may_customize_description);
  IF FOUND THEN
    PERFORM public.collective_write_audit(p_collective_id, 'master_changed', p_actor_venue_id, p_actor_user_id,
      NULL, v_collective.host_venue_id, v_item_id, p_master_service_id, NULL, NULL,
      jsonb_build_object('before', jsonb_build_object('staff_may_customize_name', v_master.staff_may_customize_name,
                                                      'staff_may_customize_description', v_master.staff_may_customize_description),
                         'after', jsonb_build_object('staff_may_customize_name', false, 'staff_may_customize_description', false)),
      NULL, p_now);
  END IF;

  FOR v_member IN
    SELECT m.id, m.venue_id, v.name AS venue_name
    FROM public.venue_collective_members m JOIN public.venues v ON v.id = m.venue_id
    WHERE m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> v_collective.host_venue_id
    ORDER BY m.id
  LOOP
    SELECT id INTO v_link_id FROM public.collective_service_replicas
    WHERE collective_service_item_id = v_item_id AND venue_id = v_member.venue_id AND released_at IS NULL;
    IF v_link_id IS NULL THEN
      -- A released link is reconnected only when its service is unchanged since the release and
      -- follows nothing else (DL5, as collective_join_member); otherwise the member gets a new link.
      SELECT l.id INTO v_link_id FROM public.collective_service_replicas l
      JOIN public.service_items s ON s.id = l.replica_service_id
      WHERE l.collective_service_item_id = v_item_id AND l.venue_id = v_member.venue_id AND l.released_at IS NOT NULL
        AND s.updated_at <= l.released_at
        AND NOT EXISTS (SELECT 1 FROM public.collective_service_replicas o
                        WHERE o.replica_service_id = l.replica_service_id AND o.released_at IS NULL)
      ORDER BY l.released_at DESC LIMIT 1;
      IF v_link_id IS NOT NULL THEN
        UPDATE public.collective_service_replicas
        SET released_at = NULL, provenance = 'reconnected', member_id = v_member.id,
            desired_revision = desired_revision + 1, applied_revision = 0, applied_fingerprint = NULL,
            behind_since = p_now, attempts = 0, next_attempt_at = NULL, lease_until = NULL
        WHERE id = v_link_id;
      ELSE
        INSERT INTO public.collective_service_replicas
          (collective_id, collective_service_item_id, member_id, venue_id, provenance, behind_since)
        VALUES (p_collective_id, v_item_id, v_member.id, v_member.venue_id, 'created', p_now)
        RETURNING id INTO v_link_id;
      END IF;
    END IF;
    v_links := v_links || jsonb_build_object('link_id', v_link_id, 'venue_id', v_member.venue_id, 'venue_name', v_member.venue_name);
  END LOOP;

  PERFORM public.collective_write_audit(p_collective_id, CASE WHEN v_reoffered THEN 'offering_reoffered' ELSE 'offering_added' END,
    p_actor_venue_id, p_actor_user_id, NULL, v_collective.host_venue_id, v_item_id, p_master_service_id, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('master_service_id', p_master_service_id, 'links', v_links)), NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  RETURN jsonb_build_object('item_id', v_item_id, 'reoffered', v_reoffered, 'links', v_links);
END;
$$;

