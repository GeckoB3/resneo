-- Resneo: deleting a venue that is part of a collective (20270218160000; plan §6.7, T22, CB-16).
--
-- Proves: deleting a member releases it through the engine first (the collective carries on, the
-- host is told who it was); deleting the host ends its collective through the engine first, so the
-- delete goes through, every other venue keeps its services with the pointers cleared, and the end
-- notice still knows whom to tell once the collective's rows have gone.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000005a0f01', 'Delete Host', 'delete-host', 'host@delete.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000005a0f02', 'Delete Member', 'delete-member', 'member@delete.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000005a0f03', 'Delete Third', 'delete-third', 'third@delete.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000005a0c01', 'delete-collective', 'Delete Collective',
        '00000000-0000-0000-0000-0000005a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000005a0e01', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f01', 'active'),
  ('00000000-0000-0000-0000-0000005a0e02', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f02', 'active'),
  ('00000000-0000-0000-0000-0000005a0e03', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f03', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000005a05a1', '00000000-0000-0000-0000-0000005a0f01', 'Cut', 30, 3000);
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence, sort_order, is_active)
VALUES ('00000000-0000-0000-0000-0000005a0da1', '00000000-0000-0000-0000-0000005a0f01', '00000000-0000-0000-0000-0000005a05a1', 'Short', 20, 2000, 1, true);

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a05a1',
  '00000000-0000-0000-0000-0000005a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas ORDER BY id;
CREATE TEMP TABLE third_copy AS
SELECT replica_service_id AS id FROM public.collective_service_replicas
WHERE venue_id = '00000000-0000-0000-0000-0000005a0f03';

-- The member goes.
SELECT public.admin_hard_delete_venue('00000000-0000-0000-0000-0000005a0f02');

SELECT is(
  (SELECT changes->'after'->>'reason' FROM public.collective_audit_events
   WHERE event_type = 'member_released' AND changes->'after'->>'side' = 'host'
     AND collective_id = '00000000-0000-0000-0000-0000005a0c01'),
  'venue_deleted', 'A deleted member is released through the engine first');
SELECT is(
  (SELECT progress->>'venue_name' FROM public.collective_operations
   WHERE idempotency_key = 'release:00000000-0000-0000-0000-0000005a0e02'),
  'Delete Member', 'and its follow-up keeps its name for the host''s notice');
SELECT is(
  (SELECT status FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000005a0c01'),
  'active', 'The collective carries on with its other venues');

-- The host goes.
SELECT lives_ok(
  $$ SELECT public.admin_hard_delete_venue('00000000-0000-0000-0000-0000005a0f01') $$,
  'Deleting the host goes through');
SELECT is(
  (SELECT count(*)::int FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000005a0c01'),
  0, 'and its collective goes with it');
SELECT is(
  (SELECT count(*)::int FROM public.service_items WHERE id = (SELECT id FROM third_copy)),
  1, 'Every other venue keeps its service');
SELECT is(
  (SELECT count(*)::int FROM public.service_variants
   WHERE service_item_id = (SELECT id FROM third_copy) AND replica_of_variant_id IS NOT NULL),
  0, 'with nothing still pointing at the host');
SELECT is(
  (SELECT progress->'venue_ids' FROM public.collective_operations
   WHERE idempotency_key = 'dissolve:00000000-0000-0000-0000-0000005a0c01'),
  '["00000000-0000-0000-0000-0000005a0f03"]'::jsonb,
  'The end notice still knows whom to tell');

SELECT * FROM finish();

ROLLBACK;
