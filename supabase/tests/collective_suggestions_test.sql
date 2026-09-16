-- Resneo: a member suggests a parked service (20270218180000; contract 10, N25).
--
-- Proves: only a member suggests, and only its own active service that is not a copy; the host is
-- to be told once per service; and the function is not open to the roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000007a0f01', 'Suggest Host', 'suggest-host', 'host@suggest.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000007a0f02', 'Suggest Member', 'suggest-member', 'member@suggest.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000007a0c01', 'suggest-collective', 'Suggest Collective',
        '00000000-0000-0000-0000-0000007a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000007a0e01', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f01', 'active'),
  ('00000000-0000-0000-0000-0000007a0e02', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f02', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, is_active)
VALUES
  ('00000000-0000-0000-0000-0000007a05a1', '00000000-0000-0000-0000-0000007a0f02', 'Nails', 30, true),
  ('00000000-0000-0000-0000-0000007a05b1', '00000000-0000-0000-0000-0000007a0f01', 'Host cut', 30, true),
  ('00000000-0000-0000-0000-0000007a05c1', '00000000-0000-0000-0000-0000007a0f02', 'Old', 30, false);

SELECT throws_like(
  $$ SELECT public.collective_suggest_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a05b1',
       '00000000-0000-0000-0000-0000007a0f01', NULL) $$,
  'COLLECTIVE_VENUE_NOT_MEMBER%', 'The host does not suggest to itself');
SELECT throws_like(
  $$ SELECT public.collective_suggest_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a05b1',
       '00000000-0000-0000-0000-0000007a0f02', NULL) $$,
  'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE%', 'A member suggests only its own service');
SELECT throws_like(
  $$ SELECT public.collective_suggest_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a05c1',
       '00000000-0000-0000-0000-0000007a0f02', NULL) $$,
  'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE%', 'and only an active one');

SELECT isnt(
  public.collective_suggest_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a05a1',
    '00000000-0000-0000-0000-0000007a0f02', NULL),
  NULL, 'A member suggests its service');
SELECT is(
  (SELECT progress->>'notice' || '|' || venue_id::text FROM public.collective_operations
   WHERE idempotency_key = 'suggest:00000000-0000-0000-0000-0000007a05a1'),
  'N25|00000000-0000-0000-0000-0000007a0f01', 'and the host is to be told');
SELECT is(
  public.collective_suggest_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a05a1',
    '00000000-0000-0000-0000-0000007a0f02', NULL),
  NULL, 'but only once');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_suggest_service(uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_suggest_service(uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'It is not open to the roles a browser holds');

SELECT * FROM finish();

ROLLBACK;
