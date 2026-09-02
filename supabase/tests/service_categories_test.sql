-- Resneo: service categories (20270202120000).
--
-- Proves the three things the migration promises:
--   * a venue's staff see and edit only their own categories, and cannot
--     create one for another venue;
--   * anonymous sessions read nothing (the public page goes through the
--     admin client, as it does for services);
--   * deleting a category leaves its services in place, uncategorised, and a
--     name that differs only by case or spacing is refused as a duplicate.
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
  ('00000000-0000-0000-0000-0000000000e1', 'Categories Venue A', 'categories-venue-a',
   'cat-a@rls.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000000000e2', 'Categories Venue B', 'categories-venue-b',
   'cat-b@rls.test', 'appointments', 'active', 'unified_scheduling');

-- `staff_manage_*` matches on `auth.jwt() ->> 'email'`, so the email is the key.
INSERT INTO staff (id, venue_id, email, name, role)
VALUES
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1',
   'cat-admin-a@rls.test', 'Admin A', 'admin'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e2',
   'cat-admin-b@rls.test', 'Admin B', 'admin');

INSERT INTO service_categories (id, venue_id, name, sort_order)
VALUES
  ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e1', 'Hair', 0),
  ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000e2', 'Nails', 0);

INSERT INTO service_items (id, venue_id, name, duration_minutes, category_id)
VALUES
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000e1',
   'Cut', 30, '00000000-0000-0000-0000-0000000000e5');

-- =============================================================================
-- Tests 1-4: venue staff are scoped to their own venue.
-- =============================================================================

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"role":"authenticated","email":"cat-admin-a@rls.test"}';

SELECT is(
  (SELECT count(*) FROM service_categories)::int,
  1, 'Venue A staff SELECT only their own categories');

SELECT is(
  (SELECT name FROM service_categories LIMIT 1),
  'Hair', 'The category venue A staff see is their own');

SELECT throws_ok(
  $$ INSERT INTO service_categories (venue_id, name)
     VALUES ('00000000-0000-0000-0000-0000000000e2', 'Sneaky') $$,
  '42501', NULL,
  'Venue A staff cannot create a category for venue B (WITH CHECK)');

-- RLS refuses the row silently; the assertion is that nothing changed.
UPDATE service_categories SET name = 'Renamed'
WHERE id = '00000000-0000-0000-0000-0000000000e6';

RESET ROLE;
SELECT is(
  (SELECT name FROM service_categories WHERE id = '00000000-0000-0000-0000-0000000000e6'),
  'Nails', 'A cross-venue UPDATE is refused by RLS');

-- =============================================================================
-- Test 5: no anonymous read. The public booking page reads categories through
-- the admin client, exactly as it reads services.
-- =============================================================================

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

SELECT is(
  (SELECT count(*) FROM service_categories)::int,
  0, 'anon cannot read service_categories');

RESET ROLE;

-- =============================================================================
-- Tests 6-8: deleting a category never deletes a service, and duplicate names
-- are refused regardless of case and spacing.
-- =============================================================================

DELETE FROM service_categories WHERE id = '00000000-0000-0000-0000-0000000000e5';

SELECT is(
  (SELECT count(*) FROM service_items WHERE id = '00000000-0000-0000-0000-0000000000e7')::int,
  1, 'Deleting a category leaves its service in place');

SELECT is(
  (SELECT category_id FROM service_items WHERE id = '00000000-0000-0000-0000-0000000000e7'),
  NULL::uuid, 'The orphaned service becomes uncategorised (ON DELETE SET NULL)');

SELECT throws_ok(
  $$ INSERT INTO service_categories (venue_id, name)
     VALUES ('00000000-0000-0000-0000-0000000000e2', '  nails ') $$,
  '23505', NULL,
  'A category name is unique per venue, ignoring case and surrounding space');

SELECT * FROM finish();

ROLLBACK;
