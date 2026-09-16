-- W7: invitations on the shared-services model (plan §6.7 "Invite", DL8; UX spec N1, N34, N35,
-- `history.inviteWithdrawn`, `history.inviteExpired`).
--
-- STILL DARK: both functions do nothing for a collective that is not on the replicas model.
--
-- collective_record_invitation(member, actor venue, actor user, now)
--   Audits member_invited for an open invitation the invite route has just written, so History
--   shows it and the expiry clock has a start the audit agrees with.
--
-- collective_close_invitation(member, reason, actor venue, actor user, now)
--   'withdrawn': the host takes an open invitation back; the invitee's admins are told (N34).
--   'expired': the system closes one not answered in 30 days; invitee and host are told (N35).
--   The row goes 'removed' (nothing was ever handed over, so there is nothing to release), the
--   audit row is written, and the notice job queued. An invitation already answered or closed is
--   left alone and NULL returned.

CREATE OR REPLACE FUNCTION public.collective_record_invitation(
  p_member_id uuid,
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
  v_member public.venue_collective_members%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
BEGIN
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id;
  IF NOT FOUND OR v_member.status <> 'invited' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RETURN NULL;
  END IF;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host invites venues';
  END IF;
  RETURN public.collective_write_audit(
    v_collective.id, 'member_invited', p_actor_venue_id, p_actor_user_id, NULL, v_member.venue_id,
    NULL, NULL, NULL, NULL, jsonb_build_object('after', jsonb_build_object('member_id', p_member_id)),
    NULL, p_now);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_close_invitation(
  p_member_id uuid,
  p_reason text,
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
  v_member public.venue_collective_members%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_audit uuid;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('withdrawn', 'expired') THEN
    RAISE EXCEPTION 'collective_close_invitation: unknown reason %', p_reason;
  END IF;
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR v_member.status <> 'invited' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RETURN NULL;
  END IF;
  IF p_reason = 'withdrawn' AND p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host withdraws an invitation';
  END IF;
  IF p_reason = 'expired' AND (p_actor_venue_id IS NOT NULL OR p_actor_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'collective_close_invitation: only the system expires an invitation';
  END IF;

  UPDATE public.venue_collective_members SET status = 'removed', left_at = coalesce(left_at, p_now)
  WHERE id = p_member_id;

  v_audit := public.collective_write_audit(
    v_collective.id,
    CASE WHEN p_reason = 'withdrawn' THEN 'invitation_withdrawn' ELSE 'invitation_expired' END,
    p_actor_venue_id, p_actor_user_id,
    CASE WHEN p_reason = 'expired' THEN 'collective-invitations' END,
    v_member.venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('member_id', p_member_id, 'reason', p_reason,
                                                   'invited_at', v_member.created_at)),
    NULL, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (v_collective.id, v_member.venue_id, 'notice', 'invitation:' || p_member_id::text,
          jsonb_build_object('notice', CASE WHEN p_reason = 'withdrawn' THEN 'N34' ELSE 'N35' END,
                             'member_id', p_member_id))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN v_audit;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_record_invitation(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_close_invitation(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_record_invitation(uuid, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_close_invitation(uuid, text, uuid, uuid, timestamptz) TO service_role;
