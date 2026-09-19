-- Resneo: an offer asks a member that has a same-named service (20270219140000; plan L13).
--
-- Proves: offering a host service creates a replica at a member with no same-named service, and at
-- a member that has one raises the adoption question instead (no link, adoption_requested, N26);
-- offering again while the question is open asks nothing more; "use mine" makes the member's own
-- service the replica; "keep separate" creates a new one; a member whose same-named service is
-- already a replica of something else is not asked.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(12);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000005a0f01', 'Same Host', 'same-host', 'host@same.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000005a0f02', 'Same Member', 'same-member', 'member@same.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000005a0f03', 'Other Member', 'other-member', 'other@same.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000005a0c01', 'same-collective', 'Same Collective',
        '00000000-0000-0000-0000-0000005a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000005a0e01', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f01', 'active'),
  ('00000000-0000-0000-0000-0000005a0e02', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f02', 'active'),
  ('00000000-0000-0000-0000-0000005a0e03', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f03', 'active');
INSERT INTO public.account_links (venue_low_id, venue_high_id, requested_by_venue_id, status,
  low_grants_calendar, low_grants_pii, low_grants_act, high_grants_calendar, high_grants_pii, high_grants_act)
VALUES
  ('00000000-0000-0000-0000-0000005a0f01', '00000000-0000-0000-0000-0000005a0f02', '00000000-0000-0000-0000-0000005a0f01', 'accepted',
   'full_details', true, 'create_edit_cancel', 'full_details', true, 'create_edit_cancel'),
  ('00000000-0000-0000-0000-0000005a0f01', '00000000-0000-0000-0000-0000005a0f03', '00000000-0000-0000-0000-0000005a0f01', 'accepted',
   'full_details', true, 'create_edit_cancel', 'full_details', true, 'create_edit_cancel'),
  ('00000000-0000-0000-0000-0000005a0f02', '00000000-0000-0000-0000-0000005a0f03', '00000000-0000-0000-0000-0000005a0f02', 'accepted',
   'full_details', true, 'create_edit_cancel', 'full_details', true, 'create_edit_cancel');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000005a0501', '00000000-0000-0000-0000-0000005a0f01', 'Cut and Finish', 45, 3500),
  ('00000000-0000-0000-0000-0000005a0502', '00000000-0000-0000-0000-0000005a0f01', 'Colour', 90, 8000),
  ('00000000-0000-0000-0000-0000005a0503', '00000000-0000-0000-0000-0000005a0f02', ' cut and finish ', 40, 3000),
  ('00000000-0000-0000-0000-0000005a0504', '00000000-0000-0000-0000-0000005a0f02', 'Colour', 60, 7000);

-- Cut and Finish: the member has one (spaces and case aside), the other member does not.
CREATE TEMP TABLE offered AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0501',
         '00000000-0000-0000-0000-0000005a0f01', NULL) AS r;

SELECT is(
  (SELECT count(*)::int FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM offered) AND released_at IS NULL),
  1, 'One link is created: the member with no same-named service');
SELECT is(
  (SELECT venue_id FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM offered) AND released_at IS NULL),
  '00000000-0000-0000-0000-0000005a0f03'::uuid, 'and it is the other member''s');
SELECT is(
  public.collective_adoption_pending((SELECT (r->>'item_id')::uuid FROM offered), '00000000-0000-0000-0000-0000005a0f02'),
  '00000000-0000-0000-0000-0000005a0503'::uuid, 'The member with a same-named service is asked about it');
SELECT is(
  (SELECT r->'pending'->0->>'venue_id' FROM offered),
  '00000000-0000-0000-0000-0000005a0f02', 'and the result says which venue is waiting');
SELECT is(
  (SELECT progress->>'notice' FROM public.collective_operations
   WHERE venue_id = '00000000-0000-0000-0000-0000005a0f02' AND kind = 'notice'),
  'N26', 'The member is to be told');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE event_type = 'adoption_requested' AND target_venue_id = '00000000-0000-0000-0000-0000005a0f02'),
  1, 'One question is recorded');

-- Offering again while the question is open changes nothing.
SELECT public.collective_withdraw_service((SELECT (r->>'item_id')::uuid FROM offered), '00000000-0000-0000-0000-0000005a0f01', NULL);
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0501',
         '00000000-0000-0000-0000-0000005a0f01', NULL);
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE event_type = 'adoption_requested' AND target_venue_id = '00000000-0000-0000-0000-0000005a0f02'),
  1, 'Re-offering asks nothing more while the question is open');

-- "Use mine": the member's own service becomes the replica.
SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000005a0c01', (SELECT (r->>'item_id')::uuid FROM offered),
         '00000000-0000-0000-0000-0000005a0f02', 'use_mine', '[]', '00000000-0000-0000-0000-0000005a0f02', NULL);
SELECT is(
  (SELECT replica_service_id || '|' || provenance FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM offered)
     AND venue_id = '00000000-0000-0000-0000-0000005a0f02' AND released_at IS NULL),
  '00000000-0000-0000-0000-0000005a0503|adopted', 'Use mine: the member''s service is the replica');

-- Colour: "keep separate" creates a new replica and leaves the member's own alone.
CREATE TEMP TABLE offered2 AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0502',
         '00000000-0000-0000-0000-0000005a0f01', NULL) AS r;
SELECT is(
  public.collective_adoption_pending((SELECT (r->>'item_id')::uuid FROM offered2), '00000000-0000-0000-0000-0000005a0f02'),
  '00000000-0000-0000-0000-0000005a0504'::uuid, 'Colour asks the member about its own Colour');
SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000005a0c01', (SELECT (r->>'item_id')::uuid FROM offered2),
         '00000000-0000-0000-0000-0000005a0f02', 'keep_separate', '[]', '00000000-0000-0000-0000-0000005a0f02', NULL);
SELECT is(
  (SELECT provenance || '|' || coalesce(replica_service_id::text, 'none') FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM offered2)
     AND venue_id = '00000000-0000-0000-0000-0000005a0f02' AND released_at IS NULL),
  'created|none', 'Keep separate: a new replica, applied later');
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_replicas
   WHERE replica_service_id = '00000000-0000-0000-0000-0000005a0504' AND released_at IS NULL),
  0, 'and the member''s own Colour stays its own');

-- A same-named service that is already a replica of something else is not a match: offering a second
-- host "Cut and Finish" creates a plain replica at the member.
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000005a0505', '00000000-0000-0000-0000-0000005a0f01', 'Cut and Finish', 45, 3500);
CREATE TEMP TABLE offered3 AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0505',
         '00000000-0000-0000-0000-0000005a0f01', NULL) AS r;
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM offered3)
     AND venue_id = '00000000-0000-0000-0000-0000005a0f02' AND released_at IS NULL AND provenance = 'created'),
  1, 'A service that already follows an offering is not offered up again');

SELECT * FROM finish();

ROLLBACK;
