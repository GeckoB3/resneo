-- Resneo: the collective engine copies add-on groups (20270215140000; plan §6.4 item 4, Appendix D).
--
-- Proves, on a replicas-model collective:
--   * the first apply creates one managed group at the member, its options and the service link,
--     and the fingerprints agree;
--   * a second apply writes nothing;
--   * the host re-saving its options (delete then insert, as the editor does) makes the link due, and
--     the apply updates the member's options in place, keeping their ids;
--   * a host dropping an option archives the member's copy rather than deleting it;
--   * a host group setting change converges;
--   * a member cannot link its own group to the replica; one linked anyway is unlinked, the group kept;
--   * unlinking a group at the host unlinks it at the member;
--   * deleting a master group releases the member's pointers first.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000b0f1', 'Addon Host', 'addon-host', 'host@addon.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000b0f2', 'Addon Member', 'addon-member', 'member@addon.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-00000000b0c1', 'addon-collective', 'Addon Collective',
        '00000000-0000-0000-0000-00000000b0f1', 'active', 'unified_catalog', 'replicas');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000b0e1', '00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b0f1', 'active'),
  ('00000000-0000-0000-0000-00000000b0e2', '00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b0f2', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000b051', '00000000-0000-0000-0000-00000000b0f1', 'Colour', 60, 5000);

INSERT INTO public.addon_groups (id, venue_id, name, selection_type, min_select, max_select, sort_order)
VALUES ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1', 'Extras', 'multi', 0, 2, 4);

INSERT INTO public.addons (id, addon_group_id, venue_id, name, additional_price_pence, additional_duration_minutes, cost_to_business_pence, sort_order)
VALUES
  ('00000000-0000-0000-0000-00000000b0b1', '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1', 'Toner', 800, 10, 200, 0),
  ('00000000-0000-0000-0000-00000000b0b2', '00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1', 'Gloss', 1200, 15, 300, 1);

INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id, sort_order)
VALUES ('00000000-0000-0000-0000-00000000b0f1', '00000000-0000-0000-0000-00000000b051', '00000000-0000-0000-0000-00000000b0a1', 3);

CREATE TEMP TABLE offered AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b051',
  '00000000-0000-0000-0000-00000000b0f1', NULL) AS r;
CREATE TEMP TABLE link AS SELECT (r->'links'->0->>'link_id')::uuid AS id FROM offered;

CREATE TEMP TABLE first_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;
CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE id = (SELECT id FROM link);
CREATE TEMP TABLE mgroup AS
SELECT id FROM public.addon_groups
WHERE venue_id = '00000000-0000-0000-0000-00000000b0f2' AND replica_of_addon_group_id = '00000000-0000-0000-0000-00000000b0a1';

SELECT is(
  (SELECT array[g.name, g.selection_type, g.max_select::text, g.sort_order::text, g.managed_by_collective_id::text, sag.sort_order::text]
   FROM public.addon_groups g JOIN public.service_addon_groups sag ON sag.addon_group_id = g.id
   WHERE g.id = (SELECT id FROM mgroup) AND sag.service_item_id = (SELECT id FROM replica)),
  array['Extras', 'multi', '2', '4', '00000000-0000-0000-0000-00000000b0c1', '3'],
  'The first apply creates a managed group at the member, linked to the member''s service');

SELECT is(
  (SELECT array_agg(a.name || ':' || a.additional_price_pence || ':' || coalesce(a.cost_to_business_pence::text, 'null') ORDER BY a.sort_order)
   FROM public.addons a WHERE a.addon_group_id = (SELECT id FROM mgroup)),
  array['Toner:800:null', 'Gloss:1200:null'],
  'and its options, without the host''s cost');

SELECT is(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'After an apply the add-ons match the master');

CREATE TEMP TABLE second_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;
SELECT is(
  (SELECT (r->'writes'->>'addon_groups')::int + (r->'writes'->>'addons')::int + (r->'writes'->>'service_addon_groups')::int FROM second_apply),
  0, 'A second apply writes no add-ons');

