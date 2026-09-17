-- Resneo: host transfer (20270216200000; plan §6.7, Appendix D).
--
-- Proves, on a replicas-model collective with host H, new host N and member P:
--   * the move is refused while any copy is behind (COLLECTIVE_LINKS_BEHIND), and by a member that
--     was not offered the hosting;
--   * after it, N hosts; the offering's master is N's service; H's service follows it through H's link
--     (adopted); N has no link; options, headings, add-on groups and forms have swapped sides, and P's
--     mappings point at N's objects;
--   * the locks follow: N can change its service, H can no longer change its copy;
--   * a pause is cleared and audited as resumed;
--   * once every link has re-applied the invariant report reads 0, and a change at N reaches H and P.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model, feature_flags)
VALUES
  ('00000000-0000-0000-0000-0000006a0f01', 'Move Old Host', 'move-old-host', 'h@move.test', 'appointments', 'active', 'unified_scheduling', '{"compliance_records_enabled": true}'),
  ('00000000-0000-0000-0000-0000006a0f02', 'Move New Host', 'move-new-host', 'n@move.test', 'appointments', 'active', 'unified_scheduling', '{"compliance_records_enabled": true}'),
  ('00000000-0000-0000-0000-0000006a0f03', 'Move Member', 'move-member', 'p@move.test', 'appointments', 'active', 'unified_scheduling', '{"compliance_records_enabled": true}');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000006a0c01', 'move-collective', 'Move Collective',
        '00000000-0000-0000-0000-0000006a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status, joined_at)
