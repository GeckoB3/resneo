-- W7: asking a member to host, and its answer (plan §6.7 "active to active, transfer pending";
-- Appendix E contract 8; UX spec `transfer.*`, N20, N21).
--
-- STILL DARK: both functions act only on a replicas-model collective.
--
-- The move itself is collective_transfer_host (20270216200000), run by the verifier on the day. What
-- was missing is the two steps before it, which the plan describes as route writes of the pending
-- columns with an audit row. The routes cannot write collective_audit_events (only the engine may),
-- so the steps live here instead, each one statement's worth of state under the collective lock:
--
--   collective_request_host_transfer  the host asks one active member. Refused while another move
--       is pending (COLLECTIVE_TRANSFER_PENDING) and while any venue is behind
--       (COLLECTIVE_LINKS_BEHIND), because the move itself would refuse then. Sets
--       pending_host_venue_id and leaves host_transfer_at empty: asked, not yet accepted. Audited
--       as host_transfer_requested; N20 is queued for the candidate.
--
--   collective_accept_host_transfer  the candidate accepts, with the consent version it was shown.
--       Sets host_transfer_at 14 days on, which is when the verifier moves the hosting and the
--       window every member has to leave first if they want to (RT2-23). Audited as the new
--       host_transfer_accepted; N21 is queued for every venue.
--
-- Declining, and the host cancelling, are collective_cancel_host_transfer (20270216220000), which
-- already accepts either the host or the candidate as its actor.

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
    'address_adoption_requested', 'address_adopted',
    'migration_applied', 'migration_rolled_back',
    'photo_copied', 'photo_copy_failed', 'payment_rule_downgraded'));

CREATE OR REPLACE FUNCTION public.collective_request_host_transfer(
  p_collective_id uuid,
  p_candidate_venue_id uuid,
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
  v_candidate_name text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF v_collective.status <> 'active' OR p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host of an active collective may ask another venue to host';
  END IF;
  IF v_collective.pending_host_venue_id IS NOT NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_TRANSFER_PENDING: a move of hosting is already pending';
  END IF;
  IF p_candidate_venue_id IS NULL OR p_candidate_venue_id = v_collective.host_venue_id
     OR NOT EXISTS (SELECT 1 FROM public.venue_collective_members
                    WHERE collective_id = p_collective_id AND venue_id = p_candidate_venue_id
                      AND status = 'active' AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: only an active member can be asked to host';
  END IF;
  IF EXISTS (SELECT 1 FROM public.collective_service_replicas
             WHERE collective_id = p_collective_id AND released_at IS NULL
               AND applied_revision < desired_revision) THEN
    RAISE EXCEPTION 'COLLECTIVE_LINKS_BEHIND: every venue must be up to date before hosting can move';
  END IF;

  UPDATE public.venue_collectives
  SET pending_host_venue_id = p_candidate_venue_id, host_transfer_at = NULL
  WHERE id = p_collective_id;

  PERFORM public.collective_write_audit(
    p_collective_id, 'host_transfer_requested', p_actor_venue_id, p_actor_user_id, NULL,
    p_candidate_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('pending_host_venue_id', p_candidate_venue_id)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, p_candidate_venue_id, 'notice',
          'host-request:' || p_collective_id::text || ':' || p_candidate_venue_id::text || ':'
            || extract(epoch FROM p_now)::bigint::text,
          jsonb_build_object('notice', 'N20', 'host_venue_id', v_collective.host_venue_id))
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT name INTO v_candidate_name FROM public.venues WHERE id = p_candidate_venue_id;
  RETURN jsonb_build_object('pending_host_venue_id', p_candidate_venue_id, 'pending_host_venue_name', v_candidate_name);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_accept_host_transfer(
  p_collective_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_consent_version text,
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
  v_at timestamptz := p_now + interval '14 days';
BEGIN
  IF p_consent_version IS NULL OR btrim(p_consent_version) = '' THEN
    RAISE EXCEPTION 'COLLECTIVE_CONSENT_REQUIRED: accepting the hosting needs the consent the venue was shown';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF v_collective.status <> 'active'
     OR v_collective.pending_host_venue_id IS DISTINCT FROM p_actor_venue_id
     OR v_collective.host_transfer_at IS NOT NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: there is no request for this venue to host';
  END IF;

  UPDATE public.venue_collectives SET host_transfer_at = v_at WHERE id = p_collective_id;

  PERFORM public.collective_write_audit(
    p_collective_id, 'host_transfer_accepted', p_actor_venue_id, p_actor_user_id, NULL,
    p_actor_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('host_transfer_at', v_at),
                       'consent_version', p_consent_version),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, p_actor_venue_id, 'notice',
          'host-accept:' || p_collective_id::text || ':' || p_actor_venue_id::text || ':'
            || extract(epoch FROM p_now)::bigint::text,
          jsonb_build_object('notice', 'N21', 'host_transfer_at', v_at))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('host_transfer_at', v_at);
END;
$$;

REVOKE ALL ON FUNCTION public.collective_request_host_transfer(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_accept_host_transfer(uuid, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_request_host_transfer(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_accept_host_transfer(uuid, uuid, uuid, text, timestamptz) TO service_role;
