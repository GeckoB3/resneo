-- Resneo: the collective invariant report (20270216180000; test plan §4).
--
-- Proves: on a converged replicas-model collective (options, add-ons, a form, calendars, a booking,
-- a member that left) every invariant reads 0; then each deliberate break is counted by its
-- invariant with the broken row among the samples: I3 drift, I5 a membership ended without its
-- release, I14 a cross-venue option, I33 a replica no calendar offers, I44 values written by an
-- outsider. Clients cannot call the report.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model, feature_flags)
VALUES
  ('00000000-0000-0000-0000-0000004a0f01', 'Inv Host', 'inv-host', 'host@inv.test', 'appointments', 'active', 'unified_scheduling', '{"compliance_records_enabled": true}'),
  ('00000000-0000-0000-0000-0000004a0f02', 'Inv Member', 'inv-member', 'member@inv.test', 'appointments', 'active', 'unified_scheduling', '{"compliance_records_enabled": true}'),
  ('00000000-0000-0000-0000-0000004a0f03', 'Inv Leaver', 'inv-leaver', 'leaver@inv.test', 'appointments', 'active', 'unified_scheduling', '{}'),
  ('00000000-0000-0000-0000-0000004a0f04', 'Inv Outsider', 'inv-outsider', 'outsider@inv.test', 'appointments', 'active', 'unified_scheduling', '{}');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000004a0c01', 'inv-collective', 'Inv Collective',
        '00000000-0000-0000-0000-0000004a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status, joined_at)
VALUES
  ('00000000-0000-0000-0000-0000004a0e01', '00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f01', 'active', now()),
  ('00000000-0000-0000-0000-0000004a0e02', '00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f02', 'active', now()),
  ('00000000-0000-0000-0000-0000004a0e03', '00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0f03', 'active', now());

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000004a0501', '00000000-0000-0000-0000-0000004a0f01', 'Pedicure', 45, 3500);
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000004a0b01', '00000000-0000-0000-0000-0000004a0f01', '00000000-0000-0000-0000-0000004a0501', 'Deluxe', 60, 4500);
INSERT INTO public.addon_groups (id, venue_id, name, selection_type)
VALUES ('00000000-0000-0000-0000-0000004a0a02', '00000000-0000-0000-0000-0000004a0f01', 'Polish', 'single');
INSERT INTO public.addons (addon_group_id, venue_id, name, additional_price_pence)
VALUES ('00000000-0000-0000-0000-0000004a0a02', '00000000-0000-0000-0000-0000004a0f01', 'Gel', 800);
INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id)
VALUES ('00000000-0000-0000-0000-0000004a0f01', '00000000-0000-0000-0000-0000004a0501', '00000000-0000-0000-0000-0000004a0a02');
INSERT INTO public.compliance_types (id, venue_id, name, slug, category, result_type, capture_methods)
VALUES ('00000000-0000-0000-0000-0000004a0a03', '00000000-0000-0000-0000-0000004a0f01', 'Foot health', 'foot-health', 'intake', 'completed', ARRAY['client_online']);
INSERT INTO public.compliance_type_versions (id, venue_id, compliance_type_id, version_number, form_schema)
VALUES ('00000000-0000-0000-0000-0000004a0b03', '00000000-0000-0000-0000-0000004a0f01', '00000000-0000-0000-0000-0000004a0a03', 1, '{"fields":[]}');
UPDATE public.compliance_types SET current_version_id = '00000000-0000-0000-0000-0000004a0b03' WHERE id = '00000000-0000-0000-0000-0000004a0a03';
INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement)
VALUES ('00000000-0000-0000-0000-0000004a0f01', '00000000-0000-0000-0000-0000004a0501', '00000000-0000-0000-0000-0000004a0a03', 'service', 'warn_staff');
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000004a0d01', '00000000-0000-0000-0000-0000004a0f01', 'Host chair'),
  ('00000000-0000-0000-0000-0000004a0d02', '00000000-0000-0000-0000-0000004a0f02', 'Member chair');

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000004a0c01', '00000000-0000-0000-0000-0000004a0501', '00000000-0000-0000-0000-0000004a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas ORDER BY id;
CREATE TEMP TABLE item AS SELECT id FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-0000004a0501';
CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id, id AS link FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-0000004a0f02';
SELECT public.collective_set_calendar_offering('00000000-0000-0000-0000-0000004a0c01', (SELECT id FROM item), v, c, 'assign', '00000000-0000-0000-0000-0000004a0f01', NULL)
FROM (VALUES ('00000000-0000-0000-0000-0000004a0f01'::uuid, '00000000-0000-0000-0000-0000004a0d01'::uuid),
             ('00000000-0000-0000-0000-0000004a0f02'::uuid, '00000000-0000-0000-0000-0000004a0d02'::uuid)) a(v, c);

