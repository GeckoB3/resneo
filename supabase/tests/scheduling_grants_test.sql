-- Resneo: scheduling table grants and anonymous read policies.
-- Covers 20270113120000 (SA-C4 / SA-H4 in
-- Docs/Resneo_Scheduling_Availability_Audit_August_2026.md).
--
-- Proves the two halves of that migration:
--   * `anon` can no longer read schedules platform-wide (nine policies dropped);
--   * `anon` and `authenticated` can no longer WRITE the six scheduling tables;
--   * both can still SELECT them, which realtime delivery depends on.
--
-- The SELECT assertions are the ones to protect. Removing SELECT does not
-- error: the diary's `postgres_changes` channels on `calendar_blocks` and
-- `practitioner_calendar_blocks` would subscribe successfully and never fire
-- again, silently, which is the failure D1 recorded. A test is the only thing
-- that catches a future migration doing that by accident.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

-- =============================================================================
-- Fixtures — seeded as the (superuser) session role, which bypasses RLS.
--
-- One venue, one admin, and one row in each of the six tables, so that a SELECT
-- returning zero would be a real failure rather than an empty table.
-- =============================================================================

INSERT INTO venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-0000000000d1', 'Grants Venue', 'grants-venue',
        'grants@rls.test', 'appointments', 'active', 'practitioner_appointment');

-- `staff_manage_*` matches on `auth.jwt() ->> 'email'`, so the email is the key.
INSERT INTO staff (id, venue_id, email, name, role)
VALUES ('00000000-0000-0000-0000-0000000000d2',
        '00000000-0000-0000-0000-0000000000d1', 'admin-d@rls.test', 'Admin D', 'admin');

INSERT INTO practitioners (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-0000000000d3',
        '00000000-0000-0000-0000-0000000000d1', 'Pract D');

-- `venue_services.area_id` is NOT NULL, and the constraint is NOT in that
-- table's CREATE TABLE: `20260620120000_multi_area_restaurant_venues.sql:244`
-- adds the column, backfills it and sets NOT NULL, 300-odd migrations later.
-- Reading the original DDL alone produces a fixture that fails on insert,
-- which is exactly how this file failed its first CI run. The sibling suite
-- carries the same scar for `guests.name`, dropped by a later migration while
-- its fixture still referenced it. Check the ALTERs, not just the CREATE.
INSERT INTO areas (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-0000000000d0',
        '00000000-0000-0000-0000-0000000000d1', 'Main');

INSERT INTO venue_services (id, venue_id, area_id, name, start_time, end_time, last_booking_time)
VALUES ('00000000-0000-0000-0000-0000000000d4',
        '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d0', 'Service D', '09:00', '17:00', '16:30');

INSERT INTO unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-0000000000d5',
        '00000000-0000-0000-0000-0000000000d1', 'Calendar D');

-- Stage 6a. FK'd to unified_calendars, not practitioners: every calendar lives there, and
-- `practitioners` is the table whose empty FK space keeps practitioner_calendar_blocks
-- permanently unreachable.
INSERT INTO calendar_date_overrides (id, venue_id, calendar_id, override_kind, date_start, date_end)
VALUES ('00000000-0000-0000-0000-0000000000d8',
        '00000000-0000-0000-0000-0000000000d1',
        (SELECT id FROM unified_calendars WHERE venue_id = '00000000-0000-0000-0000-0000000000d1' LIMIT 1),
        'closed', '2026-09-10', '2026-09-10');

INSERT INTO calendar_blocks (calendar_id, venue_id, block_date, start_time, end_time)
VALUES ('00000000-0000-0000-0000-0000000000d5',
        '00000000-0000-0000-0000-0000000000d1', '2026-09-01', '12:00', '13:00');

INSERT INTO practitioner_calendar_blocks (venue_id, practitioner_id, block_date, start_time, end_time)
VALUES ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d3', '2026-09-01', '14:00', '15:00');

-- NOTE THE ASYMMETRY, which is real and not a typo above.
--
-- `practitioner_leave_periods.practitioner_id` points at UNIFIED_CALENDARS:
-- `20260918140000_practitioner_leave_unified_calendar_fk.sql:52` dropped the
-- legacy FK to `practitioners` and re-pointed it. Its sibling
-- `practitioner_calendar_blocks.practitioner_id` was never re-pointed and still
-- references `practitioners`. Two identically named columns on two adjacent
-- tables, resolving to two different tables in the same UUID space -- which is
-- survivable in production only because `practitioners` has zero rows and every
-- venue is unified.
INSERT INTO practitioner_leave_periods (venue_id, practitioner_id, start_date, end_date)
VALUES ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d5', '2026-09-02', '2026-09-03');

INSERT INTO availability_blocks (venue_id, date_start, date_end, reason)
VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-04', '2026-09-04', 'stock take');

INSERT INTO service_schedule_exceptions (venue_id, service_id, date_start, date_end, is_closed)
VALUES ('00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d4', '2026-09-05', '2026-09-05', true);

-- =============================================================================
-- Tests 1-6 — `authenticated` staff can still SELECT all six.
--
-- This is the realtime guarantee. If any of these six starts returning zero,
-- the diary stops updating live and nothing reports it.
-- =============================================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"admin-d@rls.test"}';

