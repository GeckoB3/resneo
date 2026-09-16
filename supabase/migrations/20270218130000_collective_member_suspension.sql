-- W7: a member's subscription lapses, and comes back (plan §6.7 "suspended_at is a flag on an
-- active membership"; UX spec N36, N37, N23).
--
-- STILL DARK: acts only on a replicas-model collective.
--
-- collective_set_member_suspended(member, suspended, now) is what the suspension cron calls when
-- a venue's subscription stops, or starts, giving it access. Under the collective lock it:
--   * sets or clears venue_collective_members.suspended_at, and does nothing when it already matches;
--   * audits member_suspended or member_resumed, and bumps the revision so the page drops or brings
--     back that venue's calendars;
--   * for a member, queues N36 (suspended) or N37 (resumed) for that venue;
--   * for the host, pauses the collective with paused_reason host_lapsed (N23 to the others) and,
--     when the host comes back, clears a pause it set (collective_resumed), leaving any other pause
--     alone.
-- The 30-day ends are the verifier's: a member suspended 30 days is released, and a collective
-- paused 30 days is dissolved (collective_verifier_worklist). Replicas stay locked and in step
-- throughout, because nothing about the services changes.

CREATE OR REPLACE FUNCTION public.collective_set_member_suspended(
  p_member_id uuid,
  p_suspended boolean,
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
  v_member public.venue_collective_members%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_is_host boolean;
BEGIN
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('changed', false);
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || v_member.collective_id::text, 0));
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id FOR UPDATE;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id FOR UPDATE;
  IF v_collective.service_model <> 'replicas' OR v_collective.status <> 'active' OR v_member.status <> 'active' THEN
    RETURN jsonb_build_object('changed', false);
  END IF;
  IF (v_member.suspended_at IS NOT NULL) = p_suspended THEN
    RETURN jsonb_build_object('changed', false);
  END IF;
  v_is_host := v_member.venue_id = v_collective.host_venue_id;

  UPDATE public.venue_collective_members
  SET suspended_at = CASE WHEN p_suspended THEN p_now ELSE NULL END
  WHERE id = p_member_id;

  PERFORM public.collective_write_audit(
    v_collective.id, CASE WHEN p_suspended THEN 'member_suspended' ELSE 'member_resumed' END,
    NULL, NULL, 'collective-suspension', v_member.venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('suspended_at', v_member.suspended_at),
                       'after', jsonb_build_object('suspended_at', CASE WHEN p_suspended THEN p_now END)),
    NULL, p_now);

  IF v_is_host AND p_suspended AND v_collective.paused_at IS NULL THEN
    UPDATE public.venue_collectives SET paused_at = p_now, paused_reason = 'host_lapsed' WHERE id = v_collective.id;
    PERFORM public.collective_write_audit(
      v_collective.id, 'collective_paused', NULL, NULL, 'collective-suspension', v_member.venue_id,
      NULL, NULL, NULL, NULL, jsonb_build_object('reason', 'host_lapsed'), NULL, p_now);
    INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
    VALUES (v_collective.id, v_member.venue_id, 'notice',
            'host-lapsed:' || p_member_id::text || ':' || extract(epoch FROM p_now)::bigint::text,
            jsonb_build_object('notice', 'N23', 'reason', 'host_lapsed'))
    ON CONFLICT (idempotency_key) DO NOTHING;
  ELSIF v_is_host AND NOT p_suspended AND v_collective.paused_reason = 'host_lapsed' THEN
    UPDATE public.venue_collectives SET paused_at = NULL, paused_reason = NULL WHERE id = v_collective.id;
    PERFORM public.collective_write_audit(
      v_collective.id, 'collective_resumed', NULL, NULL, 'collective-suspension', v_member.venue_id,
      NULL, NULL, NULL, NULL, jsonb_build_object('reason', 'host_resumed'), NULL, p_now);
  ELSIF NOT v_is_host THEN
    INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
    VALUES (v_collective.id, v_member.venue_id, 'notice',
            CASE WHEN p_suspended THEN 'suspended:' ELSE 'resumed:' END
              || p_member_id::text || ':' || extract(epoch FROM p_now)::bigint::text,
            jsonb_build_object('notice', CASE WHEN p_suspended THEN 'N36' ELSE 'N37' END))
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  PERFORM public.collective_bump_revision(v_collective.id, p_now);
  RETURN jsonb_build_object('changed', true, 'is_host', v_is_host);
END;
$$;

REVOKE ALL ON FUNCTION public.collective_set_member_suspended(uuid, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_set_member_suspended(uuid, boolean, timestamptz) TO service_role;
