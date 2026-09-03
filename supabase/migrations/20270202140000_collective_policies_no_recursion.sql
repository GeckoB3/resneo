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
-- SELF-CONTAINED ON PURPOSE. Staging applied 20270202130000 in its first form,
-- before the helpers were added to that file, so on staging the helpers do not
-- exist and the two categories policies still carry the recursive subqueries.
-- A migration must never be edited once applied anywhere; this one therefore
-- (re)defines all three helpers with CREATE OR REPLACE and rewrites all eight
-- policies, the six older ones and the two on the categories table. Where
-- 20270202130000 ran in its later form the helper definitions are identical and
-- the policy rewrites are no-ops in effect.
--
-- WHO CAN READ WHAT IS UNCHANGED. Each rewrite below states the old predicate it
-- replaces and why the helper form is the same set of rows. Membership of ANY
-- status counts, exactly as the old subqueries counted it.
--
-- Policy-only, no schema change: safe to apply before or after the code, which
-- never reads these tables as a client role.

-- =============================================================================
-- Helpers. Client-executable, read-only, identity- or public-state-scoped;
-- allowlisted in scripts/check-client-executable-functions.mjs.
-- =============================================================================

-- The collectives the caller's venues host or are a member of (any status).
CREATE OR REPLACE FUNCTION public.current_staff_collective_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.venue_collectives c
  WHERE c.host_venue_id IN (SELECT public.current_staff_venue_ids())
  UNION
  SELECT m.collective_id FROM public.venue_collective_members m
  WHERE m.venue_id IN (SELECT public.current_staff_venue_ids());
$$;

-- The collectives the caller's venues host (a strict subset of the above).
CREATE OR REPLACE FUNCTION public.current_staff_hosted_collective_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.venue_collectives c
  WHERE c.host_venue_id IN (SELECT public.current_staff_venue_ids());
$$;

-- Whether a combined page is live and public (active, unified_catalog).
CREATE OR REPLACE FUNCTION public.collective_is_public_catalog(p_collective uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.venue_collectives c
    WHERE c.id = p_collective AND c.status = 'active' AND c.page_mode = 'unified_catalog'
  );
$$;

-- =============================================================================
-- venue_collectives / venue_collective_members
-- =============================================================================

-- Was: host_venue_id IN staff venues OR id IN (members' collectives for staff
-- venues). The helper is that union.
DROP POLICY IF EXISTS "staff_select_collectives" ON public.venue_collectives;
CREATE POLICY "staff_select_collectives"
  ON public.venue_collectives FOR SELECT
  USING (id IN (SELECT public.current_staff_collective_ids()));

-- Was: venue_id IN staff venues OR collective_id IN (collectives hosted by staff
-- venues). Own rows plus every row of a hosted collective; a member does not see
-- the other members' rows.
DROP POLICY IF EXISTS "staff_select_collective_members" ON public.venue_collective_members;
CREATE POLICY "staff_select_collective_members"
  ON public.venue_collective_members FOR SELECT
  USING (
    venue_id IN (SELECT public.current_staff_venue_ids())
    OR collective_id IN (SELECT public.current_staff_hosted_collective_ids())
  );

-- =============================================================================
-- collective_service_items
-- =============================================================================

-- Was: collective hosted by OR joined by a staff venue. The helper is that union.
DROP POLICY IF EXISTS "staff_select_collective_service_items" ON public.collective_service_items;
CREATE POLICY "staff_select_collective_service_items"
  ON public.collective_service_items FOR SELECT
  USING (collective_id IN (SELECT public.current_staff_collective_ids()));

-- Was: status = 'active' AND the collective is active and unified_catalog.
DROP POLICY IF EXISTS "public_read_active_collective_service_items" ON public.collective_service_items;
CREATE POLICY "public_read_active_collective_service_items"
  ON public.collective_service_items FOR SELECT TO anon
  USING (status = 'active' AND public.collective_is_public_catalog(collective_id));

-- =============================================================================
-- collective_service_providers
-- =============================================================================

-- Was: venue_id IN staff venues OR the item belongs to a collective hosted by a
-- staff venue. The item subquery stays (its policy no longer recurses); the host
-- test goes through the helper.
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

-- Was: active + approved, and the item is active in an active unified_catalog
-- collective.
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

-- =============================================================================
-- collective_service_categories (20270202130000), restated for the reason above
-- =============================================================================

-- Staff of the host or any member venue may read.
DROP POLICY IF EXISTS "staff_select_collective_service_categories" ON public.collective_service_categories;
CREATE POLICY "staff_select_collective_service_categories"
  ON public.collective_service_categories FOR SELECT
  USING (collective_id IN (SELECT public.current_staff_collective_ids()));

-- Public: headings of a live unified_catalog page.
DROP POLICY IF EXISTS "public_read_active_collective_service_categories" ON public.collective_service_categories;
CREATE POLICY "public_read_active_collective_service_categories"
  ON public.collective_service_categories FOR SELECT TO anon
  USING (public.collective_is_public_catalog(collective_id));
