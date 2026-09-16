-- Resneo: a member's subscription lapses and comes back (20270218130000; N36, N37, N23).
--
-- Proves: a member's suspension is set once, audited and told; setting it again changes nothing;
-- resuming clears it and is told; the host lapsing pauses the page and coming back un-pauses it,
-- leaving a pause it did not set alone.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(11);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-000000dd0f01', 'Lapse Host', 'lapse-host', 'h@lapse.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-000000dd0f02', 'Lapse Member', 'lapse-member', 'm@lapse.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-000000dd0c01', 'lapse-collective', 'Lapse', '00000000-0000-0000-0000-000000dd0f01',
        'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-000000dd0e01', '00000000-0000-0000-0000-000000dd0c01', '00000000-0000-0000-0000-000000dd0f01', 'active'),
  ('00000000-0000-0000-0000-000000dd0e02', '00000000-0000-0000-0000-000000dd0c01', '00000000-0000-0000-0000-000000dd0f02', 'active');

-- A member lapses.
SELECT is(
  (public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e02', true) ->> 'changed')::boolean,
  true, 'A member whose subscription lapsed is suspended');
SELECT ok(
  (SELECT suspended_at IS NOT NULL FROM public.venue_collective_members WHERE id = '00000000-0000-0000-0000-000000dd0e02'),
  'and the flag is set');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-000000dd0c01' AND event_type = 'member_suspended'),
  1, 'and it is audited');
SELECT is(
  (SELECT progress ->> 'notice' FROM public.collective_operations WHERE idempotency_key LIKE 'suspended:%'),
  'N36', 'and the member is told');
SELECT is(
  (public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e02', true) ->> 'changed')::boolean,
  false, 'Suspending it again changes nothing');

-- The member comes back.
SELECT is(
  (public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e02', false) ->> 'changed')::boolean,
  true, 'A member whose subscription resumed is un-suspended');
SELECT is(
  (SELECT progress ->> 'notice' FROM public.collective_operations WHERE idempotency_key LIKE 'resumed:%'),
  'N37', 'and told its calendars are back');

-- The host lapses: the page pauses, and the others hear why.
SELECT public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e01', true);
SELECT is(
  (SELECT paused_reason FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-000000dd0c01'),
  'host_lapsed', 'The host lapsing pauses the page');
SELECT is(
  (SELECT progress ->> 'notice' FROM public.collective_operations WHERE idempotency_key LIKE 'host-lapsed:%'),
  'N23', 'and every other venue is told');

-- The host comes back: the pause it caused is lifted.
SELECT public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e01', false);
SELECT ok(
  (SELECT paused_at IS NULL AND paused_reason IS NULL FROM public.venue_collectives
   WHERE id = '00000000-0000-0000-0000-000000dd0c01'),
  'The host coming back lifts the pause');

-- A pause the host's lapse did not cause is left alone when the host comes back.
SELECT public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e01', true);
UPDATE public.venue_collectives SET paused_reason = 'host_left' WHERE id = '00000000-0000-0000-0000-000000dd0c01';
SELECT public.collective_set_member_suspended('00000000-0000-0000-0000-000000dd0e01', false);
SELECT is(
  (SELECT paused_reason FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-000000dd0c01'),
  'host_left', 'and leaves a pause it did not cause');

SELECT * FROM finish();

ROLLBACK;
