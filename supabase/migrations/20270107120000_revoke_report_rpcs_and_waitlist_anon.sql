-- C1 and C2 from Docs/Resneo_Forensic_Audit_August_2026.md
--
-- C1. Four SECURITY DEFINER reporting functions take a caller-supplied
-- p_venue_id and perform no authorisation check of their own. Supabase's default
-- privileges grant anon and authenticated a direct EXECUTE on functions created
-- in `public`, so any holder of the publishable key that ships in every public
-- booking page can call them for any venue id. Venue ids are harvestable: anon
-- holds SELECT on unified_calendars under USING (is_active = true). Verified
-- live against staging on 2026-08-13, all four returning 200 to the anon key.
--
-- All four are STABLE, so PostgREST also exposes them over GET. The exploit is a
-- query string, not just a POST body.
--
-- ORDERING. This migration must be applied only AFTER the code change in commit
-- 13695d00, which moved all four onto staff.db (service_role) at
-- src/app/api/venue/reports/route.ts:611-614. Applying it first would 500 the
-- reports page. That deploy is live on staging and its figures were verified
-- against the previous values.
--
-- Note the pattern: REVOKE ... FROM PUBLIC alone does NOT close this. It removes
-- only the PUBLIC grant and leaves the direct anon/authenticated grants intact.
-- 20270101120400 revoked report_deposit_summary FROM PUBLIC and achieved
-- nothing, which is how the root cause was found. Always name all three roles.
--
-- C2. waitlist_entries carries guest_name, guest_email, guest_phone and notes,
-- and two policies expose it to anon with no predicate at all: SELECT USING
-- (true) and INSERT WITH CHECK (true), across every venue. Both are dropped.
--
-- FOLLOW-UP (not done here, deliberately):
--  * `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE
--    ON FUNCTIONS FROM anon, authenticated;` so new functions fail closed rather
--    than inheriting this exposure. C0 deferred it pending an audit of genuinely
--    client-called RPCs; that audit is now complete. Once this migration lands
--    the legitimate client-callable set is exactly 12: the 8 RLS helpers, which
--    must keep their grants, and the 4 auth.uid()-scoped functions, whose bodies
--    were read on 2026-08-13 and confirmed parameterless and uid-derived. It is
--    still a behaviour change and belongs in its own migration.
--  * Drop public.report_frequent_visitors. Zero callers; revoked by C0 but not
--    dropped, to keep a security patch free of schema changes.

-- ---------------------------------------------------------------------------
-- C1. The four report RPCs. Sole caller is /api/venue/reports, on staff.db.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.report_booking_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_booking_summary(uuid, timestamptz, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION public.report_no_show_series(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_no_show_series(uuid, timestamptz, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.report_cancellation(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_cancellation(uuid, timestamptz, timestamptz) TO service_role;

-- 20270101120400 already revoked this one FROM PUBLIC. That was a no-op; the
-- anon and authenticated grants survived it. This is the effective revoke.
REVOKE ALL ON FUNCTION public.report_deposit_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.report_deposit_summary(uuid, timestamptz, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- C2. waitlist_entries anon policies.
--
-- Safe to drop: both guest-facing writers (/api/booking/waitlist and
-- /api/booking/appointment-waitlist) use getSupabaseAdminClient(), which is
-- service_role and bypasses RLS. The only browser-side reader is the dashboard
-- realtime subscription at WaitlistPageClient.tsx:384, which runs as
-- authenticated and is served by staff_manage_waitlist. That policy is FOR ALL
-- with no TO clause, so it already covers every role; for anon its staff-email
-- subquery is empty, which is why these two permissive policies are the whole
-- of the anonymous exposure.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "public_read_own_waitlist" ON public.waitlist_entries;
DROP POLICY IF EXISTS "public_insert_waitlist" ON public.waitlist_entries;

-- ---------------------------------------------------------------------------
-- VERIFICATION
--
-- 1. The C0 sweep should now return 12 rows, down from 16: the 8 RLS helpers
--    and the 4 auth.uid()-scoped functions. No report_* function should appear.
--
--      SELECT p.oid::regprocedure AS signature,
--             has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
--             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.prosecdef
--        AND p.prorettype <> 'trigger'::regtype
--        AND has_function_privilege('anon', p.oid, 'EXECUTE');
--
-- 2. waitlist_entries should retain exactly one policy, staff_manage_waitlist:
--
--      SELECT policyname, roles, cmd FROM pg_policies
--      WHERE schemaname = 'public' AND tablename = 'waitlist_entries';
--
-- 3. Smoke test, in this order:
--    a. Load the dashboard reports page as an admin. All four panels must show
--       the same figures as before this migration. This is the one that fails
--       loudly if the code deploy has not rolled everywhere yet.
--    b. Load the dashboard waitlist page. Entries list, and the live refresh
--       still fires on a change.
--    c. Join a waitlist from a public booking page. It must still succeed.
-- ---------------------------------------------------------------------------
