-- Resneo: asking a member to host, and its answer (20270218120000; plan §6.7; N20, N21).
--
-- Proves: only the host may ask, only an active member may be asked, a second request while one is
-- pending is refused, a request is refused while a venue is behind, the candidate's acceptance sets
-- the day 14 days on and needs its consent, and each step is audited and queues its notice.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-000000cc0f01', 'Move Host', 'move-host', 'h@move.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-000000cc0f02', 'Move Member', 'move-member', 'm@move.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-000000cc0f03', 'Move Stranger', 'move-stranger', 's@move.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-000000cc0c01', 'move-collective', 'Move', '00000000-0000-0000-0000-000000cc0f01',
        'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-000000cc0e01', '00000000-0000-0000-0000-000000cc0c01', '00000000-0000-0000-0000-000000cc0f01', 'active'),
  ('00000000-0000-0000-0000-000000cc0e02', '00000000-0000-0000-0000-000000cc0c01', '00000000-0000-0000-0000-000000cc0f02', 'active');

-- Only the host asks.
SELECT throws_like(
  $$SELECT public.collective_request_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f02', '00000000-0000-0000-0000-000000cc0f02', NULL)$$,
  'COLLECTIVE_NOT_HOST%', 'Only the host may ask another venue to host');

-- Only an active member can be asked.
SELECT throws_like(
  $$SELECT public.collective_request_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f03', '00000000-0000-0000-0000-000000cc0f01', NULL)$$,
  'COLLECTIVE_VENUE_NOT_MEMBER%', 'A venue outside the collective cannot be asked');

SELECT is(
  (public.collective_request_host_transfer('00000000-0000-0000-0000-000000cc0c01',
     '00000000-0000-0000-0000-000000cc0f02', '00000000-0000-0000-0000-000000cc0f01', NULL)
   ->> 'pending_host_venue_id'),
  '00000000-0000-0000-0000-000000cc0f02', 'The host asks a member');

SELECT is(
  (SELECT array[pending_host_venue_id::text, coalesce(host_transfer_at::text, 'none')]
   FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-000000cc0c01'),
  array['00000000-0000-0000-0000-000000cc0f02', 'none'],
  'which leaves it asked, not yet scheduled');

SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-000000cc0c01' AND event_type = 'host_transfer_requested'),
  1, 'The request is audited');

SELECT is(
  (SELECT progress ->> 'notice' FROM public.collective_operations
   WHERE collective_id = '00000000-0000-0000-0000-000000cc0c01' AND idempotency_key LIKE 'host-request:%'),
  'N20', 'and the candidate is told');

SELECT throws_like(
  $$SELECT public.collective_request_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f02', '00000000-0000-0000-0000-000000cc0f01', NULL)$$,
  'COLLECTIVE_TRANSFER_PENDING%', 'A second request is refused while one is pending');

-- The answer.
SELECT throws_like(
  $$SELECT public.collective_accept_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f02', NULL, '')$$,
  'COLLECTIVE_CONSENT_REQUIRED%', 'Accepting needs the consent the venue was shown');

SELECT throws_like(
  $$SELECT public.collective_accept_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f03', NULL, 'host-transfer-2026-09')$$,
  'COLLECTIVE_NOT_HOST%', 'Only the venue that was asked can accept');

SELECT is(
  (public.collective_accept_host_transfer('00000000-0000-0000-0000-000000cc0c01',
     '00000000-0000-0000-0000-000000cc0f02', NULL, 'host-transfer-2026-09', '2026-10-01 09:00+00')
   ->> 'host_transfer_at')::timestamptz,
  '2026-10-15 09:00+00'::timestamptz, 'Hosting moves 14 days after the candidate accepts');

SELECT is(
  (SELECT progress ->> 'notice' FROM public.collective_operations
   WHERE collective_id = '00000000-0000-0000-0000-000000cc0c01' AND idempotency_key LIKE 'host-accept:%'),
  'N21', 'and every venue is told');

-- Behind venues block a new request. Clear the pending move first, then make a link behind.
UPDATE public.venue_collectives SET pending_host_venue_id = NULL, host_transfer_at = NULL
WHERE id = '00000000-0000-0000-0000-000000cc0c01';
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-000000cc0501', '00000000-0000-0000-0000-000000cc0f01', 'Move Facial', 60, 6000);
SELECT public.collective_offer_service('00000000-0000-0000-0000-000000cc0c01', '00000000-0000-0000-0000-000000cc0501',
  '00000000-0000-0000-0000-000000cc0f01', NULL);
SELECT throws_like(
  $$SELECT public.collective_request_host_transfer('00000000-0000-0000-0000-000000cc0c01',
      '00000000-0000-0000-0000-000000cc0f02', '00000000-0000-0000-0000-000000cc0f01', NULL)$$,
  'COLLECTIVE_LINKS_BEHIND%', 'No request while a venue is still updating');

SELECT * FROM finish();

ROLLBACK;
