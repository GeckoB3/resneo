-- Resneo: combined-page service categories (20270202130000).
--
-- Proves:
--   * host and member staff can read a combined page's headings; an outside
--     venue's staff cannot;
--   * anonymous sessions read headings only for a live unified_catalog page;
--   * deleting a heading leaves its offerings in place, uncategorised;
--   * a heading name is unique per page, ignoring case and spacing.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- =============================================================================
-- Fixtures, seeded as the (superuser) session role, which bypasses RLS.
-- =============================================================================

INSERT INTO venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000000000f1', 'Host Venue', 'cat-host-venue',
   'cat-host@rls.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000000000f2', 'Member Venue', 'cat-member-venue',
   'cat-member@rls.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000000000f3', 'Outside Venue', 'cat-outside-venue',
   'cat-outside@rls.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO staff (id, venue_id, email, name, role)
VALUES
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f1',
   'cat-host-admin@rls.test', 'Host Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f2',
   'cat-member-admin@rls.test', 'Member Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f3',
   'cat-outside-admin@rls.test', 'Outside Admin', 'admin');

INSERT INTO venue_collectives (id, slug, name, host_venue_id, status, page_mode)
VALUES ('00000000-0000-0000-0000-0000000000f7', 'cat-combined', 'Combined Page',
        '00000000-0000-0000-0000-0000000000f1', 'active', 'unified_catalog');

INSERT INTO venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f7',
   '00000000-0000-0000-0000-0000000000f1', 'active'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000f7',
   '00000000-0000-0000-0000-0000000000f2', 'active');

INSERT INTO collective_service_categories (id, collective_id, name, sort_order)
VALUES
  ('00000000-0000-0000-0000-0000000000fa', '00000000-0000-0000-0000-0000000000f7', 'Hair', 0),
  ('00000000-0000-0000-0000-0000000000fb', '00000000-0000-0000-0000-0000000000f7', 'Nails', 1);

INSERT INTO collective_service_items (id, collective_id, name, status, category_id)
VALUES ('00000000-0000-0000-0000-0000000000fc', '00000000-0000-0000-0000-0000000000f7',
        'Cut', 'active', '00000000-0000-0000-0000-0000000000fa');

-- =============================================================================
-- Tests 1-3: who may read.
-- =============================================================================

SET LOCAL ROLE authenticated;

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"cat-host-admin@rls.test"}';
SELECT is(
  (SELECT count(*) FROM collective_service_categories)::int,
  2, 'Host venue staff read the combined page headings');

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"cat-member-admin@rls.test"}';
SELECT is(
  (SELECT count(*) FROM collective_service_categories)::int,
  2, 'Member venue staff read the combined page headings');

SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"cat-outside-admin@rls.test"}';
SELECT is(
  (SELECT count(*) FROM collective_service_categories)::int,
  0, 'Staff of a venue outside the collective read nothing');

-- =============================================================================
-- Tests 4-5: anonymous reads follow the page's public state.
-- =============================================================================

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SELECT is(
  (SELECT count(*) FROM collective_service_categories)::int,
  2, 'anon reads headings of a live unified_catalog page');

RESET ROLE;
UPDATE venue_collectives SET page_mode = 'directory'
WHERE id = '00000000-0000-0000-0000-0000000000f7';

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';
SELECT is(
  (SELECT count(*) FROM collective_service_categories)::int,
  0, 'anon reads nothing once the page is not a unified catalog');

RESET ROLE;

-- =============================================================================
-- Tests 6-8: delete keeps offerings; duplicate names are refused.
-- =============================================================================

DELETE FROM collective_service_categories WHERE id = '00000000-0000-0000-0000-0000000000fa';

SELECT is(
  (SELECT count(*) FROM collective_service_items WHERE id = '00000000-0000-0000-0000-0000000000fc')::int,
  1, 'Deleting a heading leaves its offering in place');

SELECT is(
  (SELECT category_id FROM collective_service_items WHERE id = '00000000-0000-0000-0000-0000000000fc'),
  NULL::uuid, 'The orphaned offering becomes uncategorised (ON DELETE SET NULL)');

SELECT throws_ok(
  $$ INSERT INTO collective_service_categories (collective_id, name)
     VALUES ('00000000-0000-0000-0000-0000000000f7', '  NAILS ') $$,
  '23505', NULL,
  'A heading name is unique per combined page, ignoring case and surrounding space');

SELECT * FROM finish();

ROLLBACK;
