-- W15 (Docs/collective-one-venue-plan.md §2.2, §8.3; SEC-05): stop anonymous platform-wide reads
-- of the service catalogue and the collective membership graph, and take client write privileges
-- away from `anon` on the service and collective tables.
--
-- The follow-up 20270113120000 promised ("Platform-wide enumeration is therefore NARROWED BY THIS
-- MIGRATION, NOT CLOSED ... the rest belong to the booking-catalogue surface and want their own
-- pass"). This is that pass, scoped to what the collective work needs before W8 adds per-calendar
-- columns and an `auth.users` id to `calendar_service_assignments`.
--
-- ---------------------------------------------------------------------------
-- PART A: eight `TO anon` SELECT policies with no venue predicate.
--
-- `public_read_calendar_service_assignments` is `USING (true)`: one unauthenticated PostgREST
-- request returns every calendar's custom prices and lengths on the platform, and W8 would add
-- `updated_by_user_id` to the same rows. `public_read_active_collective_members` makes every
-- venue's collective membership enumerable. The others expose every venue's options, add-ons and
-- legacy services by the same mechanism.
--
-- SAFE AGAINST THE RUNNING CODE, verified 2026-09-15: every public page and public booking route
-- reads these tables through `getSupabaseAdminClient()`, and `getVenueStaff().db` is the admin
-- client too (`src/lib/venue-auth.ts`). No file using the publishable-key clients
-- (`src/lib/supabase/browser.ts`, `server.ts`) issues a `.from()` against any of them, and no
-- realtime channel subscribes to them. Dropping a policy does not error a reader: `anon` keeps
-- SELECT, finds no permissive policy, and reads zero rows.
--
-- KEPT, deliberately: the anonymous reads of a LIVE public combined page's own offerings,
-- providers, categories and collective row (`collective_is_public_catalog`), which show only what
-- that public page already shows and which `collective_policies_test.sql` pins.
--
-- ---------------------------------------------------------------------------
-- PART B: `anon` write privileges on seventeen service and collective tables.
--
-- Hosted Supabase grants `anon` the full default privilege set, TRUNCATE included (queried on
-- staging 2026-09-15). RLS refuses those writes today, because every staff policy's predicate
-- reads a JWT email that is null for `anon`; this removes reach a policy is holding shut, as
-- 20270113120000 did for the scheduling tables. `authenticated` is left as it is: the RLS suite
-- exercises the staff policies through that role, and narrowing it is its own decision.
--
-- No change to `supabase/scripts/local_baseline_grants.sql` is needed: it grants `anon` SELECT
-- only, which is exactly what these tables end with here.

-- ===========================================================================
-- PART A
-- ===========================================================================

-- 20260430120000_unified_scheduling_engine.sql:399-401 (USING (true))
DROP POLICY IF EXISTS "public_read_calendar_service_assignments" ON public.calendar_service_assignments;
-- 20260327000001:344, its legacy twin
DROP POLICY IF EXISTS "public_read_practitioner_services" ON public.practitioner_services;
DROP POLICY IF EXISTS "public_read_appointment_services" ON public.appointment_services;
-- 20260730120000:64-66
DROP POLICY IF EXISTS "public_read_service_variants" ON public.service_variants;
-- 20261201120000:225-253
DROP POLICY IF EXISTS "public_read_addon_groups" ON public.addon_groups;
DROP POLICY IF EXISTS "public_read_addons" ON public.addons;
DROP POLICY IF EXISTS "public_read_service_addon_groups" ON public.service_addon_groups;
-- 20260919120000:558-559 (USING (status = 'active'))
DROP POLICY IF EXISTS "public_read_active_collective_members" ON public.venue_collective_members;

-- ===========================================================================
-- PART B
-- ===========================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'service_items', 'service_variants', 'addon_groups', 'addons', 'service_addon_groups',
    'calendar_service_assignments', 'practitioner_services', 'appointment_services',
    'service_categories', 'compliance_types', 'compliance_type_versions',
    'service_compliance_requirements',
    'venue_collectives', 'venue_collective_members', 'collective_service_items',
    'collective_service_providers', 'collective_service_categories'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM anon', t);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Verify after applying (read-only), on each environment:
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND 'anon' = ANY (roles)
--     AND tablename IN ('calendar_service_assignments', 'practitioner_services',
--       'appointment_services', 'service_variants', 'addon_groups', 'addons',
--       'service_addon_groups', 'venue_collective_members');          -- expect 0 rows
--
--   SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public' AND c.relname IN (...the seventeen above...)
--     AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
--       OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'));
--                                                                     -- expect 0 rows
