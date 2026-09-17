-- Resneo: the collective engine's join (20270216150000; plan §6.7, Appendix D, Appendix E contract 6;
-- RT2-20, RT2-27, DL5, DL6, D41).
--
-- Proves, on a replicas-model collective:
--   * without the full account-link mesh the join is refused, and nothing changes;
--   * without consent the join is refused;
--   * a join activates the membership with its consent, creates a link for each offering, adopts the
--     member's own service under "use mine" with its options mapped, and makes the member's form the
--     managed target under "use existing"; the first apply then converges the adopted service in place;
--   * "ask" records a suggestion, and no account link is written;
--   * after a leave, a re-join reconnects a released link whose service is unchanged, and gives a
--     changed one a new link instead (DL5);
--   * a legacy_copies collective is refused.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(16);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000001a0f01', 'Join Host', 'join-host', 'host@join.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000001a0f02', 'Join Member', 'join-member', 'member@join.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES
  ('00000000-0000-0000-0000-0000001a0c01', 'join-collective', 'Join Collective',
   '00000000-0000-0000-0000-0000001a0f01', 'active', 'unified_catalog', 'replicas'),
  ('00000000-0000-0000-0000-0000001a0c02', 'join-legacy', 'Join Legacy',
   '00000000-0000-0000-0000-0000001a0f01', 'active', 'unified_catalog', 'legacy_copies');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000001a0e01', '00000000-0000-0000-0000-0000001a0c01', '00000000-0000-0000-0000-0000001a0f01', 'active'),
  ('00000000-0000-0000-0000-0000001a0e02', '00000000-0000-0000-0000-0000001a0c01', '00000000-0000-0000-0000-0000001a0f02', 'invited'),
  ('00000000-0000-0000-0000-0000001a0e09', '00000000-0000-0000-0000-0000001a0c02', '00000000-0000-0000-0000-0000001a0f02', 'invited');

