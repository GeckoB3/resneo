-- Resneo: collective RLS after 20270202140000 (no policy recursion).
--
-- Before that migration, reading venue_collectives, venue_collective_members,
-- collective_service_items or collective_service_providers as a client role
-- raised "infinite recursion detected in policy". Every SELECT below would have
-- errored out, so the assertions double as the regression test for the
-- recursion: a policy that reintroduces a subquery on the two collective tables
-- aborts this file before its first `is()`.
--
-- Who can read what is asserted role by role: host staff, member staff, staff
-- of a venue outside the collective, and anonymous.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

-- =============================================================================
-- Fixtures, seeded as the (superuser) session role, which bypasses RLS.
-- =============================================================================

INSERT INTO venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'Policy Host', 'policy-host',
   'policy-host@rls.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000000000c2', 'Policy Member', 'policy-member',
   'policy-member@rls.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000000000c3', 'Policy Outsider', 'policy-outsider',
   'policy-outsider@rls.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO staff (id, venue_id, email, name, role)
VALUES
  ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c1',
   'policy-host-admin@rls.test', 'Host Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000c5', '00000000-0000-0000-0000-0000000000c2',
   'policy-member-admin@rls.test', 'Member Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000c3',
   'policy-outsider-admin@rls.test', 'Outsider Admin', 'admin');

INSERT INTO venue_collectives (id, slug, name, host_venue_id, status, page_mode)
VALUES ('00000000-0000-0000-0000-0000000000c7', 'policy-combined', 'Policy Combined',
        '00000000-0000-0000-0000-0000000000c1', 'active', 'unified_catalog');

INSERT INTO venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c7',
   '00000000-0000-0000-0000-0000000000c1', 'active'),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000c7',
   '00000000-0000-0000-0000-0000000000c2', 'active');

INSERT INTO collective_service_items (id, collective_id, name, status)
VALUES
  ('00000000-0000-0000-0000-0000000000ca', '00000000-0000-0000-0000-0000000000c7', 'Cut', 'active'),
  ('00000000-0000-0000-0000-0000000000cb', '00000000-0000-0000-0000-0000000000c7', 'Old', 'archived');

-- One provider from each venue on the live offering: the host's is bookable, the
-- member's is still pending approval (so anon must not see it).
INSERT INTO collective_service_providers
  (id, item_id, member_id, venue_id, source_service_id, practitioner_id, approval_status, status)
VALUES
  ('00000000-0000-0000-0000-0000000000cc', '00000000-0000-0000-0000-0000000000ca',
   '00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c1',
   '00000000-0000-0000-0000-0000000000cd', NULL, 'approved', 'active'),
  ('00000000-0000-0000-0000-0000000000ce', '00000000-0000-0000-0000-0000000000ca',
   '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000c2',
   '00000000-0000-0000-0000-0000000000cf', NULL, 'pending', 'active');

-- =============================================================================
-- Host staff: the collective, every member row, every offering, every provider.
-- =============================================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"policy-host-admin@rls.test"}';

SELECT is((SELECT count(*) FROM venue_collectives)::int, 1, 'Host staff read the collective');
SELECT is((SELECT count(*) FROM venue_collective_members)::int, 2, 'Host staff read every member row');
SELECT is((SELECT count(*) FROM collective_service_items)::int, 2, 'Host staff read every offering, archived included');
SELECT is((SELECT count(*) FROM collective_service_providers)::int, 2, 'Host staff read every provider row');

-- =============================================================================
-- Member staff: the collective, their OWN member row, every offering, their
-- OWN provider rows.
-- =============================================================================

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"policy-member-admin@rls.test"}';

SELECT is((SELECT count(*) FROM venue_collectives)::int, 1, 'Member staff read the collective');
SELECT is(
  (SELECT venue_id FROM venue_collective_members),
  '00000000-0000-0000-0000-0000000000c2'::uuid,
  'Member staff read only their own member row');
SELECT is((SELECT count(*) FROM collective_service_items)::int, 2, 'Member staff read the offerings');
SELECT is(
  (SELECT venue_id FROM collective_service_providers),
  '00000000-0000-0000-0000-0000000000c2'::uuid,
  'Member staff read only their own provider rows');

-- =============================================================================
-- Staff of a venue outside the collective: nothing.
-- =============================================================================

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"policy-outsider-admin@rls.test"}';

SELECT is((SELECT count(*) FROM venue_collectives)::int, 0, 'Outsider staff read no collective');
SELECT is((SELECT count(*) FROM venue_collective_members)::int, 0, 'Outsider staff read no member row');
SELECT is((SELECT count(*) FROM collective_service_items)::int, 0, 'Outsider staff read no offering');
SELECT is((SELECT count(*) FROM collective_service_providers)::int, 0, 'Outsider staff read no provider');

-- =============================================================================
-- Anonymous: live offerings and bookable providers of a live public page only.
-- =============================================================================

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

SELECT is(
  (SELECT count(*) FROM collective_service_items)::int,
  1, 'anon reads the active offering, not the archived one');
SELECT is(
  (SELECT count(*) FROM collective_service_providers)::int,
  1, 'anon reads the approved provider, not the pending one');

SELECT * FROM finish();

ROLLBACK;
