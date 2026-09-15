-- Resneo: a member's own requirements on a form the collective takes over (20270216190000; D57).
--
-- Proves: when the apply adopts the member's form, managed_since is set; the member's requirement
-- that existed before stays editable; moving it to another service, or adding a new one, is refused
-- (RN004); I15 reads 0; and leaving clears managed_since.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000005a0f01', 'Adopt Host', 'adopt-host', 'host@adopt.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000005a0f02', 'Adopt Member', 'adopt-member', 'member@adopt.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000005a0c01', 'adopt-collective', 'Adopt Collective',
        '00000000-0000-0000-0000-0000005a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000005a0e01', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f01', 'active'),
  ('00000000-0000-0000-0000-0000005a0e02', '00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0f02', 'active');

-- Host: a master requiring a library patch test. Member: its own patch test from the same template,
-- already required (a day ago) by its own Colour service, and a second own service.
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000005a0501', '00000000-0000-0000-0000-0000005a0f01', 'Tint', 20, 1500),
  ('00000000-0000-0000-0000-0000005a0502', '00000000-0000-0000-0000-0000005a0f02', 'Colour', 90, 8000),
  ('00000000-0000-0000-0000-0000005a0503', '00000000-0000-0000-0000-0000005a0f02', 'Highlights', 120, 9000);
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods, library_template_slug)
VALUES
  ('00000000-0000-0000-0000-0000005a0a01', '00000000-0000-0000-0000-0000005a0f01', 'Patch test', 'patch-test', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test'),
  ('00000000-0000-0000-0000-0000005a0a02', '00000000-0000-0000-0000-0000005a0f02', 'Our patch test', 'our-patch', 'test', 'pass_fail', ARRAY['staff_in_venue'], 'patch-test');
INSERT INTO public.service_compliance_requirements (id, venue_id, service_item_id, compliance_type_id, scope, enforcement, created_at)
VALUES
  ('00000000-0000-0000-0000-0000005a0f91', '00000000-0000-0000-0000-0000005a0f01', '00000000-0000-0000-0000-0000005a0501', '00000000-0000-0000-0000-0000005a0a01', 'service', 'block_online', now()),
  ('00000000-0000-0000-0000-0000005a0f92', '00000000-0000-0000-0000-0000005a0f02', '00000000-0000-0000-0000-0000005a0502', '00000000-0000-0000-0000-0000005a0a02', 'service', 'warn_staff', now() - interval '1 day');

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000005a0c01', '00000000-0000-0000-0000-0000005a0501', '00000000-0000-0000-0000-0000005a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;

SELECT is(
  (SELECT array[replica_of_compliance_type_id::text, (managed_since IS NOT NULL)::text] FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000005a0a02'),
  array['00000000-0000-0000-0000-0000005a0a01', 'true'], 'The apply adopts the member''s form and records when');

SELECT lives_ok(
  $$ UPDATE public.service_compliance_requirements SET enforcement = 'block_all' WHERE id = '00000000-0000-0000-0000-0000005a0f92' $$,
  'D57: the member can still edit the requirement it already had');
SELECT throws_ok(
  $$ UPDATE public.service_compliance_requirements SET service_item_id = '00000000-0000-0000-0000-0000005a0503' WHERE id = '00000000-0000-0000-0000-0000005a0f92' $$,
  'RN004', NULL, 'but cannot move it onto another of its services');
SELECT throws_ok(
  $$ INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
     VALUES ('00000000-0000-0000-0000-0000005a0f02', '00000000-0000-0000-0000-0000005a0503', '00000000-0000-0000-0000-0000005a0a02', 'service', 'warn_staff') $$,
  'RN004', NULL, 'nor add a new one on the managed form');

SELECT is(
  (SELECT violations FROM public.collective_invariant_report(NULL, '00000000-0000-0000-0000-0000005a0c01') WHERE invariant = 'I15'),
  0::bigint, 'I15 does not count the requirement the member already had');

UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-0000005a0e02';
SELECT is(
  (SELECT array[coalesce(managed_by_collective_id::text, 'none'), coalesce(managed_since::text, 'none')] FROM public.compliance_types WHERE id = '00000000-0000-0000-0000-0000005a0a02'),
  array['none', 'none'], 'Leaving hands the form back and clears managed_since');

SELECT * FROM finish();

ROLLBACK;
