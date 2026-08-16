-- SA-C4 / SA-H4 — stop anonymous platform-wide reads of every venue's schedule,
-- and take away client write privileges on the scheduling tables.
--
-- Two independent changes that happen to share a subject. Either could ship
-- alone; they are together because they are one review and one schema window.
--
-- ---------------------------------------------------------------------------
-- PART A — the live problem. Nine `TO anon` SELECT policies, none with a venue
-- predicate.
--
-- `public_read_unified_calendars` is the one that matters: one unauthenticated
-- PostgREST request returns EVERY venue on the platform's staff names, working
-- hours, breaks, days off, capacity and prices. `20270107120000:5-9` already
-- named this shape a venue-id harvesting oracle and closed the adjacent
-- waitlist case; these nine survived it.
--
-- This is a confidentiality and competitive-intelligence matter, not a breach
-- matter. `availability_blocks.reason` is free text an owner types and was the
-- basis for filing SA-C4 as Critical for personal-data exposure; the column was
-- queried on production 2026-08-16 and is EMPTY PLATFORM-WIDE, so Art. 9 is not
-- engaged and the finding sits at High. Dropping the policy is still right: an
-- empty column is luck, not a control, and the field is still writable.
--
-- ---------------------------------------------------------------------------
-- PART B — write privileges nobody uses, on six scheduling tables.
--
-- Hosted Supabase grants `anon` and `authenticated` the full default privilege
-- set at project creation, through project-level default privileges that live
-- outside this repository. Confirmed by query on 2026-08-16: that includes
-- TRUNCATE, on all six tables, for `anon`.
--
-- BE CLEAR ABOUT WHAT THIS FIXES. Those writes are refused today. Every
-- `staff_manage_*` policy on these tables is `FOR ALL` with no `TO` clause, so
-- it applies to every role, and its predicate reads `auth.jwt() ->> 'email'`,
-- which is null for `anon`. The predicate fails and the write is rejected. This
-- migration removes reach that a policy is currently holding shut. It is
-- defence in depth, not an incident: one unrelated edit to those policies is
-- all that stands between the grant and a stranger truncating a venue's diary.
--
-- SELECT IS DELIBERATELY KEPT, and this is the load-bearing decision.
-- `PractitionerCalendarView` opens `postgres_changes` channels on
-- `practitioner_calendar_blocks` and `calendar_blocks` (`:3598`, `:3605`).
-- Realtime evaluates row visibility for the subscribing role, so removing
-- SELECT does not error: the channel subscribes successfully and never fires
-- again, silently, which is exactly the failure D1 documented. The diary would
-- simply stop updating and nothing anywhere would say why.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE AGAINST THE CODE CURRENTLY RUNNING, verified not assumed.
--
-- The publishable (anon) key reaches Postgres through exactly two factories:
-- `src/lib/supabase/browser.ts` and `src/lib/supabase/server.ts`.
-- `getSupabaseClient()` in `src/lib/supabase/index.ts` is a third, and has zero
-- callers outside its own module.
--
-- All 27 files importing the browser client were enumerated on 2026-08-16 and
-- NONE issues a `.from()` against any of the twelve tables below. Their only
-- contact with this subject is realtime subscription, which is why SELECT
-- stays. Every server path reads and writes through `getSupabaseAdminClient()`
-- or `staff.db`, both `service_role`, which bypasses RLS and table privileges
-- alike. The public booking routes and both public page loaders are on that
-- path, so Part A cannot affect a guest-facing request.
--
-- `PUBLIC` is not named in the REVOKEs below, and the omission is deliberate.
-- `20270108120000` had to name it because PostgreSQL grants EXECUTE on
-- FUNCTIONS to PUBLIC by default. There is no equivalent default for TABLES,
-- and no migration in this repository grants a table to PUBLIC (verified by
-- grep). Naming it here would imply a mechanism that does not exist.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES NOT DO, so nobody reads it as more than it is.
--
-- Roughly twenty further `TO anon` SELECT policies remain on adjacent tables:
-- `appointment_services`, `calendar_service_assignments`, `service_variants`,
-- `addons`, `class_types`, `class_instances`, `venue_resources`, the two
-- collective tables and others. Several expose venue names and prices platform
-- wide by the same mechanism. **Platform-wide enumeration is therefore NARROWED
-- BY THIS MIGRATION, NOT CLOSED.** The nine below are the ones the scheduling
-- audit scoped; the rest belong to the booking-catalogue surface and want their
-- own pass, with their own check of which public page reads what.

-- ===========================================================================
-- PART A — drop the nine anonymous read policies.
--
-- Dropping a policy does not error a reader: `anon` keeps the SELECT privilege,
-- RLS finds no permissive policy, and the query returns zero rows. That is the
-- intended outcome and the reason no application error handling changes here.
-- ===========================================================================