-- A booking at the member, and a member that leaves properly.
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000004a0a09', '00000000-0000-0000-0000-0000004a0f02', 'Inv', 'Guest', 'guest@inv.test');
INSERT INTO public.bookings (venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time, booking_end_time,
  party_size, status, source, booking_model, collective_id)
VALUES ('00000000-0000-0000-0000-0000004a0f02', '00000000-0000-0000-0000-0000004a0a09', '00000000-0000-0000-0000-0000004a0d02',
  (SELECT id FROM replica), DATE '2031-02-02', TIME '09:00', TIME '09:45', 1, 'Booked'::booking_status, 'online'::booking_source,
  'unified_scheduling'::booking_model, '00000000-0000-0000-0000-0000004a0c01');
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-0000004a0e03';

CREATE TEMP TABLE clean AS SELECT * FROM public.collective_invariant_report(NULL, '00000000-0000-0000-0000-0000004a0c01');

SELECT is(
  (SELECT coalesce(array_agg(invariant || '=' || violations ORDER BY invariant), ARRAY[]::text[]) FROM clean WHERE violations <> 0),
  ARRAY[]::text[], 'A converged collective breaks no invariant');
SELECT ok((SELECT count(*) >= 29 FROM clean), 'and the report covers every invariant built so far');

-- Deliberate breaks, made under the engine flag to get past the locks.
SELECT set_config('resneo.collective_engine', 'on', true);
UPDATE public.service_items SET price_pence = 1 WHERE id = (SELECT id FROM replica);
UPDATE public.venue_collective_members SET status = 'removed' WHERE id = '00000000-0000-0000-0000-0000004a0e02';
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000004a0b09', '00000000-0000-0000-0000-0000004a0f04', '00000000-0000-0000-0000-0000004a0501', 'Stray', 30, 100);
DELETE FROM public.calendar_service_assignments WHERE calendar_id = '00000000-0000-0000-0000-0000004a0d02';
UPDATE public.calendar_service_assignments SET updated_by_venue_id = '00000000-0000-0000-0000-0000004a0f04'
WHERE calendar_id = '00000000-0000-0000-0000-0000004a0d01';
SELECT set_config('resneo.collective_engine', '', true);

CREATE TEMP TABLE broken AS SELECT * FROM public.collective_invariant_report(NULL, NULL);

SELECT ok((SELECT violations >= 1 AND (SELECT link FROM replica) = ANY (sample_ids) FROM broken WHERE invariant = 'I3'),
  'I3 counts a replica changed behind the engine''s back');
SELECT ok((SELECT violations >= 1 AND (SELECT link FROM replica) = ANY (sample_ids) FROM broken WHERE invariant = 'I5'),
  'I5 counts a live link whose membership ended without a release');
SELECT ok((SELECT violations >= 1 AND '00000000-0000-0000-0000-0000004a0b09'::uuid = ANY (sample_ids) FROM broken WHERE invariant = 'I14'),
  'I14 counts an option at another venue');
SELECT ok((SELECT violations >= 1 AND (SELECT link FROM replica) = ANY (sample_ids) FROM broken WHERE invariant = 'I33'),
  'I33 counts a replica no calendar offers');
SELECT ok((SELECT violations >= 1 FROM broken WHERE invariant = 'I44'),
  'I44 counts calendar values written by an outsider');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.collective_invariant_report(timestamptz, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.collective_invariant_report(timestamptz, uuid)', 'EXECUTE'),
  'Clients cannot read the report');

SELECT * FROM finish();

ROLLBACK;
