-- Resneo: the host asks to use a member's page address, and the member answers (20270218190000;
-- plan §6.9, N38).
--
-- Proves: only the host asks, and only for an active member's address or its own; its own is
-- adopted at once; a member's waits, is audited and told once; only that venue's answer settles it;
-- agreeing moves the address and "Not now" leaves it; an address another live page uses is refused;
-- and neither function is open to the roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000007b0f01', 'Address Host', 'address-host', 'host@address.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000007b0f02', 'Address Member', 'address-member', 'member@address.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000007b0f03', 'Address Outsider', 'address-outsider', 'out@address.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES
  ('00000000-0000-0000-0000-0000007b0c01', 'address-collective', 'Address Collective',
   '00000000-0000-0000-0000-0000007b0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000007b0e01', '00000000-0000-0000-0000-0000007b0c01', '00000000-0000-0000-0000-0000007b0f01', 'active'),
  ('00000000-0000-0000-0000-0000007b0e02', '00000000-0000-0000-0000-0000007b0c01', '00000000-0000-0000-0000-0000007b0f02', 'active');

SELECT throws_like(
  $$ SELECT public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
       '00000000-0000-0000-0000-0000007b0f02', '00000000-0000-0000-0000-0000007b0f02', NULL) $$,
  'COLLECTIVE_NOT_HOST%', 'Only the host asks');
SELECT throws_like(
  $$ SELECT public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
       '00000000-0000-0000-0000-0000007b0f03', '00000000-0000-0000-0000-0000007b0f01', NULL) $$,
  'COLLECTIVE_VENUE_NOT_MEMBER%', 'and only for a venue in the collective');

-- The host's own address needs nobody's agreement.
SELECT is(
  public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f01', '00000000-0000-0000-0000-0000007b0f01', NULL)->>'status',
  'adopted', 'The host adopts its own address at once');
SELECT is(
  (SELECT slug_strategy || '|' || adopted_venue_id::text FROM public.venue_collectives
   WHERE id = '00000000-0000-0000-0000-0000007b0c01'),
  'adopt_member|00000000-0000-0000-0000-0000007b0f01', 'and the page uses it');

-- A member's address waits for the member.
SELECT is(
  public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f02', '00000000-0000-0000-0000-0000007b0f01', NULL,
    '2026-10-01T10:00:00Z')->>'status',
  'pending', 'A member''s address is asked for');
SELECT is(
  (SELECT adopted_venue_id::text || '|' || pending_adopted_venue_id::text FROM public.venue_collectives
   WHERE id = '00000000-0000-0000-0000-0000007b0c01'),
  '00000000-0000-0000-0000-0000007b0f01|00000000-0000-0000-0000-0000007b0f02',
  'and nothing changes until the member agrees');
SELECT is(
  (SELECT count(*)::int FROM public.collective_operations
   WHERE progress->>'notice' = 'N38' AND venue_id = '00000000-0000-0000-0000-0000007b0f02'),
  1, 'The member is told');
SELECT is(
  public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f02', '00000000-0000-0000-0000-0000007b0f01', NULL,
    '2026-10-01T11:00:00Z')->>'status',
  'pending', 'Asking again');
SELECT is(
  (SELECT count(*)::int FROM public.collective_operations
   WHERE progress->>'notice' = 'N38' AND venue_id = '00000000-0000-0000-0000-0000007b0f02')
  || '|' ||
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-0000007b0c01' AND event_type = 'address_adoption_requested'),
  '1|1', 'tells no one again and records nothing again');

SELECT throws_like(
  $$ SELECT public.collective_answer_address_adoption('00000000-0000-0000-0000-0000007b0c01',
       '00000000-0000-0000-0000-0000007b0f01', true, NULL) $$,
  'COLLECTIVE_ADDRESS_NOT_PENDING%', 'Only the venue asked can answer');

SELECT is(
  public.collective_answer_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f02', false, NULL)->>'status',
  'declined', '"Not now" is an answer');
SELECT is(
  (SELECT adopted_venue_id::text || '|' || coalesce(pending_adopted_venue_id::text, 'none')
   FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000007b0c01')
  || '|' ||
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-0000007b0c01' AND event_type = 'address_adoption_declined'),
  '00000000-0000-0000-0000-0000007b0f01|none|1', 'that leaves the address as it was, and is recorded');

-- Asked again, and agreed.
DO $$ BEGIN
  PERFORM public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f02', '00000000-0000-0000-0000-0000007b0f01', NULL, '2026-10-02T10:00:00Z');
END $$;
SELECT is(
  public.collective_answer_address_adoption('00000000-0000-0000-0000-0000007b0c01',
    '00000000-0000-0000-0000-0000007b0f02', true, NULL)->>'status',
  'adopted', 'The member agrees');
SELECT is(
  (SELECT adopted_venue_id::text || '|' || coalesce(pending_adopted_venue_id::text, 'none')
   FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000007b0c01')
  || '|' ||
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-0000007b0c01' AND event_type = 'address_adopted'
     AND target_venue_id = '00000000-0000-0000-0000-0000007b0f02'),
  '00000000-0000-0000-0000-0000007b0f02|none|1', 'and only then does the page use its address');

-- Another live collective cannot take the same address.
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000007b0c02', 'address-other', 'Address Other',
        '00000000-0000-0000-0000-0000007b0f03', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES ('00000000-0000-0000-0000-0000007b0e03', '00000000-0000-0000-0000-0000007b0c02', '00000000-0000-0000-0000-0000007b0f02', 'active');
SELECT throws_like(
  $$ SELECT public.collective_request_address_adoption('00000000-0000-0000-0000-0000007b0c02',
       '00000000-0000-0000-0000-0000007b0f02', '00000000-0000-0000-0000-0000007b0f03', NULL) $$,
  'COLLECTIVE_ADDRESS_TAKEN%', 'An address another live page uses is refused');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_request_address_adoption(uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_request_address_adoption(uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.collective_answer_address_adoption(uuid, uuid, boolean, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_answer_address_adoption(uuid, uuid, boolean, uuid, timestamptz)', 'EXECUTE'),
  'Neither is open to the roles a browser holds');

SELECT * FROM finish();

ROLLBACK;
