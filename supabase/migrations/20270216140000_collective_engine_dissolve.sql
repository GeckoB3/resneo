-- Collective engine, part 6: dissolve (Docs/collective-one-venue-plan.md §6.7 "Dissolve", the
-- lifecycle table "active to dissolved", Appendix D `collective_dissolve`; D22, D25, D35, DL10, D41).
--
-- STILL DARK: refuses anything but a migrating or replicas-model collective with
-- COLLECTIVE_LEGACY_MODEL, so today's dissolve route keeps its own path.
--
-- The one path for the host's DELETE and both crons. In one transaction, under the exclusive
-- collective lock:
--   * every invited row becomes removed, one invitation_withdrawn row each;
--   * every active row, the host's included, is released through collective_release_member with
--     reason 'dissolved', so it goes left like everyone's (DL10) and each member keeps its services;
--   * offerings are archived;
--   * the collective becomes dissolved with dissolved_at; the address is kept for the neutral page
--     (D25), not tombstoned;
--   * collective_dissolved is audited, the revision bumped and one notice job queued (N19).
-- No account link is written (D41). A collective already dissolved returns zeros.
--
-- Also: collective_service_items.master_service_id becomes ON DELETE SET NULL (it was NO ACTION,
-- as Appendix C wrote it). NO ACTION meant a host could never delete a service it had once offered,
-- even after withdrawing it or dissolving the collective, and a host venue could not be hard-deleted.
-- The rule the plan wants (RT1-5) is only that an ACTIVE offering's master cannot be deleted, and the
-- lock trigger's RN002 enforces exactly that before any FK action runs.

ALTER TABLE public.collective_service_items
  DROP CONSTRAINT IF EXISTS collective_service_items_master_service_id_fkey;
ALTER TABLE public.collective_service_items
  ADD CONSTRAINT collective_service_items_master_service_id_fkey
  FOREIGN KEY (master_service_id) REFERENCES public.service_items (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.collective_dissolve_core(
  p_collective_id uuid,
  p_reason text,
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
  v_job text := CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-dissolve' END;
  v_invited integer := 0;
  v_released integer := 0;
  v_offerings integer := 0;
  r record;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('host_ended', 'paused_expired', 'below_two', 'host_venue_deleted') THEN
    RAISE EXCEPTION 'collective_dissolve: unknown reason %', p_reason;
  END IF;

  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: collective not found';
  END IF;
  IF v_collective.service_model NOT IN ('migrating', 'replicas') THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS NOT NULL AND p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may end the collective';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF v_collective.status = 'dissolved' THEN
    RETURN jsonb_build_object('members_released', 0, 'invitations_removed', 0, 'offerings_archived', 0);
  END IF;

  -- Open invitations end.
  FOR r IN
    SELECT id, venue_id FROM public.venue_collective_members
    WHERE collective_id = p_collective_id AND status = 'invited'
    ORDER BY id
    FOR UPDATE
  LOOP
    UPDATE public.venue_collective_members SET status = 'removed', left_at = coalesce(left_at, p_now) WHERE id = r.id;
    PERFORM public.collective_write_audit(
      p_collective_id, 'invitation_withdrawn', p_actor_venue_id, p_actor_user_id, v_job, r.venue_id,
      NULL, NULL, NULL, NULL, jsonb_build_object('after', jsonb_build_object('reason', 'dissolved')), NULL, p_now);
    v_invited := v_invited + 1;
  END LOOP;

  -- Every live membership, the host's included, through the one release.
  FOR r IN
    SELECT id FROM public.venue_collective_members
    WHERE collective_id = p_collective_id AND status = 'active'
    ORDER BY id
  LOOP
    PERFORM public.collective_release_member_core(r.id, 'dissolved', p_actor_venue_id, p_actor_user_id, p_now);
    v_released := v_released + 1;
  END LOOP;

  UPDATE public.collective_service_items SET status = 'archived'
  WHERE collective_id = p_collective_id AND status <> 'archived';
  GET DIAGNOSTICS v_offerings = ROW_COUNT;

  UPDATE public.venue_collectives
  SET status = 'dissolved', dissolved_at = p_now
  WHERE id = p_collective_id;

  PERFORM public.collective_write_audit(
    p_collective_id, 'collective_dissolved', p_actor_venue_id, p_actor_user_id, v_job, v_collective.host_venue_id,
    NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('reason', p_reason, 'members_released', v_released,
                                                   'invitations_removed', v_invited, 'offerings_archived', v_offerings)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);
  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, v_collective.host_venue_id, 'notice', 'dissolve:' || p_collective_id::text,
          jsonb_build_object('notice', 'N19', 'reason', p_reason))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('members_released', v_released, 'invitations_removed', v_invited,
                            'offerings_archived', v_offerings);
END;
$$;

-- Entry point: the engine flag is on for exactly this call (20270215130000's header).
CREATE OR REPLACE FUNCTION public.collective_dissolve(
  p_collective_id uuid,
  p_reason text,
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
  v_result := public.collective_dissolve_core(p_collective_id, p_reason, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_dissolve_core(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dissolve(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_dissolve(uuid, text, uuid, uuid, timestamptz) TO service_role;
