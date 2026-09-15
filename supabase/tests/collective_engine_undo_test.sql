-- Resneo: undo a host's change (20270216210000; plan §6.4 "Undo", D50).
--
-- Proves: a change to price, options, add-on links and form requirements, undone within a minute by
-- the host, restores the master's projection (every active option, link and requirement as it was);
-- the option the change added is switched off, not deleted; every live link is made due and the member converges; the undo is audited. A second
-- undo, an undo by a member, and an undo after a minute are refused.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000007a0f01', 'Undo Host', 'undo-host', 'h@undo.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000007a0f02', 'Undo Member', 'undo-member', 'm@undo.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000007a0c01', 'undo-collective', 'Undo Collective',
        '00000000-0000-0000-0000-0000007a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000007a0e01', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f01', 'active'),
  ('00000000-0000-0000-0000-0000007a0e02', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f02', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0f01', 'Blow dry', 30, 2500);
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000007a0b01', '00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', 'Long hair', 45, 3500);
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-0000007a0a02', '00000000-0000-0000-0000-0000007a0f01', 'Finish', 'single');
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id, sort_order)
VALUES ('00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0a02', 2);
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods)
VALUES
  ('00000000-0000-0000-0000-0000007a0a03', '00000000-0000-0000-0000-0000007a0f01', 'Scalp check', 'scalp-check', 'intake', 'completed', ARRAY['client_online']),
  ('00000000-0000-0000-0000-0000007a0a04', '00000000-0000-0000-0000-0000007a0f01', 'Heat consent', 'heat-consent', 'consent', 'signed', ARRAY['client_online']);
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement, lock_period_hours)
VALUES ('00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0a03', 'service', 'warn_staff', 24);

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;
CREATE TEMP TABLE item AS SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000007a0501';
CREATE TEMP TABLE link AS SELECT id FROM public.collective_service_replicas;

-- The host's save: projection before, the writes, the master_changed row (as the route will).
CREATE TEMP TABLE before_save AS SELECT public.collective_replica_projection((SELECT id FROM link), 'master') AS p;
UPDATE public.service_items SET price_pence = 3000, duration_minutes = 40 WHERE id = '00000000-0000-0000-0000-0000007a0501';
UPDATE public.service_variants SET is_active = false WHERE id = '00000000-0000-0000-0000-0000007a0b01';
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000007a0b02', '00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', 'Extra long', 60, 4500);
DELETE FROM public.service_addon_groups WHERE service_item_id = '00000000-0000-0000-0000-0000007a0501';
UPDATE public.service_compliance_requirements SET enforcement = 'block_all' WHERE service_item_id = '00000000-0000-0000-0000-0000007a0501';
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
VALUES ('00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0a04', 'service', 'block_online');
CREATE TEMP TABLE saved AS
SELECT public.collective_write_audit('00000000-0000-0000-0000-0000007a0c01', 'master_changed', '00000000-0000-0000-0000-0000007a0f01', NULL, NULL,
  '00000000-0000-0000-0000-0000007a0f01', (SELECT id FROM item), '00000000-0000-0000-0000-0000007a0501', NULL, NULL,
  jsonb_build_object('before', (SELECT p FROM before_save), 'after', public.collective_replica_projection((SELECT id FROM link), 'master')),
  NULL, now()) AS id;

SELECT throws_ok(
  format($$ SELECT public.collective_undo_master_change(%L, '00000000-0000-0000-0000-0000007a0f02', NULL) $$, (SELECT id FROM saved)),
  'P0001', NULL, 'A member cannot undo the host''s change');

CREATE TEMP TABLE undone AS
SELECT public.collective_undo_master_change((SELECT id FROM saved), '00000000-0000-0000-0000-0000007a0f01', NULL) AS r;

CREATE OR REPLACE FUNCTION pg_temp.active_variants(p jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT (p - 'variants') || jsonb_build_object('variants',
    coalesce((SELECT jsonb_agg(v ORDER BY v->>'key') FROM jsonb_array_elements(p->'variants') v WHERE (v->>'is_active')::boolean), '[]'::jsonb))
$$;
SELECT is(
  pg_temp.active_variants(public.collective_replica_projection((SELECT id FROM link), 'master')),
  pg_temp.active_variants((SELECT p FROM before_save)),
  'The master''s projection is what it was before the save (the added option now off)');
SELECT is(
  (SELECT array[is_active::text, (SELECT count(*)::text FROM public.service_variants WHERE id = '00000000-0000-0000-0000-0000007a0b02')]
   FROM public.service_variants WHERE id = '00000000-0000-0000-0000-0000007a0b02'),
  array['false', '1'], 'The option the change added is switched off, not deleted');
SELECT is(
  (SELECT (r->>'links_bumped')::int FROM undone), 1, 'Every live link is made due');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events WHERE event_type = 'master_change_undone'
     AND changes->>'undoes' = (SELECT id FROM saved)::text),
  1, 'The undo is audited against the change it undid');

SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
SELECT is(
  public.collective_replica_fingerprint((SELECT id FROM link)),
  public.collective_expected_fingerprint((SELECT id FROM link)),
  'The member converges on the restored service');

SELECT throws_ok(
  format($$ SELECT public.collective_undo_master_change(%L, '00000000-0000-0000-0000-0000007a0f01', NULL) $$, (SELECT id FROM saved)),
  'P0001', NULL, 'A change cannot be undone twice');

CREATE TEMP TABLE old_save AS
SELECT public.collective_write_audit('00000000-0000-0000-0000-0000007a0c01', 'master_changed', '00000000-0000-0000-0000-0000007a0f01', NULL, NULL,
  '00000000-0000-0000-0000-0000007a0f01', (SELECT id FROM item), '00000000-0000-0000-0000-0000007a0501', NULL, NULL,
  jsonb_build_object('before', (SELECT p FROM before_save)), NULL, now() - interval '2 minutes') AS id;
SELECT throws_ok(
  format($$ SELECT public.collective_undo_master_change(%L, '00000000-0000-0000-0000-0000007a0f01', NULL) $$, (SELECT id FROM old_save)),
  'P0001', NULL, 'COLLECTIVE_UNDO_EXPIRED: a change older than a minute cannot be undone');

SELECT * FROM finish();

ROLLBACK;
