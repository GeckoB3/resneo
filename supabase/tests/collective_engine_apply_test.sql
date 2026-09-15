-- Resneo: the collective engine's apply, offer and withdraw (20270215130000; plan §6.4, Appendix D;
-- tests ENG-01, ENG-07, REV-01 in part).
--
-- Proves, on a replicas-model collective:
--   * offering a host service creates one link per active member and forces the D29 flags off;
--   * the first apply creates the member's service with host columns, the heading and the options,
--     and the fingerprints then agree;
--   * a second apply writes nothing and audits nothing (idempotent);
--   * a host price change bumps the link, and the next apply converges it;
--   * a sort_order-only change does not bump;
--   * a member's own edit to a venue column is not drift;
--   * deleting a master option deactivates the member's copy and keeps it;
--   * withdrawing the offering retires the member's service;
--   * the claim leases due links once;
--   * an apply for a membership that has ended writes nothing;
--   * client roles cannot call the engine.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(19);

-- Host H, member M, a replicas-model collective, M's membership.
INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000a0f1', 'Apply Host', 'apply-host', 'host@apply.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000a0f2', 'Apply Member', 'apply-member', 'member@apply.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-00000000a0c1', 'apply-collective', 'Apply Collective',
        '00000000-0000-0000-0000-00000000a0f1', 'active', 'unified_catalog', 'replicas');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000a0e1', '00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-00000000a0f1', 'active'),
  ('00000000-0000-0000-0000-00000000a0e2', '00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-00000000a0f2', 'active');

-- The master: a heading, a service allowing staff names, two options.
INSERT INTO public.service_categories (id, venue_id, name, sort_order)
VALUES ('00000000-0000-0000-0000-00000000a0a1', '00000000-0000-0000-0000-00000000a0f1', 'Hair', 1);

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, category_id,
  staff_may_customize_name, staff_may_customize_description, capacity_per_session, sort_order)
VALUES ('00000000-0000-0000-0000-00000000a051', '00000000-0000-0000-0000-00000000a0f1', 'Cut', 30, 2500,
        '00000000-0000-0000-0000-00000000a0a1', true, true, 3, 7);

INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-00000000a0b1', '00000000-0000-0000-0000-00000000a0f1', '00000000-0000-0000-0000-00000000a051', 'Short', 30, 2500),
  ('00000000-0000-0000-0000-00000000a0b2', '00000000-0000-0000-0000-00000000a0f1', '00000000-0000-0000-0000-00000000a051', 'Long', 60, 4000);

-- Offer.
CREATE TEMP TABLE offered AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-00000000a051',
  '00000000-0000-0000-0000-00000000a0f1', NULL) AS r;
CREATE TEMP TABLE link AS
SELECT (r->'links'->0->>'link_id')::uuid AS id, (r->>'item_id')::uuid AS item_id FROM offered;

SELECT is(jsonb_array_length((SELECT r->'links' FROM offered)), 1, 'Offering creates one link, for the member only');

SELECT is(
  (SELECT array[staff_may_customize_name, staff_may_customize_description] FROM public.service_items
   WHERE id = '00000000-0000-0000-0000-00000000a051'),
  array[false, false], 'D29: an offered master no longer lets staff rename or re-describe it');

-- First apply creates the replica.
CREATE TEMP TABLE first_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;

SELECT ok((SELECT (r->>'ok')::boolean FROM first_apply), 'The first apply succeeds');

CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE id = (SELECT id FROM link);

SELECT is(
  (SELECT array[s.name, s.price_pence::text, s.duration_minutes::text, s.capacity_per_session::text, s.venue_id::text, c.name]
   FROM public.service_items s JOIN public.service_categories c ON c.id = s.category_id
   WHERE s.id = (SELECT id FROM replica)),
  array['Cut', '2500', '30', '3', '00000000-0000-0000-0000-00000000a0f2', 'Hair'],
  'The member''s service carries the host columns, the seeded venue column and a heading of its own');

SELECT is(
  (SELECT count(*)::int FROM public.service_variants WHERE service_item_id = (SELECT id FROM replica) AND replica_of_variant_id IS NOT NULL),
  2, 'Both options are copied and mapped to the master''s');

SELECT is(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'After an apply the replica matches the master');

-- A second apply is a no-op.
CREATE TEMP TABLE audits_before AS SELECT count(*) AS n FROM public.collective_audit_events WHERE event_type = 'replica_applied';
CREATE TEMP TABLE second_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;

SELECT is(
  (SELECT (r->'writes'->>'service_items')::int + (r->'writes'->>'service_variants')::int + (r->'writes'->>'service_categories')::int FROM second_apply),
  0, 'A second apply writes nothing');
SELECT is(
  (SELECT count(*) FROM public.collective_audit_events WHERE event_type = 'replica_applied'),
  (SELECT n FROM audits_before), 'and audits nothing');

-- A host price change bumps the link; the apply converges it.
UPDATE public.service_items SET price_pence = 3000 WHERE id = '00000000-0000-0000-0000-00000000a051';

SELECT ok(
  (SELECT desired_revision > applied_revision FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'A host price change leaves the link due');

SELECT isnt(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'and the fingerprints now differ');

SELECT lives_ok($$ SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') $$, 'The apply runs');

SELECT is(
  (SELECT price_pence FROM public.service_items WHERE id = (SELECT id FROM replica)),
  3000, 'and the member''s price follows the host');

-- sort_order alone does not bump.
UPDATE public.service_items SET sort_order = 99 WHERE id = '00000000-0000-0000-0000-00000000a051';
SELECT is(
  (SELECT desired_revision = applied_revision FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  true, 'Reordering the host''s services does not make the link due');

-- The member's own venue column is not drift.
UPDATE public.service_items SET capacity_per_session = 9 WHERE id = (SELECT id FROM replica);
SELECT is(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'A member''s own capacity is not drift');

-- Deleting a master option deactivates the member's copy and keeps it.
DELETE FROM public.service_variants WHERE id = '00000000-0000-0000-0000-00000000a0b2';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[count(*) FILTER (WHERE is_active), count(*)]::int[] FROM public.service_variants WHERE service_item_id = (SELECT id FROM replica)),
  array[1, 2], 'A master option that is gone leaves the member''s copy inactive, not deleted');

-- The claim leases due work once.
UPDATE public.service_items SET price_pence = 3100 WHERE id = '00000000-0000-0000-0000-00000000a051';
SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_claim_due_links(10, interval '2 minutes')),
                (SELECT count(*) FROM public.collective_claim_due_links(10, interval '2 minutes'))]::int[]),
  array[1, 0], 'A due link is leased once, and not again while the lease holds');

-- Withdrawing retires the member's service.
SELECT public.collective_withdraw_service((SELECT item_id FROM link), '00000000-0000-0000-0000-00000000a0f1', NULL);
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT is_active FROM public.service_items WHERE id = (SELECT id FROM replica)),
  false, 'Withdrawing the offering retires the member''s service');

-- An ended membership: the apply writes nothing.
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-00000000a0e2';
SELECT is(
  (SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline')->>'error_code'),
  'membership_inactive', 'An apply for a membership that has ended writes nothing');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.collective_apply_replica(uuid, uuid, uuid, text, timestamptz, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.collective_offer_service(uuid, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'Client roles cannot call the engine');

SELECT * FROM finish();

ROLLBACK;