-- 20260308000001_availability_engine_overhaul.sql:210-237
DROP POLICY IF EXISTS "public_read_venue_services" ON public.venue_services;
DROP POLICY IF EXISTS "public_read_capacity_rules" ON public.service_capacity_rules;
DROP POLICY IF EXISTS "public_read_party_durations" ON public.party_size_durations;
DROP POLICY IF EXISTS "public_read_booking_restrictions" ON public.booking_restrictions;
DROP POLICY IF EXISTS "public_read_availability_blocks" ON public.availability_blocks;

-- 20260323120000_availability_calendar_and_exceptions.sql:81-89
DROP POLICY IF EXISTS "public_read_booking_restriction_exceptions" ON public.booking_restriction_exceptions;
DROP POLICY IF EXISTS "public_read_service_schedule_exceptions" ON public.service_schedule_exceptions;

-- 20260430120000_unified_scheduling_engine.sql:392-398. The two that carry the
-- staff names, working patterns and prices.
DROP POLICY IF EXISTS "public_read_unified_calendars" ON public.unified_calendars;
DROP POLICY IF EXISTS "public_read_service_items" ON public.service_items;

-- ===========================================================================
-- PART B — remove client write privileges on the six scheduling tables.
--
-- The verb list is explicit rather than `ALL` so that SELECT is visibly
-- retained at every call site, and it is the FULL write set: naming only
-- INSERT, UPDATE and DELETE (as SA-H4's fix text does) would leave TRUNCATE,
-- REFERENCES and TRIGGER in place, and TRUNCATE is the one that would hurt.
--
-- The GRANT SELECT that follows each REVOKE is a no-op on hosted, where the
-- privilege already exists. It is here for the LOCAL instance: a database built
-- only from these migrations has no project-level default privileges, so once
-- `supabase/scripts/local_baseline_grants.sql` stops blanket-granting these six
-- tables (it must, and this migration is accompanied by that change), the
-- migration has to state the privilege the table should end up with. Without
-- it, the pgTAP suite would fail on `permission denied` before reaching a
-- policy, and would be testing an environment that exists nowhere.
-- ===========================================================================

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.unified_calendars FROM anon, authenticated;
GRANT SELECT ON public.unified_calendars TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.calendar_blocks FROM anon, authenticated;
GRANT SELECT ON public.calendar_blocks TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.availability_blocks FROM anon, authenticated;
GRANT SELECT ON public.availability_blocks TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.practitioner_leave_periods FROM anon, authenticated;
GRANT SELECT ON public.practitioner_leave_periods TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.practitioner_calendar_blocks FROM anon, authenticated;
GRANT SELECT ON public.practitioner_calendar_blocks TO anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.service_schedule_exceptions FROM anon, authenticated;
GRANT SELECT ON public.service_schedule_exceptions TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION — run against the environment just migrated.
--
-- 1. The pgTAP suite covers both parts and runs in CI on every push:
--
--      npm run test:rls
--
--    `supabase/tests/scheduling_grants_test.sql` asserts that `authenticated`
--    can still SELECT each of the six and can no longer INSERT into them, and
--    that `anon` reads zero rows from `unified_calendars` and
--    `availability_blocks`.
--
-- 2. Confirm the privileges are actually gone, on the environment itself:
--
--      SELECT table_name, grantee, privilege_type
--      FROM information_schema.role_table_grants
--      WHERE table_schema = 'public'
--        AND grantee IN ('anon','authenticated')
--        AND table_name IN (
--          'unified_calendars','calendar_blocks','availability_blocks',
--          'practitioner_leave_periods','practitioner_calendar_blocks',
--          'service_schedule_exceptions')
--      ORDER BY table_name, grantee, privilege_type;
--
--    Expected: SELECT only, for both roles, on all six. Anything else means the
--    REVOKE ran as a role that did not hold the grant, which fails silently.
--
-- 3. THE GATE BEFORE PRODUCTION, which no automated check here covers.
--    On staging, open the practitioner diary and, from a second session, add or
--    move a calendar block. The diary must update live. This is the realtime
--    path on `calendar_blocks` and `practitioner_calendar_blocks`, and D1
--    records that its failure mode is silence rather than an error, so it has
--    to be watched rather than inferred.
--
-- 4. Then load a public booking page for a venue and take a booking through to
--    confirmation. It should be entirely unaffected — every step is service
--    role — and that is the point: if anything here changes what a guest sees,
--    the premise in "WHY THIS IS SAFE" is wrong and this should be rolled back.
--
-- ROLLBACK. Both parts reverse cleanly and neither destroys data. Re-create the
-- nine policies from the three migrations cited above, and
-- `GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` back to the two
-- roles. Nothing is dropped, altered or rewritten by this file.
-- ---------------------------------------------------------------------------
