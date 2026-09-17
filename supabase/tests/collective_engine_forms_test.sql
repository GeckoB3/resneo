-- Resneo: the collective engine gives members the host's forms (20270215150000; plan §6.4 item 5,
-- Appendix D; RT1-3, RT2-7, D10).
--
-- Proves, on a replicas-model collective:
--   * a member form from the same library template is adopted, even archived: unarchived, managed,
--     its own records still counting, and brought to the host's schema with a new version;
--   * otherwise a member form with the same name is adopted;
--   * otherwise a new form is created, its slug suffixed when the member already uses the host's,
--     and the member's own form on that slug is left alone;
--   * the service's requirement and the host's venue-wide one for the same form are merged
--     (strictest enforcement, longest lock period, inline if either);
--   * the fingerprints agree, and a second apply writes nothing;
--   * a new host version makes the link due and gives the member a new version;
--   * a venue-wide host requirement change makes the link due and converges;
--   * a requirement the host removes is removed at the member, and the form kept;
--   * the member's own venue-wide requirement is never touched;
--   * a member cannot archive a managed form, and one archived anyway is drift;
--   * the engine copies exactly the registry's host columns for forms and add-ons.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000c0f1', 'Forms Host', 'forms-host', 'host@forms.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000c0f2', 'Forms Member', 'forms-member', 'member@forms.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-00000000c0c1', 'forms-collective', 'Forms Collective',
        '00000000-0000-0000-0000-00000000c0f1', 'active', 'unified_catalog', 'replicas');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000c0e1', '00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-00000000c0f1', 'active'),
  ('00000000-0000-0000-0000-00000000c0e2', '00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-00000000c0f2', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000c051', '00000000-0000-0000-0000-00000000c0f1', 'Tint', 30, 2000);

-- Host forms: A from the library, B and C the host's own. Member forms: MA archived from the same
-- template, MB with B's name, MC on C's slug with a different name.
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods, library_template_slug, is_active, archived_at)
VALUES
  ('00000000-0000-0000-0000-0000000c0a01', '00000000-0000-0000-0000-00000000c0f1', 'Patch test', 'patch-test', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test', true, NULL),
  ('00000000-0000-0000-0000-0000000c0a02', '00000000-0000-0000-0000-00000000c0f1', 'Intake', 'intake', 'intake', 'completed', ARRAY['client_online'], NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000c0a03', '00000000-0000-0000-0000-00000000c0f1', 'Consent', 'consent', 'consent', 'signed', ARRAY['client_online'], NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000c0b01', '00000000-0000-0000-0000-00000000c0f2', 'Old patch', 'old-patch', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test', false, now()),
  ('00000000-0000-0000-0000-0000000c0b02', '00000000-0000-0000-0000-00000000c0f2', 'intake ', 'member-intake', 'intake', 'completed', ARRAY['client_online'], NULL, true, NULL),
  ('00000000-0000-0000-0000-0000000c0b03', '00000000-0000-0000-0000-00000000c0f2', 'Other consent', 'consent', 'consent', 'signed', ARRAY['client_online'], NULL, true, NULL);

INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES
  ('00000000-0000-0000-0000-0000000c0d01', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000c0a01', 1, '{"fields":["patch"]}'),
  ('00000000-0000-0000-0000-0000000c0d02', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000c0a02', 1, '{"fields":["intake"]}'),
  ('00000000-0000-0000-0000-0000000c0d03', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000c0a03', 1, '{"fields":["consent"]}'),
  ('00000000-0000-0000-0000-0000000c0e01', '00000000-0000-0000-0000-00000000c0f2', '00000000-0000-0000-0000-0000000c0b01', 1, '{"fields":["old"]}'),
  ('00000000-0000-0000-0000-0000000c0e02', '00000000-0000-0000-0000-00000000c0f2', '00000000-0000-0000-0000-0000000c0b02', 1, '{"fields":["intake"]}');
UPDATE public.compliance_types t SET current_version_id = v.id
FROM public.compliance_type_versions v WHERE v.compliance_type_id = t.id;

-- Host requirements: A on the service and venue-wide, B venue-wide, C on the service.
-- Member: its own venue-wide requirement for MC.
INSERT INTO public.service_compliance_requirements (id, venue_id, service_item_id, compliance_type_id, scope, enforcement, lock_period_hours, online_collection)
VALUES
  ('00000000-0000-0000-0000-0000000c0f01', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-00000000c051', '00000000-0000-0000-0000-0000000c0a01', 'service', 'block_online', 48, 'confirmation_link'),
  ('00000000-0000-0000-0000-0000000c0f02', '00000000-0000-0000-0000-00000000c0f1', NULL, '00000000-0000-0000-0000-0000000c0a01', 'venue', 'warn_staff', 72, 'inline'),
  ('00000000-0000-0000-0000-0000000c0f03', '00000000-0000-0000-0000-00000000c0f1', NULL, '00000000-0000-0000-0000-0000000c0a02', 'venue', 'warn_client', NULL, 'none'),
  ('00000000-0000-0000-0000-0000000c0f04', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-00000000c051', '00000000-0000-0000-0000-0000000c0a03', 'service', 'warn_staff', NULL, 'confirmation_link'),
  ('00000000-0000-0000-0000-0000000c0f09', '00000000-0000-0000-0000-00000000c0f2', NULL, '00000000-0000-0000-0000-0000000c0b03', 'venue', 'block_all', 24, 'inline');

CREATE TEMP TABLE offered AS
SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000c0c1', '00000000-0000-0000-0000-00000000c051',
  '00000000-0000-0000-0000-00000000c0f1', NULL) AS r;
CREATE TEMP TABLE link AS SELECT (r->'links'->0->>'link_id')::uuid AS id FROM offered;
CREATE TEMP TABLE first_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;
CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE id = (SELECT id FROM link);

SELECT ok((SELECT (r->>'ok')::boolean FROM first_apply), 'The first apply succeeds');

SELECT is(
  (SELECT array[name, slug, is_active::text, (archived_at IS NULL)::text, managed_by_collective_id::text,
                replica_of_compliance_type_id::text, accepts_records_from_type_id::text]
   FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000000c0b01'),
  array['Patch test', 'old-patch', 'true', 'true', '00000000-0000-0000-0000-00000000c0c1',
        '00000000-0000-0000-0000-0000000c0a01', '00000000-0000-0000-0000-0000000c0b01'],
  'An archived member form from the same template is adopted, unarchived, and its own records still count');

SELECT is(
  (SELECT array[v.version_number::text, v.form_schema::text, v.replica_of_version_id::text]
   FROM public.compliance_types t JOIN public.compliance_type_versions v ON v.id = t.current_version_id
   WHERE t.id = '00000000-0000-0000-0000-0000000c0b01'),
  array['2', '{"fields": ["patch"]}', '00000000-0000-0000-0000-0000000c0d01'],
  'and it takes the host''s schema as its next version');

SELECT is(
  (SELECT array[replica_of_compliance_type_id::text, name]
   FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000000c0b02'),
  array['00000000-0000-0000-0000-0000000c0a02', 'Intake'],
  'A member form with the same name is adopted');
SELECT is(
  (SELECT count(*)::int FROM public.compliance_type_versions WHERE compliance_type_id = '00000000-0000-0000-0000-0000000c0b02'),
  1, 'and gets no new version when its schema already matches');

SELECT is(
  (SELECT array[slug, name] FROM public.compliance_types
   WHERE venue_id = '00000000-0000-0000-0000-00000000c0f2' AND replica_of_compliance_type_id = '00000000-0000-0000-0000-0000000c0a03'),
  array['consent-2', 'Consent'],
  'Otherwise a new form is created, its slug suffixed past the member''s own');
SELECT is(
  (SELECT array[name, coalesce(managed_by_collective_id::text, 'unmanaged')] FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000000c0b03'),
  array['Other consent', 'unmanaged'], 'and the member''s own form on that slug is left alone');

CREATE TEMP TABLE member_reqs AS
SELECT t.replica_of_compliance_type_id AS master_type, r.enforcement, r.lock_period_hours, r.online_collection
FROM public.service_compliance_requirements r JOIN public.compliance_types t ON t.id = r.compliance_type_id
WHERE r.service_item_id = (SELECT id FROM replica);

SELECT is(
  (SELECT array_agg(enforcement || ':' || coalesce(lock_period_hours::text, '-') || ':' || online_collection ORDER BY master_type) FROM member_reqs),
  array['block_online:72:inline', 'warn_client:-:none', 'warn_staff:-:confirmation_link'],
  'Service and venue-wide requirements are merged: strictest, longest, inline if either');

SELECT is(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'After an apply the forms match the master');

CREATE TEMP TABLE second_apply AS SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline') AS r;
SELECT is(
  (SELECT (r->'writes'->>'compliance_types')::int + (r->'writes'->>'compliance_type_versions')::int
          + (r->'writes'->>'service_compliance_requirements')::int FROM second_apply),
  0, 'A second apply writes no forms');

-- The host publishes a new version of A.
INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES ('00000000-0000-0000-0000-0000000c0d11', '00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000c0a01', 2, '{"fields":["patch","photo"]}');
UPDATE public.compliance_types SET current_version_id = '00000000-0000-0000-0000-0000000c0d11'
WHERE id = '00000000-0000-0000-0000-0000000c0a01';
SELECT ok(
  (SELECT desired_revision > applied_revision FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'A new host version leaves the link due');
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[v.version_number::text, v.form_schema::text]
   FROM public.compliance_types t JOIN public.compliance_type_versions v ON v.id = t.current_version_id
   WHERE t.id = '00000000-0000-0000-0000-0000000c0b01'),
  array['3', '{"fields": ["patch", "photo"]}'], 'and the member''s form gets it as its next version');

-- The host tightens its venue-wide requirement for B.
UPDATE public.service_compliance_requirements SET enforcement = 'block_all' WHERE id = '00000000-0000-0000-0000-0000000c0f03';
SELECT ok(
  (SELECT desired_revision > applied_revision FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'A venue-wide host requirement change leaves the link due');
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT r.enforcement FROM public.service_compliance_requirements r
   WHERE r.service_item_id = (SELECT id FROM replica) AND r.compliance_type_id = '00000000-0000-0000-0000-0000000c0b02'),
  'block_all', 'and the member''s requirement follows');

-- The host stops requiring C on the service.
DELETE FROM public.service_compliance_requirements WHERE id = '00000000-0000-0000-0000-0000000c0f04';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  (SELECT array[(SELECT count(*) FROM public.service_compliance_requirements r JOIN public.compliance_types t ON t.id = r.compliance_type_id
                 WHERE r.service_item_id = (SELECT id FROM replica) AND t.replica_of_compliance_type_id = '00000000-0000-0000-0000-0000000c0a03'),
                (SELECT count(*) FROM public.compliance_types WHERE venue_id = '00000000-0000-0000-0000-00000000c0f2' AND slug = 'consent-2')]::int[]),
  array[0, 1], 'A requirement the host removes is removed at the member, and the form kept');

SELECT is(
  (SELECT array[enforcement, lock_period_hours::text] FROM public.service_compliance_requirements WHERE id = '00000000-0000-0000-0000-0000000c0f09'),
  array['block_all', '24'], 'The member''s own venue-wide requirement is untouched');

-- A member cannot archive a managed form (20270216120000's lock); one archived anyway, simulated
-- under the engine flag, is drift.
SELECT throws_ok(
  $$ UPDATE public.compliance_types SET archived_at = now(), is_active = false WHERE id = '00000000-0000-0000-0000-0000000c0b02' $$,
  'RN004', NULL, 'A member cannot archive a form the collective manages');
SELECT set_config('resneo.collective_engine', 'on', true);
UPDATE public.compliance_types SET archived_at = now(), is_active = false WHERE id = '00000000-0000-0000-0000-0000000c0b02';
SELECT set_config('resneo.collective_engine', '', true);
SELECT isnt(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'A member archiving a managed form is drift');

-- The engine's hand-written column lists match the registry's host columns.
SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(public.collective_registry_columns('compliance_types', ARRAY['host'])) c),
  ARRAY['capture_methods', 'category', 'description', 'form_link_expiry_days', 'library_template_slug', 'name',
        'online_unmet_message', 'result_type', 'validity_period_days'],
  'The apply copies exactly the registry''s host columns for forms');
SELECT is(
  (SELECT array_agg(t || '.' || c ORDER BY t, c) FROM (
     SELECT 'addon_groups' AS t, unnest(public.collective_registry_columns('addon_groups', ARRAY['host'])) AS c
     UNION ALL
     SELECT 'addons', unnest(public.collective_registry_columns('addons', ARRAY['host']))) x),
  ARRAY['addon_groups.description', 'addon_groups.hidden_from_online', 'addon_groups.is_active', 'addon_groups.max_select',
        'addon_groups.min_select', 'addon_groups.name', 'addon_groups.prompt_to_client', 'addon_groups.selection_type',
        'addons.additional_duration_minutes', 'addons.additional_price_pence', 'addons.description', 'addons.is_active',
        'addons.name', 'addons.sort_order'],
  'and for add-on groups and options');

SELECT * FROM finish();

ROLLBACK;