VALUES
  ('00000000-0000-0000-0000-0000006a0e01', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f01', 'active', now()),
  ('00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02', 'active', now()),
  ('00000000-0000-0000-0000-0000006a0e03', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f03', 'active', now());

INSERT INTO public.service_categories (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-0000006a0a01', '00000000-0000-0000-0000-0000006a0f01', 'Skin');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, category_id)
VALUES ('00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0f01', 'Peel', 40, 7000, '00000000-0000-0000-0000-0000006a0a01');
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000006a0b01', '00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0501', 'Strong', 50, 8000);
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-0000006a0a02', '00000000-0000-0000-0000-0000006a0f01', 'Mask', 'single');
INSERT INTO public.addons (addon_group_id, venue_id, name, additional_price_pence)
VALUES ('00000000-0000-0000-0000-0000006a0a02', '00000000-0000-0000-0000-0000006a0f01', 'Hydrating', 1000);
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
VALUES ('00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0a02');
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods)
VALUES ('00000000-0000-0000-0000-0000006a0a03', '00000000-0000-0000-0000-0000006a0f01', 'Skin consent', 'skin-consent', 'consent', 'signed', ARRAY['client_online']);
INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES ('00000000-0000-0000-0000-0000006a0b03', '00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0a03', 1, '{"fields":["ok"]}');
UPDATE public.compliance_types SET current_version_id = '00000000-0000-0000-0000-0000006a0b03' WHERE id = '00000000-0000-0000-0000-0000006a0a03';
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
VALUES ('00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0a03', 'service', 'block_online');
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0f01', 'H room'),
  ('00000000-0000-0000-0000-0000006a0d02', '00000000-0000-0000-0000-0000006a0f02', 'N room'),
  ('00000000-0000-0000-0000-0000006a0d03', '00000000-0000-0000-0000-0000006a0f03', 'P room');

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0f01', NULL);
CREATE TEMP TABLE item AS SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000006a0501';

SELECT throws_ok(
  $$ SELECT public.collective_transfer_host('00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02', '00000000-0000-0000-0000-0000006a0f01', NULL) $$,
  'P0001', NULL, 'COLLECTIVE_LINKS_BEHIND: the hosting cannot move while copies are behind');

SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas ORDER BY id;
CREATE TEMP TABLE before_move AS
SELECT l.venue_id, l.id AS link, l.replica_service_id AS service FROM public.collective_service_replicas l;
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000006a0c01', (SELECT id FROM item), v, c, 'assign', '00000000-0000-0000-0000-0000006a0f01', NULL)
FROM (VALUES ('00000000-0000-0000-0000-0000006a0f01'::uuid, '00000000-0000-0000-0000-0000006a0d01'::uuid),
             ('00000000-0000-0000-0000-0000006a0f02'::uuid, '00000000-0000-0000-0000-0000006a0d02'::uuid),
             ('00000000-0000-0000-0000-0000006a0f03'::uuid, '00000000-0000-0000-0000-0000006a0d03'::uuid)) a(v, c);

SELECT throws_ok(
  $$ SELECT public.collective_transfer_host('00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02', '00000000-0000-0000-0000-0000006a0f03', NULL) $$,
  'P0001', NULL, 'A member not offered the hosting cannot move it');

-- The host lapses and N takes over while paused.
UPDATE public.venue_collectives SET paused_at = now(), paused_reason = 'host_lapsed' WHERE id = '00000000-0000-0000-0000-0000006a0c01';
CREATE TEMP TABLE moved AS
SELECT public.collective_transfer_host('00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02',
  '00000000-0000-0000-0000-0000006a0f02', NULL) AS r;

CREATE TEMP TABLE n AS SELECT service FROM before_move WHERE venue_id = '00000000-0000-0000-0000-0000006a0f02';
CREATE TEMP TABLE p AS SELECT service FROM before_move WHERE venue_id = '00000000-0000-0000-0000-0000006a0f03';

SELECT is(
  (SELECT array[host_venue_id::text, coalesce(paused_at::text, 'none'), coalesce(paused_reason, 'none')] FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000006a0c01'),
  array['00000000-0000-0000-0000-0000006a0f02', 'none', 'none'], 'N hosts, and the pause is cleared');
SELECT is(
  (SELECT master_service_id FROM public.collective_service_items WHERE id = (SELECT id FROM item)),
  (SELECT service FROM n), 'The offering''s master is now N''s service');
SELECT is(
  (SELECT array[l.venue_id::text, l.replica_service_id::text, l.provenance,
                (SELECT count(*)::text FROM public.collective_service_replicas x WHERE x.venue_id = '00000000-0000-0000-0000-0000006a0f02' AND x.released_at IS NULL)]
   FROM public.collective_service_replicas l WHERE l.id = (SELECT link FROM before_move WHERE venue_id = '00000000-0000-0000-0000-0000006a0f02')),
  array['00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0501', 'adopted', '0'],
  'N''s link became H''s: H''s service follows, adopted; N has no link');

SELECT is(
  (SELECT array[
     (SELECT count(*) FROM public.service_variants WHERE service_item_id = (SELECT service FROM n) AND replica_of_variant_id IS NOT NULL),
     (SELECT count(*) FROM public.service_variants hv JOIN public.service_variants nv ON nv.id = hv.replica_of_variant_id
      WHERE hv.id = '00000000-0000-0000-0000-0000006a0b01' AND nv.service_item_id = (SELECT service FROM n)),
     (SELECT count(*) FROM public.service_variants pv JOIN public.service_variants nv ON nv.id = pv.replica_of_variant_id
      WHERE pv.service_item_id = (SELECT service FROM p) AND nv.service_item_id = (SELECT service FROM n))
   ]::int[]),
  array[0, 1, 1], 'Options: N''s are its own; H''s and P''s follow N''s');

SELECT is(
  (SELECT array[
     (SELECT count(*) FROM public.service_categories WHERE venue_id = '00000000-0000-0000-0000-0000006a0f02' AND managed_by_collective_id IS NOT NULL),
     (SELECT count(*) FROM public.addon_groups WHERE venue_id = '00000000-0000-0000-0000-0000006a0f02' AND managed_by_collective_id IS NOT NULL),
     (SELECT count(*) FROM public.compliance_types WHERE venue_id = '00000000-0000-0000-0000-0000006a0f02' AND managed_by_collective_id IS NOT NULL),
     (SELECT count(*) FROM public.service_categories WHERE id = '00000000-0000-0000-0000-0000006a0a01' AND managed_by_collective_id IS NOT NULL),
     (SELECT count(*) FROM public.addon_groups WHERE id = '00000000-0000-0000-0000-0000006a0a02' AND managed_by_collective_id IS NOT NULL),
     (SELECT count(*) FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000006a0a03' AND managed_by_collective_id IS NOT NULL AND accepts_records_from_type_id = id)
   ]::int[]),
  array[0, 0, 0, 1, 1, 1], 'The library swapped sides: N''s heading, group and form are its own; H''s are managed');

SELECT is(
  (SELECT array[
     (SELECT h.venue_id::text FROM public.service_categories pc JOIN public.service_categories h ON h.id = pc.replica_of_category_id
      WHERE pc.venue_id = '00000000-0000-0000-0000-0000006a0f03' AND pc.managed_by_collective_id IS NOT NULL),
     (SELECT g.venue_id::text FROM public.addon_groups pg JOIN public.addon_groups g ON g.id = pg.replica_of_addon_group_id
      WHERE pg.venue_id = '00000000-0000-0000-0000-0000006a0f03' AND pg.managed_by_collective_id IS NOT NULL),
     (SELECT t.venue_id::text FROM public.compliance_types pt JOIN public.compliance_types t ON t.id = pt.replica_of_compliance_type_id
      WHERE pt.venue_id = '00000000-0000-0000-0000-0000006a0f03' AND pt.managed_by_collective_id IS NOT NULL)
   ]),
  array['00000000-0000-0000-0000-0000006a0f02', '00000000-0000-0000-0000-0000006a0f02', '00000000-0000-0000-0000-0000006a0f02'],
  'P''s heading, group and form follow N''s');

SELECT lives_ok(
  format($$ UPDATE public.service_items SET price_pence = 7500 WHERE id = %L $$, (SELECT service FROM n)),
  'The locks follow: N can change its service');
SELECT throws_ok(
  $$ UPDATE public.service_items SET price_pence = 1 WHERE id = '00000000-0000-0000-0000-0000006a0501' $$,
  'RN001', NULL, 'and H can no longer change its copy');

SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000006a0c01' AND event_type = 'host_transferred'),
                (SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000006a0c01' AND event_type = 'collective_resumed')]::int[]),
  array[1, 1], 'Audited as host_transferred and collective_resumed');

-- Every link re-applies.
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline')
FROM public.collective_service_replicas WHERE collective_id = '00000000-0000-0000-0000-0000006a0c01' AND released_at IS NULL ORDER BY id;

SELECT is(
  (SELECT array[(SELECT price_pence FROM public.service_items WHERE id = '00000000-0000-0000-0000-0000006a0501'),
                (SELECT price_pence FROM public.service_items WHERE id = (SELECT service FROM p))]),
  array[7500, 7500], 'N''s change reaches H and P');

SELECT is(
  (SELECT coalesce(array_agg(invariant || '=' || violations ORDER BY invariant), ARRAY[]::text[])
   FROM public.collective_invariant_report(NULL, '00000000-0000-0000-0000-0000006a0c01') WHERE violations <> 0),
  ARRAY[]::text[], 'After the applies the collective breaks no invariant');

SELECT * FROM finish();

ROLLBACK;