-- Host masters A (plain) and B (with an option), and a form. Member: its own Brow tint with an
-- option, a same-template form, and a service it will ask about.
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000001a05a1', '00000000-0000-0000-0000-0000001a0f01', 'Facial', 60, 6000),
  ('00000000-0000-0000-0000-0000001a05b1', '00000000-0000-0000-0000-0000001a0f01', 'Brow tint', 20, 1500),
  ('00000000-0000-0000-0000-0000001a05b2', '00000000-0000-0000-0000-0000001a0f02', 'Brow tint', 15, 1200),
  ('00000000-0000-0000-0000-0000001a05c2', '00000000-0000-0000-0000-0000001a0f02', 'Hot stones', 45, 4000);
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000001a0b01', '00000000-0000-0000-0000-0000001a0f01', '00000000-0000-0000-0000-0000001a05b1', 'With shape', 30, 2000),
  ('00000000-0000-0000-0000-0000001a0b02', '00000000-0000-0000-0000-0000001a0f02', '00000000-0000-0000-0000-0000001a05b2', 'Plus shape', 25, 1800);
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods, library_template_slug)
VALUES
  ('00000000-0000-0000-0000-0000001a0a01', '00000000-0000-0000-0000-0000001a0f01', 'Patch test', 'patch-test', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test'),
  ('00000000-0000-0000-0000-0000001a0a02', '00000000-0000-0000-0000-0000001a0f02', 'Our patch test', 'our-patch', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test');

CREATE TEMP TABLE offers AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000001a0c01', s, '00000000-0000-0000-0000-0000001a0f01', NULL) AS r
FROM unnest(ARRAY['00000000-0000-0000-0000-0000001a05a1', '00000000-0000-0000-0000-0000001a05b1']::uuid[]) s;
CREATE TEMP TABLE items AS
SELECT (SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000001a05a1') AS a,
       (SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000001a05b1') AS b;

CREATE TEMP TABLE choices AS
SELECT jsonb_build_object(
  'same_name_choices', jsonb_build_array(jsonb_build_object(
    'item_id', (SELECT b FROM items), 'choice', 'use_mine', 'my_service_id', '00000000-0000-0000-0000-0000001a05b2',
    'option_map', jsonb_build_array(jsonb_build_object('my_variant_id', '00000000-0000-0000-0000-0000001a0b02',
                                                       'host_variant_id', '00000000-0000-0000-0000-0000001a0b01')))),
  'own_service_choices', jsonb_build_array(jsonb_build_object('service_id', '00000000-0000-0000-0000-0000001a05c2', 'choice', 'ask')),
  'form_choices', jsonb_build_array(jsonb_build_object('host_type_id', '00000000-0000-0000-0000-0000001a0a01', 'choice', 'use_existing',
                                                       'my_type_id', '00000000-0000-0000-0000-0000001a0a02'))
) AS c;

-- No account link yet.
SELECT throws_ok(
  $$ SELECT public.collective_join_member('00000000-0000-0000-0000-0000001a0e02', 'v1', '{}'::jsonb, '00000000-0000-0000-0000-0000001a0f02', NULL) $$,
  'P0001', NULL, 'DL6: a venue without the full account-link mesh cannot join');
SELECT is(
  (SELECT status FROM public.venue_collective_members WHERE id = '00000000-0000-0000-0000-0000001a0e02'),
  'invited', 'and stays invited');

INSERT INTO public.account_links (venue_low_id, venue_high_id, requested_by_venue_id, status,
  low_grants_calendar, low_grants_pii, low_grants_act, high_grants_calendar, high_grants_pii, high_grants_act)
VALUES ('00000000-0000-0000-0000-0000001a0f01', '00000000-0000-0000-0000-0000001a0f02', '00000000-0000-0000-0000-0000001a0f01', 'accepted',
  'full_details', true, 'create_edit_cancel', 'full_details', true, 'create_edit_cancel');
CREATE TEMP TABLE link_count AS SELECT count(*) AS n FROM public.account_links;

SELECT throws_ok(
  $$ SELECT public.collective_join_member('00000000-0000-0000-0000-0000001a0e02', NULL, '{}'::jsonb, '00000000-0000-0000-0000-0000001a0f02', NULL) $$,
  'P0001', NULL, 'RT2-8: a join without consent is refused');

CREATE TEMP TABLE joined AS
SELECT public.collective_join_member('00000000-0000-0000-0000-0000001a0e02', 'v1', (SELECT c FROM choices),
  '00000000-0000-0000-0000-0000001a0f02', NULL) AS r;

SELECT is(
  (SELECT array[status, consent_version, (joined_at IS NOT NULL)::text] FROM public.venue_collective_members WHERE id = '00000000-0000-0000-0000-0000001a0e02'),
  array['active', 'v1', 'true'], 'The membership is active with its consent recorded');

SELECT is(
  (SELECT array_agg(x->>'provenance' ORDER BY x->>'provenance') FROM joined, jsonb_array_elements(r->'links') x),
  array['adopted', 'created'], 'One link per offering: the member''s own service adopted, the other created');

SELECT is(
  (SELECT replica_service_id FROM public.collective_service_replicas WHERE collective_service_item_id = (SELECT b FROM items) AND released_at IS NULL),
  '00000000-0000-0000-0000-0000001a05b2'::uuid, '"Use mine": the member''s service is the replica');
SELECT is(
  (SELECT replica_of_variant_id FROM public.service_variants WHERE id = '00000000-0000-0000-0000-0000001a0b02'),
  '00000000-0000-0000-0000-0000001a0b01'::uuid, 'and its option is mapped to the host''s');

SELECT is(
  (SELECT array[managed_by_collective_id::text, replica_of_compliance_type_id::text, accepts_records_from_type_id::text]
   FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000001a0a02'),
  array['00000000-0000-0000-0000-0000001a0c01', '00000000-0000-0000-0000-0000001a0a01', '00000000-0000-0000-0000-0000001a0a02'],
  '"Use existing": the member''s form becomes the managed target and its records keep counting');

SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000001a0c01' AND event_type = 'member_joined'),
                (SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000001a0c01' AND event_type = 'adoption_answered'),
                (SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000001a0c01' AND event_type = 'suggestion_made'),
                (SELECT count(*) FROM public.collective_operations WHERE idempotency_key = 'join:00000000-0000-0000-0000-0000001a0e02')]::int[]),
  array[1, 2, 1, 1], 'Audited: joined, two adoptions, one suggestion; one join job');
SELECT is((SELECT count(*) FROM public.account_links), (SELECT n FROM link_count), 'D41: no account link is written');

-- The first apply converges the adopted service in place.
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline')
FROM public.collective_service_replicas WHERE member_id = '00000000-0000-0000-0000-0000001a0e02' ORDER BY id;
SELECT is(
  (SELECT array[name, price_pence::text, duration_minutes::text] FROM public.service_items WHERE id = '00000000-0000-0000-0000-0000001a05b2'),
  array['Brow tint', '1500', '20'], 'The adopted service takes the host''s terms, keeping its id');
SELECT is(
  (SELECT array[id::text, price_pence::text] FROM public.service_variants WHERE replica_of_variant_id = '00000000-0000-0000-0000-0000001a0b01'),
  array['00000000-0000-0000-0000-0000001a0b02', '2000'], 'and its mapped option is updated in place');

-- Leave, then re-join. Simulate time: A's service unchanged since its release, B's changed after it.
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-0000001a0e02';
CREATE TEMP TABLE released AS
SELECT collective_service_item_id AS item, id, replica_service_id FROM public.collective_service_replicas
WHERE member_id = '00000000-0000-0000-0000-0000001a0e02';
SELECT set_config('resneo.collective_engine', 'on', true);
UPDATE public.collective_service_replicas SET released_at = now() + interval '1 minute' WHERE id = (SELECT id FROM released WHERE item = (SELECT a FROM items));
UPDATE public.collective_service_replicas SET released_at = now() - interval '1 minute' WHERE id = (SELECT id FROM released WHERE item = (SELECT b FROM items));
SELECT set_config('resneo.collective_engine', '', true);

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES ('00000000-0000-0000-0000-0000001a0e03', '00000000-0000-0000-0000-0000001a0c01', '00000000-0000-0000-0000-0000001a0f02', 'invited');
CREATE TEMP TABLE rejoined AS
SELECT public.collective_join_member('00000000-0000-0000-0000-0000001a0e03', 'v1', '{}'::jsonb, '00000000-0000-0000-0000-0000001a0f02', NULL) AS r;

SELECT is(
  (SELECT array[provenance, member_id::text, (released_at IS NULL)::text] FROM public.collective_service_replicas
   WHERE id = (SELECT id FROM released WHERE item = (SELECT a FROM items))),
  array['reconnected', '00000000-0000-0000-0000-0000001a0e03', 'true'],
  'RT2-27: an unchanged released service is reconnected');
SELECT is(
  (SELECT array[provenance, coalesce(replica_service_id::text, 'none')] FROM public.collective_service_replicas
   WHERE collective_service_item_id = (SELECT b FROM items) AND released_at IS NULL),
  array['created', 'none'], 'DL5: a service changed since its release gets a new link instead');
SELECT ok(
  (SELECT released_at IS NOT NULL FROM public.collective_service_replicas WHERE id = (SELECT id FROM released WHERE item = (SELECT b FROM items))),
  'and the changed service''s old link stays released');

SELECT throws_ok(
  $$ SELECT public.collective_join_member('00000000-0000-0000-0000-0000001a0e09', 'v1', '{}'::jsonb, NULL, NULL) $$,
  'P0001', NULL, 'A legacy collective is refused');

SELECT * FROM finish();

ROLLBACK;
