-- W10: the host asks to use a member's page address, and the member's admin answers (plan §6.9
-- "Adopting a member's page address", decided 2026-09-14; UX spec `bp.address.adopt.*`, N38,
-- `history.addressAdopted`).
--
-- STILL DARK: both functions act only on a replicas-model collective. The older model keeps its
-- direct write until it migrates.
--
-- venue_collectives.pending_adopted_venue_id  the member asked, not yet answered. The collective
--   keeps its own address meanwhile. A request only stands while that venue is an active member,
--   so a venue that leaves takes its pending request with it without anything writing here.
--
-- collective_request_address_adoption(collective, venue, actor venue, actor user, now)
--   The host asks. Its own address needs nobody's agreement and is adopted at once
--   (address_adopted). A member's address is recorded as pending, audited as
--   address_adoption_requested, and N38 queued for that member's admins; asking again for the venue
--   already pending changes nothing and sends nothing. An address another live collective uses is
--   refused (COLLECTIVE_ADDRESS_TAKEN).
--
-- collective_answer_address_adoption(collective, venue, accept, actor user, now)
--   The member answers for its own venue. Agreeing moves the pending venue to adopted_venue_id
--   (address_adopted); "Not now" clears the request (the new address_adoption_declined). Either way
--   the request is gone. No pending request for that venue: COLLECTIVE_ADDRESS_NOT_PENDING.
--
-- The host choosing the collective's own address again, or another venue, is a route write of the
-- two address columns and the pending one, as the address setting always was.

ALTER TABLE public.venue_collectives
  ADD COLUMN IF NOT EXISTS pending_adopted_venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL;

ALTER TABLE public.collective_audit_events DROP CONSTRAINT IF EXISTS collective_audit_events_event_type_valid;
ALTER TABLE public.collective_audit_events
  ADD CONSTRAINT collective_audit_events_event_type_valid CHECK (event_type IN (
    'offering_added', 'offering_withdrawn', 'offering_reoffered',
    'master_changed', 'master_change_undone', 'replica_applied', 'replica_failed',
    'unexplained_drift_repaired', 'calendar_assigned', 'calendar_unassigned', 'values_changed',
    'member_invited', 'invitation_withdrawn', 'invitation_expired', 'member_joined', 'member_left',
    'member_removed', 'member_suspended', 'member_resumed', 'member_released',
    'host_transfer_requested', 'host_transfer_accepted', 'host_transfer_cancelled', 'host_transferred',
    'collective_paused', 'collective_resumed', 'collective_dissolved',
    'adoption_requested', 'adoption_answered', 'suggestion_made',
    'address_adoption_requested', 'address_adopted', 'address_adoption_declined',
    'migration_applied', 'migration_rolled_back',
    'photo_copied', 'photo_copy_failed', 'payment_rule_downgraded'));

