-- Resneo: the legacy service sync columns are server-maintained (20270214130000; plan §8.2 item 4).
--
-- Proves:
--   * a service cannot follow itself;
--   * the server (no client claim) can link a copy to its origin and unlink it;
--   * a client request cannot point a copy at a service, change its state, or insert a linked row,
--     while an ordinary client edit of the same row still lands.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-00000000e5f1', 'Sync Guard Venue', 'sync-guard-venue',
        'venue@syncguard.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes)
VALUES
  ('00000000-0000-0000-0000-00000000e501', '00000000-0000-0000-0000-00000000e5f1', 'Origin', 30),
  ('00000000-0000-0000-0000-00000000e502', '00000000-0000-0000-0000-00000000e5f1', 'Copy', 30);

SELECT throws_ok(
  $$ UPDATE public.service_items SET synced_from_service_id = id
     WHERE id = '00000000-0000-0000-0000-00000000e502' $$,
  '23514', NULL,
  'A service cannot follow itself');

UPDATE public.service_items
SET synced_from_service_id = '00000000-0000-0000-0000-00000000e501', sync_state = 'linked', synced_at = now()
WHERE id = '00000000-0000-0000-0000-00000000e502';
SELECT is(
  (SELECT sync_state FROM public.service_items WHERE id = '00000000-0000-0000-0000-00000000e502'),
  'linked', 'The server links a copy to its origin');

-- A signed-in client request (the test session bypasses RLS; the trigger reads the claim).
SELECT set_config('request.jwt.claims', '{"role":"authenticated","email":"staff@syncguard.test"}', true);

SELECT throws_ok(
  $$ UPDATE public.service_items SET synced_from_service_id = NULL, sync_state = 'independent'
     WHERE id = '00000000-0000-0000-0000-00000000e502' $$,
  '42501', NULL,
  'A client cannot change what a copy follows');

SELECT throws_ok(
  $$ INSERT INTO public.service_items (venue_id, name, duration_minutes, synced_from_service_id, sync_state)
     VALUES ('00000000-0000-0000-0000-00000000e5f1', 'Sneaky', 30,
             '00000000-0000-0000-0000-00000000e501', 'linked') $$,
  '42501', NULL,
  'A client cannot insert a linked copy');

UPDATE public.service_items SET name = 'Copy (renamed)' WHERE id = '00000000-0000-0000-0000-00000000e502';
SELECT is(
  (SELECT name FROM public.service_items WHERE id = '00000000-0000-0000-0000-00000000e502'),
  'Copy (renamed)', 'An ordinary client edit of the same row still lands');

SELECT set_config('request.jwt.claims', '', true);
UPDATE public.service_items SET synced_from_service_id = NULL, sync_state = 'independent', synced_at = NULL
WHERE id = '00000000-0000-0000-0000-00000000e502';
SELECT is(
  (SELECT sync_state FROM public.service_items WHERE id = '00000000-0000-0000-0000-00000000e502'),
  'independent', 'The server can unlink it again');

SELECT * FROM finish();

ROLLBACK;
