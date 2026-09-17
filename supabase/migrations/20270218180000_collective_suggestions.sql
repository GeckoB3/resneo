-- W6/W7: a member suggests one of its parked services for the collective page (plan contract 10;
-- UX spec `svc.member.card.suggest`, `svc.member.suggest.*`, N25).
--
-- STILL DARK: does nothing for a collective that is not on the replicas model.
--
-- collective_suggest_service(collective, service, actor venue, actor user, now)
--   The member's own active service that is not a copy is suggested to the host: suggestion_made is
--   audited (the same shape collective_join_member writes for "ask") and an N25 notice job queued.
--   A service already suggested is not suggested again (N25 is sent once per service), and NULL is
--   returned.

CREATE OR REPLACE FUNCTION public.collective_suggest_service(
  p_collective_id uuid,
  p_service_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_service public.service_items%ROWTYPE;
  v_audit uuid;
BEGIN
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS NULL OR p_actor_venue_id = v_collective.host_venue_id OR NOT EXISTS (
    SELECT 1 FROM public.venue_collective_members
    WHERE collective_id = p_collective_id AND venue_id = p_actor_venue_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: only a member suggests a service';
  END IF;
  SELECT * INTO v_service FROM public.service_items WHERE id = p_service_id;
  IF NOT FOUND OR v_service.venue_id <> p_actor_venue_id OR NOT v_service.is_active
     OR EXISTS (SELECT 1 FROM public.collective_service_replicas
                WHERE replica_service_id = p_service_id AND released_at IS NULL) THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: only one of the venue''s own services can be suggested';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.collective_audit_events
    WHERE collective_id = p_collective_id AND event_type = 'suggestion_made' AND service_id = p_service_id
  ) THEN
    RETURN NULL;
  END IF;

  v_audit := public.collective_write_audit(
    p_collective_id, 'suggestion_made', p_actor_venue_id, p_actor_user_id, NULL,
    v_collective.host_venue_id, NULL, p_service_id, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('from_venue_id', p_actor_venue_id, 'service_id', p_service_id)),
    NULL, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, v_collective.host_venue_id, 'notice', 'suggest:' || p_service_id::text,
          jsonb_build_object('notice', 'N25', 'service_id', p_service_id, 'from_venue_id', p_actor_venue_id))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_suggest_service(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_suggest_service(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