SELECT is((SELECT count(*) FROM unified_calendars
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT unified_calendars');

SELECT is((SELECT count(*) FROM calendar_blocks
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT calendar_blocks (realtime)');

SELECT is((SELECT count(*) FROM practitioner_calendar_blocks
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT practitioner_calendar_blocks (realtime)');

SELECT is((SELECT count(*) FROM practitioner_leave_periods
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT practitioner_leave_periods');

SELECT is((SELECT count(*) FROM calendar_date_overrides
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT calendar_date_overrides');

SELECT is((SELECT count(*) FROM availability_blocks
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT availability_blocks');

SELECT is((SELECT count(*) FROM service_schedule_exceptions
           WHERE venue_id = '00000000-0000-0000-0000-0000000000d1')::int,
          1, 'authenticated staff can still SELECT service_schedule_exceptions');

-- =============================================================================
-- Tests 7-12 — `authenticated` can no longer INSERT into any of the six.
--
-- 42501 is `insufficient_privilege`. Table privileges are checked BEFORE RLS,
-- so this is the grant failing, not a policy: these staff credentials satisfy
-- the venue predicate and would have been allowed through before the revoke.
-- That is the whole point of the finding.
-- =============================================================================

SELECT throws_ok(
  $$ INSERT INTO unified_calendars (venue_id, name)
     VALUES ('00000000-0000-0000-0000-0000000000d1', 'Sneaky Calendar') $$,
  '42501', NULL, 'authenticated cannot INSERT unified_calendars');

SELECT throws_ok(
  $$ INSERT INTO calendar_blocks (calendar_id, venue_id, block_date, start_time, end_time)
     VALUES ('00000000-0000-0000-0000-0000000000d5',
             '00000000-0000-0000-0000-0000000000d1', '2026-09-10', '09:00', '10:00') $$,
  '42501', NULL, 'authenticated cannot INSERT calendar_blocks');

SELECT throws_ok(
  $$ INSERT INTO calendar_date_overrides (venue_id, calendar_id, override_kind, date_start, date_end)
     VALUES ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d5', 'closed', '2026-09-11', '2026-09-11') $$,
  '42501', NULL, 'authenticated cannot INSERT calendar_date_overrides');

SELECT throws_ok(
  $$ UPDATE calendar_date_overrides SET date_end = '2026-09-12'
      WHERE id = '00000000-0000-0000-0000-0000000000d8' $$,
  '42501', NULL, 'authenticated cannot UPDATE calendar_date_overrides');

SELECT throws_ok(
  $$ INSERT INTO practitioner_calendar_blocks (venue_id, practitioner_id, block_date, start_time, end_time)
     VALUES ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d3', '2026-09-10', '09:00', '10:00') $$,
  '42501', NULL, 'authenticated cannot INSERT practitioner_calendar_blocks');

-- The calendar id, not the practitioner id, for the FK reason noted at the
-- fixture. The privilege check fires before the constraint either way, so this
-- would pass with the wrong id today; it is correct so that removing the
-- revoke makes this fail as a privilege assertion rather than an FK error.
SELECT throws_ok(
  $$ INSERT INTO practitioner_leave_periods (venue_id, practitioner_id, start_date, end_date)
     VALUES ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d5', '2026-09-11', '2026-09-12') $$,
  '42501', NULL, 'authenticated cannot INSERT practitioner_leave_periods');

SELECT throws_ok(
  $$ INSERT INTO availability_blocks (venue_id, date_start, date_end)
     VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-13', '2026-09-13') $$,
  '42501', NULL, 'authenticated cannot INSERT availability_blocks');

SELECT throws_ok(
  $$ INSERT INTO service_schedule_exceptions (venue_id, service_id, date_start, date_end)
     VALUES ('00000000-0000-0000-0000-0000000000d1',
             '00000000-0000-0000-0000-0000000000d4', '2026-09-14', '2026-09-14') $$,
  '42501', NULL, 'authenticated cannot INSERT service_schedule_exceptions');

-- =============================================================================
-- Tests 13-14 — UPDATE and DELETE are gone too, not just INSERT.
--
-- Asserted separately because the revoke names six verbs and a partial revoke
-- would still pass tests 7-12. SA-H4's own fix text named only three of them.
-- =============================================================================

SELECT throws_ok(
  $$ UPDATE unified_calendars SET name = 'Renamed'
     WHERE id = '00000000-0000-0000-0000-0000000000d5' $$,
  '42501', NULL, 'authenticated cannot UPDATE unified_calendars');

SELECT throws_ok(
  $$ DELETE FROM availability_blocks
     WHERE venue_id = '00000000-0000-0000-0000-0000000000d1' $$,
  '42501', NULL, 'authenticated cannot DELETE availability_blocks');

-- =============================================================================
-- Tests 15-17 — `anon` reads nothing, now the nine policies are gone.
--
-- These return zero ROWS rather than raising: `anon` keeps the SELECT
-- privilege, RLS finds no permissive policy, and the result is empty. That is
-- the designed outcome. A count of 1 here means a policy came back.
-- =============================================================================

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

SELECT is((SELECT count(*) FROM unified_calendars)::int, 0,
          'anon reads no unified_calendars (the platform-wide staff/hours/price oracle)');

SELECT is((SELECT count(*) FROM availability_blocks)::int, 0,
          'anon reads no availability_blocks');

SELECT is((SELECT count(*) FROM service_schedule_exceptions)::int, 0,
          'anon reads no service_schedule_exceptions');

-- =============================================================================
-- Test 18 — and `anon` cannot write either.
--
-- The privilege it held on 2026-08-16 included TRUNCATE. It was refused in
-- practice only because `staff_manage_*` is FOR ALL with no TO clause and its
-- email predicate is null for `anon`. This asserts the grant itself is gone, so
-- the refusal no longer depends on one policy staying exactly as written.
-- =============================================================================

SELECT throws_ok(
  $$ INSERT INTO availability_blocks (venue_id, date_start, date_end)
     VALUES ('00000000-0000-0000-0000-0000000000d1', '2026-09-20', '2026-09-20') $$,
  '42501', NULL, 'anon cannot INSERT availability_blocks');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
