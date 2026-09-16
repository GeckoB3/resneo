-- W5: recording a host's change to a service on the collective page (plan §6.4 "Audit `changes`
-- shapes"; D50).
--
-- STILL DARK: returns NULL unless the service is the master of an active offering in an active
-- replicas-model collective.
--
-- The host's save writes the service itself through its own route, as it always has; the dirty
-- triggers make every member's copy due. What the route cannot do is write the audit row, because
-- collective_write_audit is not granted to anything but the engine. This is the one entry point for
-- it: the route captures the master-side projection before and after its writes and hands both over,
-- and the row's id is what the 60 second undo sends back (`collective_sync.audit_event_id`).
--
-- Nothing is written when the projections match, so a save that changed nothing the collective
-- copies (a sort order, say) leaves no trail and offers no undo.

CREATE OR REPLACE FUNCTION public.collective_record_master_change(
  p_master_service_id uuid,
  p_before jsonb,
  p_after jsonb,
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
  v_item public.collective_service_items%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
BEGIN
  IF p_before IS NULL OR p_after IS NULL OR p_before = p_after THEN
    RETURN NULL;
  END IF;
  SELECT i.* INTO v_item
  FROM public.collective_service_items i
  JOIN public.venue_collectives c ON c.id = i.collective_id
  WHERE i.master_service_id = p_master_service_id AND i.status = 'active'
    AND c.status = 'active' AND c.service_model = 'replicas'
  ORDER BY i.id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_item.collective_id;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may change a service on the collective page';
  END IF;

  RETURN public.collective_write_audit(
    v_item.collective_id, 'master_changed', p_actor_venue_id, p_actor_user_id, NULL,
    v_collective.host_venue_id, v_item.id, p_master_service_id, NULL, NULL,
    jsonb_build_object('before', p_before, 'after', p_after), NULL, p_now);
END;
$$;

REVOKE ALL ON FUNCTION public.collective_record_master_change(uuid, jsonb, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_record_master_change(uuid, jsonb, jsonb, uuid, uuid, timestamptz) TO service_role;
