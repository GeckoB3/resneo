-- Resneo: the collective engine's release (20270216130000; plan §6.7, Appendix D; RT1-4, RT2-9,
-- D41, D52).
--
-- Proves, on a replicas-model collective:
--   * a membership moved out of active by an ordinary write runs the release (the status trigger);
--   * the links are released and kept, and the member's service stays exactly as it was (D52);
--   * managed headings, add-on groups and forms become the member's own, and every pointer clears;
--   * a paid service at a venue that cannot take charges drops to no online payment, audited;
--   * the address adoption from that venue is cleared;
--   * calendar assignments stay, and no account link is written;
--   * two member_released rows and one follow-up job; the locks lift;
--   * a second release writes nothing;
--   * the host's membership ending pauses the collective instead;
--   * on a legacy_copies collective the trigger does nothing.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(17);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000e0f1', 'Release Host', 'release-host', 'host@release.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000e0f2', 'Release Member', 'release-member', 'member@release.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000e0f3', 'Legacy Member', 'legacy-member', 'legacy@release.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model, slug_strategy, adopted_venue_id)
VALUES
  ('00000000-0000-0000-0000-00000000e0c1', 'release-collective', 'Release Collective',
   '00000000-0000-0000-0000-00000000e0f1', 'active', 'unified_catalog', 'replicas', 'adopt_member', '00000000-0000-0000-0000-00000000e0f2'),
  ('00000000-0000-0000-0000-00000000e0c2', 'legacy-collective', 'Legacy Collective',
   '00000000-0000-0000-0000-00000000e0f1', 'active', 'unified_catalog', 'legacy_copies', 'dedicated', NULL);

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000e0e1', '00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000e0f1', 'active'),
  ('00000000-0000-0000-0000-00000000e0e2', '00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000e0f2', 'active'),
  ('00000000-0000-0000-0000-00000000e0e3', '00000000-0000-0000-0000-00000000e0c2', '00000000-0000-0000-0000-00000000e0f3', 'active');

-- A paid master with a heading, an option, an add-on group and a form.
INSERT INTO public.service_categories (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000e0a1', '00000000-0000-0000-0000-00000000e0f1', 'Lashes');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, deposit_pence, payment_requirement, category_id)
VALUES ('00000000-0000-0000-0000-00000000e051', '00000000-0000-0000-0000-00000000e0f1', 'Lift', 45, 4500, 1000, 'deposit', '00000000-0000-0000-0000-00000000e0a1');
INSERT INTO public.service_variants (venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000e0f1', '00000000-0000-0000-0000-00000000e051', 'With tint', 60, 5500);
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-00000000e0f1', 'Aftercare', 'single');
INSERT INTO public.addons (addon_group_id, venue_id, name, additional_price_pence)
VALUES ('00000000-0000-0000-0000-00000000e0a2', '00000000-0000-0000-0000-00000000e0f1', 'Serum', 900);
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
VALUES ('00000000-0000-0000-0000-00000000e0f1', '00000000-0000-0000-0000-00000000e051', '00000000-0000-0000-0000-00000000e0a2');
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods)
VALUES ('00000000-0000-0000-0000-00000000e0a3', '00000000-0000-0000-0000-00000000e0f1', 'Lash consent', 'lash-consent', 'consent', 'signed', ARRAY['client_online']);
INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES ('00000000-0000-0000-0000-00000000e0b3', '00000000-0000-0000-0000-00000000e0f1', '00000000-0000-0000-0000-00000000e0a3', 1, '{"fields":[]}');
UPDATE public.compliance_types SET current_version_id = '00000000-0000-0000-0000-00000000e0b3' WHERE id = '00000000-0000-0000-0000-00000000e0a3';
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
VALUES ('00000000-0000-0000-0000-00000000e0f1', '00000000-0000-0000-0000-00000000e051', '00000000-0000-0000-0000-00000000e0a3', 'service', 'block_online');

INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000e0d1', '00000000-0000-0000-0000-00000000e0f2', 'Member bed');

SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000e0c1', '00000000-0000-0000-0000-00000000e051',
  '00000000-0000-0000-0000-00000000e0f1', NULL);
CREATE TEMP TABLE link AS
SELECT id FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE id = (SELECT id FROM link);
INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
VALUES ('00000000-0000-0000-0000-00000000e0d1', (SELECT id FROM replica));

CREATE TEMP TABLE before_release AS
SELECT name, price_pence, duration_minutes, is_active, category_id FROM public.service_items WHERE id = (SELECT id FROM replica);
CREATE TEMP TABLE link_count_before AS SELECT count(*) AS n FROM public.account_links;

-- The member leaves through an ordinary write.
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-00000000e0e2';

