-- Resneo: a collective is live only once two venues are in it.
--
-- Docs/link-and-collective-setup-wizard-plan.md, decision L12 (2026-09-19). The setup wizard creates
-- the collective with the link request, so a host can now wait days for the other venue to accept.
-- `collective_venue_live_state` said the collective was live as soon as the host's own membership
-- was active, which parked every one of the host's services (D2) while nobody else was in and
-- nothing was on the page: the host's own booking page had nothing bookable on it. The same held for
-- the Create dialog's path, only for less long.
--
-- The page itself already needs two venues before it serves (`loadPublicCollective`, and the own-page
-- hand-over in `page-handover.ts`), so `live` now says the same: the collective is active, not
-- paused, the venue's membership is not suspended, AND at least two memberships are active. Below
-- two venues nothing is parked and every venue trades as it did. `collective_id` and `role` are still
-- returned below two venues, so the Services page and the host's calendar groups keep showing the
-- collective while it waits.
--
-- The moment the second venue joins, parking starts, which is when the host's dashboard offers
-- Continue setup.

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
           'live', c.paused_at IS NULL
                   AND m.suspended_at IS NULL
                   AND (SELECT count(*) FROM public.venue_collective_members m2
                        WHERE m2.collective_id = c.id AND m2.status = 'active') >= 2)
  FROM public.venue_collective_members m
  JOIN public.venue_collectives c ON c.id = m.collective_id
  WHERE m.venue_id = p_venue_id AND m.status = 'active'
    AND c.status = 'active' AND c.service_model = 'replicas'
  ORDER BY m.joined_at NULLS LAST, m.id
  LIMIT 1;
$$;
