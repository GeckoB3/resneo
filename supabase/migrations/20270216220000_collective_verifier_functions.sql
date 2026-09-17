-- Collective engine, part 12: what the two crons call (Docs/collective-one-venue-plan.md §6.16,
-- Appendix D "The verifier").
--
-- STILL DARK: every list below is empty until a collective is on the replicas model.
--
-- The crons reach the engine only through service-role functions, never through the engine tables,
-- so nothing depends on table grants:
--   * collective_replicate_backlog(now): links whose lease expired while still due (the cron's
--     leases_expired counter), read before it claims.
--   * collective_verifier_worklist(now): the verifier's work, one list per duty: links behind more
--     than 15 minutes (I3b, repaired by applying), live links whose membership has ended (I5,
--     repaired by releasing), links marked current whose fingerprint differs (I3), collectives
--     paused 30 days (dissolved), memberships suspended 30 days (released), and host transfers
--     that are due.
--   * collective_repair_drift(link, job, now): I3's repair. It writes unexplained_drift_repaired
--     with the replica-side projection as the before-image, then applies. The cron alerts.
--   * collective_cancel_host_transfer(collective, reason, actor venue, actor user, job, now):
--     clears a pending transfer with host_transfer_cancelled, used when a due transfer is still
--     behind after 7 days of retries (T22), and by the host's cancel route.

CREATE OR REPLACE FUNCTION public.collective_replicate_backlog(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'leases_expired', (SELECT count(*) FROM public.collective_service_replicas
                       WHERE released_at IS NULL AND applied_revision < desired_revision
                         AND lease_until IS NOT NULL AND lease_until < p_now),
    'due', (SELECT count(*) FROM public.collective_service_replicas
            WHERE released_at IS NULL AND applied_revision < desired_revision
              AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)));
$$;

CREATE OR REPLACE FUNCTION public.collective_verifier_worklist(p_now timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'behind', coalesce((
      SELECT jsonb_agg(l.id ORDER BY l.id) FROM public.collective_service_replicas l
      JOIN public.venue_collectives c ON c.id = l.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
      WHERE l.released_at IS NULL AND l.applied_revision < l.desired_revision
        AND l.behind_since < p_now - interval '15 minutes'), '[]'::jsonb),
    'orphaned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('link_id', l.id, 'member_id', m.id, 'member_status', m.status,
                                          'collective_status', c.status) ORDER BY l.id)
      FROM public.collective_service_replicas l
      JOIN public.venue_collectives c ON c.id = l.collective_id
      LEFT JOIN public.venue_collective_members m ON m.id = l.member_id
      WHERE l.released_at IS NULL
        AND (c.status <> 'active' OR m.id IS NULL OR m.status <> 'active')), '[]'::jsonb),
    'drifted', coalesce((
      SELECT jsonb_agg(l.id ORDER BY l.id) FROM public.collective_service_replicas l
      JOIN public.venue_collectives c ON c.id = l.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
      WHERE l.released_at IS NULL AND l.replica_service_id IS NOT NULL AND l.applied_revision = l.desired_revision
        AND public.collective_replica_fingerprint(l.id) IS DISTINCT FROM public.collective_expected_fingerprint(l.id)), '[]'::jsonb),
    'paused_expired', coalesce((
      SELECT jsonb_agg(c.id ORDER BY c.id) FROM public.venue_collectives c
      WHERE c.status = 'active' AND c.service_model = 'replicas' AND c.paused_at < p_now - interval '30 days'), '[]'::jsonb),
    'suspended_expired', coalesce((
      SELECT jsonb_agg(m.id ORDER BY m.id) FROM public.venue_collective_members m
      JOIN public.venue_collectives c ON c.id = m.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
      WHERE m.status = 'active' AND m.suspended_at < p_now - interval '30 days' AND m.venue_id <> c.host_venue_id), '[]'::jsonb),
    'transfers_due', coalesce((
      SELECT jsonb_agg(jsonb_build_object('collective_id', c.id, 'new_host_venue_id', c.pending_host_venue_id,
                                          'host_transfer_at', c.host_transfer_at,
                                          'overdue', c.host_transfer_at < p_now - interval '7 days') ORDER BY c.id)
      FROM public.venue_collectives c
      WHERE c.status = 'active' AND c.service_model = 'replicas'
        AND c.pending_host_venue_id IS NOT NULL AND c.host_transfer_at <= p_now), '[]'::jsonb));
$$;

-- I3's repair: audit the before-image, then apply.
CREATE OR REPLACE FUNCTION public.collective_repair_drift(
  p_link_id uuid,
  p_job text DEFAULT 'collective-verify',
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.collective_service_replicas%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM public.collective_service_replicas WHERE id = p_link_id;
  IF NOT FOUND OR v_link.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'link_id', p_link_id, 'error_code', 'membership_inactive');
  END IF;
  PERFORM public.collective_write_audit(
    v_link.collective_id, 'unexplained_drift_repaired', NULL, NULL, coalesce(p_job, 'collective-verify'), v_link.venue_id,
    v_link.collective_service_item_id, v_link.replica_service_id, p_link_id, v_link.desired_revision,
    jsonb_build_object('before', public.collective_replica_projection(p_link_id, 'replica'),
                       'expected', public.collective_replica_projection(p_link_id, 'master')),
    NULL, p_now);
  -- Force a real apply: a current link would otherwise converge the same way, but the bump makes the
  -- repair visible as its own revision.
  UPDATE public.collective_service_replicas SET desired_revision = desired_revision + 1 WHERE id = p_link_id;
  RETURN public.collective_apply_replica(p_link_id, NULL, NULL, coalesce(p_job, 'collective-verify'), p_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_cancel_host_transfer_core(
  p_collective_id uuid,
  p_reason text,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_job text,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.pending_host_venue_id IS NULL THEN
    RETURN jsonb_build_object('cancelled', false);
  END IF;
  IF p_actor_venue_id IS NOT NULL
     AND p_actor_venue_id NOT IN (v_collective.host_venue_id, v_collective.pending_host_venue_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host or the venue offered the hosting may cancel the move';
  END IF;
  UPDATE public.venue_collectives SET pending_host_venue_id = NULL, host_transfer_at = NULL WHERE id = p_collective_id;
  PERFORM public.collective_write_audit(
    p_collective_id, 'host_transfer_cancelled', p_actor_venue_id, p_actor_user_id,
    CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN coalesce(p_job, 'collective-verify') END,
    v_collective.pending_host_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('pending_host_venue_id', v_collective.pending_host_venue_id,
                                                    'host_transfer_at', v_collective.host_transfer_at),
                       'reason', p_reason),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);
  RETURN jsonb_build_object('cancelled', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_cancel_host_transfer(
  p_collective_id uuid,
  p_reason text,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_job text DEFAULT NULL,
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
  v_result := public.collective_cancel_host_transfer_core(p_collective_id, p_reason, p_actor_venue_id, p_actor_user_id, p_job, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_replicate_backlog(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_verifier_worklist(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_repair_drift(uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_cancel_host_transfer_core(uuid, text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_cancel_host_transfer(uuid, text, uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_replicate_backlog(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_verifier_worklist(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_repair_drift(uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_cancel_host_transfer(uuid, text, uuid, uuid, text, timestamptz) TO service_role;
-- The crons also call these directly; make sure the service role can.
GRANT EXECUTE ON FUNCTION public.collective_invariant_report(timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_release_member(uuid, text, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_dissolve(uuid, text, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_transfer_host(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
