-- Collective booking switch, part 1: the one live-collective answer and parked services
-- (Docs/collective-one-venue-plan.md §6.6 "Parked services", D2 as revised 2026-09-14, SB-27; W4).
--
-- STILL DARK: nothing here applies to a venue unless it is live in a replicas-model collective, and
-- none is.
--
-- While a venue is live in a collective, its bookable appointment catalogue is the collective's
-- offerings only: at the host the masters of active offerings, at a member the replicas of its live
-- links to active offerings. Every other appointment service there is parked: derived from state,
-- never stored, lifted the moment the membership ends, the member is suspended, the page pauses or
-- the collective dissolves.
--
--   * collective_venue_live_state(venue): the one answer (SB-27) for the replicas model: the
--     collective, the venue's role, and whether it is live now (membership active and not
--     suspended, collective active and not paused). NULL when the venue is in no active
--     replicas-model collective.
--   * collective_bookable_service_ids(venue): NULL when nothing is parked at the venue (not live),
--     else the service ids that may take new bookings. Listings and availability read this.
--   * collective_service_parked(venue, service).
--   * trg_bookings_refuse_parked_service: the database backstop for every create path. A new
--     booking, or a booking moved onto another service, for a parked service is refused with RN007
--     (COLLECTIVE_SERVICE_PARKED). A booking that keeps its service is never touched, so existing
--     bookings on a parked service stay fully manageable (view, modify, cancel, reschedule, pay).
--     The engine flag lets the migration tooling through.

CREATE OR REPLACE FUNCTION public.collective_venue_live_state(p_venue_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
           'collective_id', c.id,
           'role', CASE WHEN c.host_venue_id = p_venue_id THEN 'host' ELSE 'member' END,
           'paused', c.paused_at IS NOT NULL,
           'suspended', m.suspended_at IS NOT NULL,
           'live', c.paused_at IS NULL AND m.suspended_at IS NULL)
  FROM public.venue_collective_members m
  JOIN public.venue_collectives c ON c.id = m.collective_id
  WHERE m.venue_id = p_venue_id AND m.status = 'active'
    AND c.status = 'active' AND c.service_model = 'replicas'
  ORDER BY m.joined_at NULLS LAST, m.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.collective_bookable_service_ids(p_venue_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state jsonb := public.collective_venue_live_state(p_venue_id);
  v_ids uuid[];
BEGIN
  IF v_state IS NULL OR NOT (v_state->>'live')::boolean THEN
    RETURN NULL;
  END IF;
  IF v_state->>'role' = 'host' THEN
    SELECT coalesce(array_agg(i.master_service_id ORDER BY i.master_service_id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.collective_service_items i
    WHERE i.collective_id = (v_state->>'collective_id')::uuid AND i.status = 'active' AND i.master_service_id IS NOT NULL;
  ELSE
    SELECT coalesce(array_agg(l.replica_service_id ORDER BY l.replica_service_id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.collective_service_replicas l
    JOIN public.collective_service_items i ON i.id = l.collective_service_item_id AND i.status = 'active'
    WHERE l.collective_id = (v_state->>'collective_id')::uuid AND l.venue_id = p_venue_id
      AND l.released_at IS NULL AND l.replica_service_id IS NOT NULL;
  END IF;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_service_parked(p_venue_id uuid, p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_service_id IS NULL THEN false
    ELSE coalesce(NOT (p_service_id = ANY (public.collective_bookable_service_ids(p_venue_id))), false)
  END;
$$;

CREATE OR REPLACE FUNCTION public.bookings_refuse_parked_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.service_item_id IS NULL
     OR coalesce(current_setting('resneo.collective_engine', true), '') = 'on'
     OR (TG_OP = 'UPDATE' AND NEW.service_item_id IS NOT DISTINCT FROM OLD.service_item_id) THEN
    RETURN NEW;
  END IF;
  IF public.collective_service_parked(NEW.venue_id, NEW.service_item_id) THEN
    RAISE EXCEPTION 'COLLECTIVE_SERVICE_PARKED: this service is not on the collective page, so it cannot take new bookings while the venue is part of the collective'
      USING ERRCODE = 'RN007';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_refuse_parked_service ON public.bookings;
CREATE TRIGGER trg_bookings_refuse_parked_service
  BEFORE INSERT OR UPDATE OF service_item_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_refuse_parked_service();

REVOKE ALL ON FUNCTION public.collective_venue_live_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_bookable_service_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_service_parked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_refuse_parked_service() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_venue_live_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_bookable_service_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_service_parked(uuid, uuid) TO service_role;