SELECT ok(
  (SELECT released_at IS NOT NULL FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'Leaving releases the member''s link, and the link row is kept');

SELECT is(
  (SELECT array[s.name, s.price_pence::text, s.duration_minutes::text, s.is_active::text, s.category_id::text]
   FROM public.service_items s WHERE s.id = (SELECT id FROM replica)),
  (SELECT array[b.name, b.price_pence::text, b.duration_minutes::text, b.is_active::text, b.category_id::text] FROM before_release b),
  'D52: the member''s service stays exactly as it was');

SELECT is(
  (SELECT array[
     (SELECT count(*) FROM public.service_categories WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND (managed_by_collective_id IS NOT NULL OR replica_of_category_id IS NOT NULL)),
     (SELECT count(*) FROM public.addon_groups WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND (managed_by_collective_id IS NOT NULL OR replica_of_addon_group_id IS NOT NULL)),
     (SELECT count(*) FROM public.compliance_types WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND (managed_by_collective_id IS NOT NULL OR replica_of_compliance_type_id IS NOT NULL))
   ]::int[]),
  array[0, 0, 0], 'The heading, add-on group and form become the member''s own');

SELECT is(
  (SELECT array[
     (SELECT count(*) FROM public.service_variants WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND replica_of_variant_id IS NOT NULL),
     (SELECT count(*) FROM public.addons WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND replica_of_addon_id IS NOT NULL),
     (SELECT count(*) FROM public.compliance_type_versions WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND replica_of_version_id IS NOT NULL),
     (SELECT count(*) FROM public.service_compliance_requirements WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2' AND replica_of_requirement_id IS NOT NULL)
   ]::int[]),
  array[0, 0, 0, 0], 'and no option, add-on, version or requirement points at the host any more');

SELECT is(
  (SELECT array[(SELECT count(*) FROM public.addon_groups WHERE venue_id = '00000000-0000-0000-0000-00000000e0f2'),
                (SELECT count(*) FROM public.service_compliance_requirements WHERE service_item_id = (SELECT id FROM replica))]::int[]),
  array[1, 1], 'Nothing is deleted: the group and the requirement are still there');

SELECT is(
  (SELECT payment_requirement::text FROM public.service_items WHERE id = (SELECT id FROM replica)),
  'none', 'RT2-9: a paid service at a venue that cannot take charges drops to no online payment');
SELECT is(
  (SELECT changes->'before'->>'payment_requirement' FROM public.collective_audit_events
   WHERE event_type = 'payment_rule_downgraded' AND service_id = (SELECT id FROM replica)),
  'deposit', 'and the old rule is audited');

SELECT is(
  (SELECT array[slug_strategy, coalesce(adopted_venue_id::text, 'none')] FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-00000000e0c1'),
  array['dedicated', 'none'], 'The collective no longer uses the departed member''s address');

SELECT is(
  (SELECT count(*)::int FROM public.calendar_service_assignments WHERE service_item_id = (SELECT id FROM replica)),
  1, 'The member''s calendar still offers the service');
SELECT is(
  (SELECT count(*) FROM public.account_links), (SELECT n FROM link_count_before),
  'D41: no account link is written');

SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_audit_events WHERE event_type = 'member_released' AND collective_id = '00000000-0000-0000-0000-00000000e0c1'),
                (SELECT count(*) FROM public.collective_operations WHERE idempotency_key = 'release:00000000-0000-0000-0000-00000000e0e2' AND kind = 'release_followup')]::int[]),
  array[2, 1], 'Two member_released rows, one for each side, and one follow-up job');

SELECT lives_ok(
  format($$ UPDATE public.service_items SET price_pence = 3900 WHERE id = %L $$, (SELECT id FROM replica)),
  'The locks lift: the member can change its service');

-- A second release writes nothing.
CREATE TEMP TABLE audits_before AS SELECT count(*) AS n FROM public.collective_audit_events;
SELECT is(
  (public.collective_release_member('00000000-0000-0000-0000-00000000e0e2', 'left', NULL, NULL)->>'links_released')::int,
  0, 'Releasing again releases nothing');
SELECT is(
  (SELECT count(*) FROM public.collective_audit_events), (SELECT n FROM audits_before),
  'and audits nothing');

-- The host's membership ending pauses the collective.
UPDATE public.venue_collective_members SET status = 'removed' WHERE id = '00000000-0000-0000-0000-00000000e0e1';
SELECT is(
  (SELECT array[(paused_at IS NOT NULL)::text, paused_reason, status] FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-00000000e0c1'),
  array['true', 'host_left', 'active'], 'The host''s membership ending pauses the collective');
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-00000000e051' AND status = 'active'),
  1, 'and leaves the offering in place');

-- Legacy collectives: nothing happens.
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-00000000e0e3';
SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-00000000e0c2'),
                (SELECT count(*) FROM public.venue_collective_members WHERE id = '00000000-0000-0000-0000-00000000e0e3' AND left_at IS NOT NULL)]::int[]),
  array[0, 0], 'On today''s collectives the release does nothing');

SELECT * FROM finish();

ROLLBACK;