-- The host re-saves its options the way the editor does: delete, then insert, with a price change.
CREATE TEMP TABLE option_ids_before AS
SELECT array_agg(id ORDER BY sort_order) AS ids FROM public.addons WHERE addon_group_id = (SELECT id FROM mgroup);
DELETE FROM public.addons WHERE addon_group_id = '00000000-0000-0000-0000-00000000b0a1';
INSERT INTO public.addons (addon_group_id, venue_id, name, additional_price_pence, additional_duration_minutes, sort_order)
VALUES
  ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1', 'Toner', 900, 10, 0),
  ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1', 'Gloss', 1200, 15, 1);

SELECT ok(
  (SELECT desired_revision > applied_revision FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'Re-saving the host''s options leaves the link due');

SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array_agg(id ORDER BY sort_order) FROM public.addons WHERE addon_group_id = (SELECT id FROM mgroup) AND archived_at IS NULL),
  (SELECT ids FROM option_ids_before),
  'The member''s options keep their ids');
SELECT is(
  (SELECT additional_price_pence FROM public.addons WHERE addon_group_id = (SELECT id FROM mgroup) AND name = 'Toner'),
  900, 'and take the host''s new price');

-- The host drops Gloss.
DELETE FROM public.addons WHERE addon_group_id = '00000000-0000-0000-0000-00000000b0a1' AND name = 'Gloss';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[count(*) FILTER (WHERE archived_at IS NULL), count(*)]::int[] FROM public.addons WHERE addon_group_id = (SELECT id FROM mgroup)),
  array[1, 2], 'A host option that is gone is archived at the member, not deleted');

-- A group setting change converges.
UPDATE public.addon_groups SET max_select = 1, hidden_from_online = true WHERE id = '00000000-0000-0000-0000-00000000b0a1';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[max_select::text, hidden_from_online::text] FROM public.addon_groups WHERE id = (SELECT id FROM mgroup)),
  array['1', 'true'], 'A host group setting follows to the member');

-- The member cannot link its own group to the replica (20270216120000's lock). A link that got
-- there anyway, simulated under the engine flag, is taken away by the apply and the group kept.
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-00000000b0a9', '00000000-0000-0000-0000-00000000b0f2', 'Member own', 'single');
SELECT throws_ok(
  format($$ INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
            VALUES ('00000000-0000-0000-0000-00000000b0f2', %L, '00000000-0000-0000-0000-00000000b0a9') $$, (SELECT id FROM replica)),
  'RN003', NULL, 'A member cannot link its own group to the collective''s service');
SELECT set_config('resneo.collective_engine', 'on', true);
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
VALUES ('00000000-0000-0000-0000-00000000b0f2', (SELECT id FROM replica), '00000000-0000-0000-0000-00000000b0a9');
SELECT set_config('resneo.collective_engine', '', true);
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[(SELECT count(*) FROM public.service_addon_groups WHERE service_item_id = (SELECT id FROM replica) AND addon_group_id = '00000000-0000-0000-0000-00000000b0a9'),
                (SELECT count(*) FROM public.addon_groups WHERE id = '00000000-0000-0000-0000-00000000b0a9')]::int[]),
  array[0, 1], 'The member''s own group is unlinked from the replica and kept');

-- The host unlinks the group from the master.
DELETE FROM public.service_addon_groups WHERE service_item_id = '00000000-0000-0000-0000-00000000b051';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT count(*)::int FROM public.service_addon_groups WHERE service_item_id = (SELECT id FROM replica)),
  0, 'Unlinking the group at the host unlinks it at the member');

-- Deleting the master group releases the member's pointers first.
SELECT lives_ok($$ DELETE FROM public.addon_groups WHERE id = '00000000-0000-0000-0000-00000000b0a1' $$,
  'The host can delete a group the member follows');
SELECT is(
  (SELECT array[(replica_of_addon_group_id IS NULL)::text, (managed_by_collective_id IS NULL)::text,
                (SELECT bool_and(replica_of_addon_id IS NULL)::text FROM public.addons WHERE addon_group_id = (SELECT id FROM mgroup))]
   FROM public.addon_groups WHERE id = (SELECT id FROM mgroup)),
  array['true', 'true', 'true'], 'and the member''s group and options no longer point at it');

SELECT * FROM finish();

ROLLBACK;
