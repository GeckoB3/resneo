-- Resneo: the service catalogue is not anonymously readable or writable (20270214120000; W15, SEC-05).
--
-- Proves:
--   * none of the eight dropped `TO anon` read policies is back;
--   * `anon` reads no calendar assignment, option, add-on or collective membership row, even with
--     rows present;
--   * `anon` holds no write privilege on the seventeen service and collective tables;
--   * a live public combined page's own offerings are still anonymously readable (kept on purpose).
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND 'anon' = ANY (roles)
     AND tablename IN ('calendar_service_assignments', 'practitioner_services', 'appointment_services',
                       'service_variants', 'addon_groups', 'addons', 'service_addon_groups',
                       'venue_collective_members')),
  0, 'No anonymous read policy remains on the catalogue or membership tables');

-- Fixtures, written as the test session.
INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000d0f1', 'Grants Host', 'grants-host', 'host@grants.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000d0f2', 'Grants Member', 'grants-member', 'member@grants.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d0f1', 'Grants chair');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000d051', '00000000-0000-0000-0000-00000000d0f1', 'Cut', 30, 2500);

INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000d0e1', '00000000-0000-0000-0000-00000000d0f1',
        '00000000-0000-0000-0000-00000000d051', 'Long', 45, 4000);

INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id, custom_price_pence)
VALUES ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d051', 2200);

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode)
VALUES ('00000000-0000-0000-0000-00000000d0a1', 'grants-collective', 'Grants Collective',
        '00000000-0000-0000-0000-00000000d0f1', 'active', 'unified_catalog');

INSERT INTO public.venue_collective_members (collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0f1', 'active'),
  ('00000000-0000-0000-0000-00000000d0a1', '00000000-0000-0000-0000-00000000d0f2', 'active');

INSERT INTO public.collective_service_items (id, collective_id, name, status)
VALUES ('00000000-0000-0000-0000-00000000d0b1', '00000000-0000-0000-0000-00000000d0a1', 'Cut', 'active');

SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims TO '{"role":"anon"}';

SELECT is((SELECT count(*)::int FROM public.calendar_service_assignments), 0,
  'anon reads no calendar assignment (custom prices and lengths)');
SELECT is((SELECT count(*)::int FROM public.service_variants), 0, 'anon reads no service option');
SELECT is((SELECT count(*)::int FROM public.venue_collective_members), 0,
  'anon cannot enumerate collective membership');
SELECT is((SELECT count(*)::int FROM public.collective_service_items
           WHERE id = '00000000-0000-0000-0000-00000000d0b1'), 1,
  'anon still reads a live public combined page''s own offering');

SELECT throws_ok(
  $$ INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
     VALUES ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-00000000d051') $$,
  '42501', NULL,
  'anon cannot write a calendar assignment');

RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('service_items', 'service_variants', 'addon_groups', 'addons', 'service_addon_groups',
                       'calendar_service_assignments', 'practitioner_services', 'appointment_services',
                       'service_categories', 'compliance_types', 'compliance_type_versions',
                       'service_compliance_requirements', 'venue_collectives', 'venue_collective_members',
                       'collective_service_items', 'collective_service_providers',
                       'collective_service_categories')
     AND (has_table_privilege('anon', c.oid, 'INSERT') OR has_table_privilege('anon', c.oid, 'UPDATE')
       OR has_table_privilege('anon', c.oid, 'DELETE') OR has_table_privilege('anon', c.oid, 'TRUNCATE'))),
  0, 'anon holds no write privilege on the service and collective tables');

SELECT ok(
  has_table_privilege('authenticated', 'public.calendar_service_assignments', 'INSERT'),
  'authenticated keeps its grant, so the staff RLS policies still decide staff writes');

SELECT * FROM finish();

ROLLBACK;
