-- Resneo: host-initiated adoption (20270218150000; plan §6.7 "Add from another venue"; OFF-06).
--
-- Proves: adding a member's service copies it to a new host master with its options, offers it,
-- holds the member's own link back and records the request; "use mine" makes the member's service
-- the replica with its options mapped; "keep mine separate" creates a new replica and leaves the
-- member's service its own; only the member (or the system) answers, and only once; a second
-- request for the same service is refused while one waits; and the apply converges the answer.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(17);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000004a0f01', 'Adopt Host', 'adopt-host', 'host@adopt.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000004a0f02', 'Adopt Member', 'adopt-member', 'member@adopt.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000004a0c01', 'adopt-collective', 'Adopt Collective',
        '00000000-0000-0000-0000-0000004a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000004a0e01', '00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f01', 'active'),
  ('00000000-0000-0000-0000-0000004a0e02', '00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, capacity_per_session)
VALUES
  ('00000000-0000-0000-0000-0000004a05a1', '00000000-0000-0000-0000-0000004a0f02', 'Balayage', 90, 12000, 1),
  ('00000000-0000-0000-0000-0000004a05b1', '00000000-0000-0000-0000-0000004a0f02', 'Gloss', 30, 4000, 1);
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence, sort_order, is_active)
VALUES
  ('00000000-0000-0000-0000-0000004a0da1', '00000000-0000-0000-0000-0000004a0f02', '00000000-0000-0000-0000-0000004a05a1', 'Short', 60, 9000, 1, true),
  ('00000000-0000-0000-0000-0000004a0da2', '00000000-0000-0000-0000-0000004a0f02', '00000000-0000-0000-0000-0000004a05a1', 'Long', 120, 15000, 2, true),
  ('00000000-0000-0000-0000-0000004a0da3', '00000000-0000-0000-0000-0000004a0f02', '00000000-0000-0000-0000-0000004a05a1', 'Old', 45, 5000, 3, false);

-- Only the host may add, and only a member's own service.
SELECT throws_like(
  $$ SELECT public.collective_add_from_venue('00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02',
       '00000000-0000-0000-0000-0000004a05a1', '00000000-0000-0000-0000-0000004a0f02', NULL) $$,
  'COLLECTIVE_NOT_HOST%', 'Only the host adds a service from another venue');

CREATE TEMP TABLE added AS
SELECT public.collective_add_from_venue('00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02',
         '00000000-0000-0000-0000-0000004a05a1', '00000000-0000-0000-0000-0000004a0f01', NULL) AS r;

SELECT is(
  (SELECT name || '|' || price_pence || '|' || venue_id::text FROM public.service_items
   WHERE id = (SELECT (r->>'master_service_id')::uuid FROM added)),
  'Balayage|12000|00000000-0000-0000-0000-0000004a0f01',
  'The member''s service is copied to a new service at the host');
SELECT is(
  (SELECT string_agg(name, ',' ORDER BY sort_order) FROM public.service_variants
   WHERE service_item_id = (SELECT (r->>'master_service_id')::uuid FROM added)),
  'Short,Long', 'with its active options');
SELECT is(
  (SELECT status FROM public.collective_service_items WHERE id = (SELECT (r->>'item_id')::uuid FROM added)),
  'active', 'and offered');
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM added) AND released_at IS NULL),
  0, 'The member''s link waits for its answer');
SELECT is(
  public.collective_adoption_pending((SELECT (r->>'item_id')::uuid FROM added), '00000000-0000-0000-0000-0000004a0f02'),
  '00000000-0000-0000-0000-0000004a05a1'::uuid, 'and the request is pending');
SELECT is(
  (SELECT progress->>'notice' FROM public.collective_operations
   WHERE venue_id = '00000000-0000-0000-0000-0000004a0f02' AND kind = 'notice'),
  'N26', 'The member is to be told');
SELECT throws_like(
  $$ SELECT public.collective_add_from_venue('00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02',
       '00000000-0000-0000-0000-0000004a05a1', '00000000-0000-0000-0000-0000004a0f01', NULL) $$,
  'COLLECTIVE_ADOPTION_PENDING%', 'The same service cannot be asked for twice while it waits');

-- Only the member answers.
SELECT throws_like(
  format($$ SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000004a0c01', %L,
       '00000000-0000-0000-0000-0000004a0f02', 'keep_separate', '[]', '00000000-0000-0000-0000-0000004a0f01', NULL) $$,
    (SELECT r->>'item_id' FROM added)),
  'COLLECTIVE_VENUE_NOT_MEMBER%', 'The host cannot answer for the member');

-- "Use mine": the member's service becomes the replica, options mapped.
SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000004a0c01', (SELECT (r->>'item_id')::uuid FROM added),
  '00000000-0000-0000-0000-0000004a0f02', 'use_mine',
  jsonb_build_array(jsonb_build_object('my_variant_id', '00000000-0000-0000-0000-0000004a0da1',
    'host_variant_id', (SELECT id FROM public.service_variants
                        WHERE service_item_id = (SELECT (r->>'master_service_id')::uuid FROM added) AND name = 'Short'))),
  '00000000-0000-0000-0000-0000004a0f02', NULL);

SELECT is(
  (SELECT replica_service_id::text || '|' || provenance FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM added) AND released_at IS NULL),
  '00000000-0000-0000-0000-0000004a05a1|adopted', 'Use mine makes the member''s service the replica');
SELECT isnt(
  (SELECT replica_of_variant_id FROM public.service_variants WHERE id = '00000000-0000-0000-0000-0000004a0da1'),
  NULL, 'with its option mapped');
SELECT is(
  public.collective_adoption_pending((SELECT (r->>'item_id')::uuid FROM added), '00000000-0000-0000-0000-0000004a0f02'),
  NULL, 'and the request is settled');
SELECT throws_like(
  format($$ SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000004a0c01', %L,
       '00000000-0000-0000-0000-0000004a0f02', 'keep_separate', '[]', NULL, NULL) $$,
    (SELECT r->>'item_id' FROM added)),
  'COLLECTIVE_ADOPTION_NOT_PENDING%', 'A settled request cannot be answered again');

SELECT is(
  (public.collective_apply_replica((SELECT id FROM public.collective_service_replicas
     WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM added) AND released_at IS NULL),
     NULL, NULL, 'inline'))->>'ok',
  'true', 'The apply converges the adopted service');

-- "Keep mine separate", answered by the system's default.
CREATE TEMP TABLE added2 AS
SELECT public.collective_add_from_venue('00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02',
         '00000000-0000-0000-0000-0000004a05b1', '00000000-0000-0000-0000-0000004a0f01', NULL) AS r;
SELECT public.collective_answer_adoption('00000000-0000-0000-0000-0000004a0c01', (SELECT (r->>'item_id')::uuid FROM added2),
  '00000000-0000-0000-0000-0000004a0f02', 'keep_separate', NULL, NULL, NULL);

SELECT is(
  (SELECT coalesce(replica_service_id::text, 'none') || '|' || provenance FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT (r->>'item_id')::uuid FROM added2) AND released_at IS NULL),
  'none|created', 'Keep mine separate creates a new replica');
SELECT is(
  (SELECT system_job || '|' || (changes->'after'->>'default') FROM public.collective_audit_events
   WHERE item_id = (SELECT (r->>'item_id')::uuid FROM added2) AND event_type = 'adoption_answered'),
  'collective-adoption-default|true', 'and the system''s default is audited as such');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_answer_adoption(uuid, uuid, uuid, text, jsonb, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_add_from_venue(uuid, uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'Neither is open to the roles a browser holds');

SELECT * FROM finish();

ROLLBACK;