CREATE OR REPLACE FUNCTION public.collective_request_address_adoption(
  p_collective_id uuid,
  p_venue_id uuid,
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
  v_slug text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF v_collective.status <> 'active' OR p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host of an active collective may choose the page address';
  END IF;
  IF p_venue_id IS NULL OR (p_venue_id <> v_collective.host_venue_id AND NOT EXISTS (
    SELECT 1 FROM public.venue_collective_members
    WHERE collective_id = p_collective_id AND venue_id = p_venue_id AND status = 'active'
  )) THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: only an active member''s address can be used';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.venue_collectives
    WHERE adopted_venue_id = p_venue_id AND status = 'active' AND id <> p_collective_id
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_ADDRESS_TAKEN: that venue''s address is already used by another collective page';
  END IF;
  SELECT slug INTO v_slug FROM public.venues WHERE id = p_venue_id;

  IF v_collective.adopted_venue_id = p_venue_id AND v_collective.slug_strategy = 'adopt_member' THEN
    RETURN jsonb_build_object('status', 'adopted', 'venue_id', p_venue_id);
  END IF;

  IF p_venue_id = v_collective.host_venue_id THEN
    UPDATE public.venue_collectives
    SET slug_strategy = 'adopt_member', adopted_venue_id = p_venue_id, pending_adopted_venue_id = NULL
    WHERE id = p_collective_id;
    PERFORM public.collective_write_audit(
      p_collective_id, 'address_adopted', p_actor_venue_id, p_actor_user_id, NULL,
      p_venue_id, NULL, NULL, NULL, NULL,
      jsonb_build_object('after', jsonb_build_object('adopted_venue_id', p_venue_id, 'address', '/book/' || coalesce(v_slug, ''))),
      NULL, p_now);
    RETURN jsonb_build_object('status', 'adopted', 'venue_id', p_venue_id);
  END IF;

  IF v_collective.pending_adopted_venue_id = p_venue_id THEN
    RETURN jsonb_build_object('status', 'pending', 'venue_id', p_venue_id);
  END IF;

  UPDATE public.venue_collectives SET pending_adopted_venue_id = p_venue_id WHERE id = p_collective_id;
  PERFORM public.collective_write_audit(
    p_collective_id, 'address_adoption_requested', p_actor_venue_id, p_actor_user_id, NULL,
    p_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('pending_adopted_venue_id', p_venue_id, 'address', '/book/' || coalesce(v_slug, ''))),
    NULL, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, p_venue_id, 'notice',
          'address-request:' || p_collective_id::text || ':' || p_venue_id::text || ':'
            || extract(epoch FROM p_now)::bigint::text,
          jsonb_build_object('notice', 'N38', 'host_venue_id', v_collective.host_venue_id))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('status', 'pending', 'venue_id', p_venue_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_answer_address_adoption(
  p_collective_id uuid,
  p_venue_id uuid,
  p_accept boolean,
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
  v_slug text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF v_collective.status <> 'active' OR p_venue_id IS NULL
     OR v_collective.pending_adopted_venue_id IS DISTINCT FROM p_venue_id
     OR NOT EXISTS (SELECT 1 FROM public.venue_collective_members
                    WHERE collective_id = p_collective_id AND venue_id = p_venue_id AND status = 'active') THEN
    RAISE EXCEPTION 'COLLECTIVE_ADDRESS_NOT_PENDING: there is no request to use this venue''s address';
  END IF;
  SELECT slug INTO v_slug FROM public.venues WHERE id = p_venue_id;

  IF p_accept THEN
    IF EXISTS (
      SELECT 1 FROM public.venue_collectives
      WHERE adopted_venue_id = p_venue_id AND status = 'active' AND id <> p_collective_id
    ) THEN
      RAISE EXCEPTION 'COLLECTIVE_ADDRESS_TAKEN: that venue''s address is already used by another collective page';
    END IF;
    UPDATE public.venue_collectives
    SET slug_strategy = 'adopt_member', adopted_venue_id = p_venue_id, pending_adopted_venue_id = NULL
    WHERE id = p_collective_id;
    PERFORM public.collective_write_audit(
      p_collective_id, 'address_adopted', p_venue_id, p_actor_user_id, NULL,
      p_venue_id, NULL, NULL, NULL, NULL,
      jsonb_build_object('before', jsonb_build_object('adopted_venue_id', v_collective.adopted_venue_id),
                         'after', jsonb_build_object('adopted_venue_id', p_venue_id, 'address', '/book/' || coalesce(v_slug, ''))),
      NULL, p_now);
    RETURN jsonb_build_object('status', 'adopted', 'venue_id', p_venue_id);
  END IF;

  UPDATE public.venue_collectives SET pending_adopted_venue_id = NULL WHERE id = p_collective_id;
  PERFORM public.collective_write_audit(
    p_collective_id, 'address_adoption_declined', p_venue_id, p_actor_user_id, NULL,
    p_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('pending_adopted_venue_id', p_venue_id)),
    NULL, p_now);
  RETURN jsonb_build_object('status', 'declined', 'venue_id', p_venue_id);
END;
$$;

REVOKE ALL ON FUNCTION public.collective_request_address_adoption(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_request_address_adoption(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.collective_answer_address_adoption(uuid, uuid, boolean, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_answer_address_adoption(uuid, uuid, boolean, uuid, timestamptz) TO service_role;
