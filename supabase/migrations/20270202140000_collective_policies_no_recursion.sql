-- Collective RLS: end the mutual recursion between the collective policies.
--
-- THE FAULT. `staff_select_collectives` (20260919120000) subqueries
-- venue_collective_members, and `staff_select_collective_members` subqueries
-- venue_collectives back. Both policies apply to every role, so evaluating either
-- table's policy as `anon` or `authenticated` raises "infinite recursion detected
-- in policy for relation venue_collectives". The offerings and providers policies
-- (20261210120000) subquery the same two tables and inherit the fault. Nothing
-- noticed because every collective read in the app goes through the service
-- role; the pgTAP suite for collective_service_categories was the first thing to
-- evaluate the chain as a client role, and it failed in CI.
--
-- THE FIX. Each policy now reads collective membership through a SECURITY
-- DEFINER helper, which runs as the tables' owner outside RLS, the same way
-- `current_staff_venue_ids` reads staff. No policy subqueries venue_collectives
-- or venue_collective_members directly any more, so there is nothing left to
-- recurse.
--
-- WHO CAN READ WHAT IS UNCHANGED. Each rewrite below states the old predicate it
-- replaces and why the helper form is the same set of rows. The two helpers from
-- 20270202130000 count membership of any status, exactly as the old subqueries
-- did. The one addition is `current_staff_hosted_collective_ids`, needed where
-- the old predicate granted the HOST alone (member rows, provider rows).
--
-- Policy-only, no schema change: safe to apply before or after the code, which
-- never reads these tables as a client role.

-- The collectives the caller's venues host (a strict subset of
-- current_staff_collective_ids). Client-executable, read-only, identity-scoped;
-- allowlisted in scripts/check-client-executable-functions.mjs.
CREATE OR REPLACE FUNCTION public.current_staff_hosted_collective_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.venue_collectives c
  WHERE c.host_venue_id IN (SELECT public.current_staff_venue_ids());
$$;

-- venue_collectives. Was: host_venue_id IN staff venues OR id IN (members'
-- collectives for staff venues). The helper is that union.
DROP POLICY IF EXISTS "staff_select_collectives" ON public.venue_collectives;
CREATE POLICY "staff_select_collectives"
  ON public.venue_collectives FOR SELECT
  USING (id IN (SELECT public.current_staff_collective_ids()));

-- venue_collective_members. Was: venue_id IN staff venues OR collective_id IN
-- (collectives hosted by staff venues). Own rows plus every row of a hosted
-- collective; a member does not see the other members' rows.
DROP POLICY IF EXISTS "staff_select_collective_members" ON public.venue_collective_members;
CREATE POLICY "staff_select_collective_members"
  ON public.venue_collective_members FOR SELECT
  USING (
    venue_id IN (SELECT public.current_staff_venue_ids())
    OR collective_id IN (SELECT public.current_staff_hosted_collective_ids())
  );

-- collective_service_items, staff. Was: collective hosted by OR joined by a staff
-- venue. The helper is that union.
DROP POLICY IF EXISTS "staff_select_collective_service_items" ON public.collective_service_items;
CREATE POLICY "staff_select_collective_service_items"
  ON public.collective_service_items FOR SELECT
  USING (collective_id IN (SELECT public.current_staff_collective_ids()));

-- collective_service_items, public. Was: status = 'active' AND the collective is
-- active and unified_catalog. The helper answers the second half.
DROP POLICY IF EXISTS "public_read_active_collective_service_items" ON public.collective_service_items;
CREATE POLICY "public_read_active_collective_service_items"
  ON public.collective_service_items FOR SELECT TO anon
  USING (status = 'active' AND public.collective_is_public_catalog(collective_id));

-- collective_service_providers, staff. Was: venue_id IN staff venues OR the item
-- belongs to a collective hosted by a staff venue. The item subquery stays (its
-- policy no longer recurses); the host test goes through the helper.
DROP POLICY IF EXISTS "staff_select_collective_service_providers" ON public.collective_service_providers;
CREATE POLICY "staff_select_collective_service_providers"
  ON public.collective_service_providers FOR SELECT
  USING (
    venue_id IN (SELECT public.current_staff_venue_ids())
    OR item_id IN (
      SELECT i.id FROM public.collective_service_items i
      WHERE i.collective_id IN (SELECT public.current_staff_hosted_collective_ids())
    )
  );

-- collective_service_providers, public. Was: active + approved, and the item is
-- active in an active unified_catalog collective.
DROP POLICY IF EXISTS "public_read_bookable_collective_service_providers" ON public.collective_service_providers;
CREATE POLICY "public_read_bookable_collective_service_providers"
  ON public.collective_service_providers FOR SELECT TO anon
  USING (
    status = 'active'
    AND approval_status = 'approved'
    AND item_id IN (
      SELECT i.id FROM public.collective_service_items i
      WHERE i.status = 'active' AND public.collective_is_public_catalog(i.collective_id)
    )
  );
