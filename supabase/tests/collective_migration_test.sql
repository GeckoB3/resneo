-- Resneo: moving a collective from the older model to shared services (20270218220000; plan §7,
-- Appendix G; MIG-01, MIG-03, MIG-05, MIG-06).
--
-- Proves: the dry run reports the blockers, the replaced values and the option mapping and writes
-- nothing; the start snapshots bookings, creates the missing master, links every member copy as
-- 'migrated', maps options (an unmatched booked option kept inactive), clears the sync columns,
-- records one before-image per member and sends nothing; the drain writes the host's values while
-- every booking keeps its price; the finish switches the model and adopts the member-only service
-- the owner added, leaving the parked one alone; the rollback restores what was recorded except a
-- value edited since, releases the links and archives what the switch added; and it can run again.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(31);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000007a0f01', 'Mig Host', 'mig-host', 'h@mig.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000007a0f02', 'Mig Member', 'mig-member', 'm@mig.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000007a0c01', 'mig-collective', 'Mig Collective',
        '00000000-0000-0000-0000-0000007a0f01', 'active', 'unified_catalog', 'legacy_copies');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000007a0e01', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f01', 'active'),
  ('00000000-0000-0000-0000-0000007a0e02', '00000000-0000-0000-0000-0000007a0c01', '00000000-0000-0000-0000-0000007a0f02', 'active');

-- Host Haircut 25.00; the member's linked copy at 10.00. The member's Massage has no host source.
-- Nails and Wax are the member's own, not on the page.
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, capacity_per_session)
VALUES
  ('00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0f01', 'Haircut', 60, 2500, 1),
  ('00000000-0000-0000-0000-0000007a0502', '00000000-0000-0000-0000-0000007a0f02', 'Haircut', 45, 1000, 1),
  ('00000000-0000-0000-0000-0000007a0503', '00000000-0000-0000-0000-0000007a0f02', 'Massage', 30, 3000, 1),
  ('00000000-0000-0000-0000-0000007a0504', '00000000-0000-0000-0000-0000007a0f02', 'Nails', 30, 2000, 1),
  ('00000000-0000-0000-0000-0000007a0505', '00000000-0000-0000-0000-0000007a0f02', 'Wax', 15, 900, 1);
UPDATE public.service_items
SET synced_from_service_id = '00000000-0000-0000-0000-0000007a0501', sync_state = 'linked', synced_at = now()
WHERE id = '00000000-0000-0000-0000-0000007a0502';
INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence, sort_order, is_active)
VALUES
  ('00000000-0000-0000-0000-0000007a0601', '00000000-0000-0000-0000-0000007a0f01', '00000000-0000-0000-0000-0000007a0501', 'Long', 90, 3500, 1, true),
  ('00000000-0000-0000-0000-0000007a0602', '00000000-0000-0000-0000-0000007a0f02', '00000000-0000-0000-0000-0000007a0502', 'long', 80, 1500, 2, true),
  ('00000000-0000-0000-0000-0000007a0603', '00000000-0000-0000-0000-0000007a0f02', '00000000-0000-0000-0000-0000007a0502', 'Odd', 50, 1200, 5, true);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000007a0d01', '00000000-0000-0000-0000-0000007a0f01', 'Andrew'),
  ('00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0f02', 'John');
-- The member's Massage provider has no assignment yet (I4).
INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
VALUES
  ('00000000-0000-0000-0000-0000007a0d01', '00000000-0000-0000-0000-0000007a0501'),
  ('00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0502'),
  ('00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0504');
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-0000007a0a02', '00000000-0000-0000-0000-0000007a0f02', 'Sam', 'Guest', 'sam@mig.test');

INSERT INTO public.collective_service_items (id, collective_id, name, status)
VALUES
  ('00000000-0000-0000-0000-0000007a0901', '00000000-0000-0000-0000-0000007a0c01', 'Haircut (page)', 'active'),
  ('00000000-0000-0000-0000-0000007a0902', '00000000-0000-0000-0000-0000007a0c01', 'Massage', 'active');
INSERT INTO public.collective_service_providers (item_id, member_id, venue_id, source_service_id, practitioner_id, status, approval_status)
VALUES
  ('00000000-0000-0000-0000-0000007a0901', '00000000-0000-0000-0000-0000007a0e01', '00000000-0000-0000-0000-0000007a0f01',
   '00000000-0000-0000-0000-0000007a0501', '00000000-0000-0000-0000-0000007a0d01', 'active', 'approved'),
  ('00000000-0000-0000-0000-0000007a0901', '00000000-0000-0000-0000-0000007a0e02', '00000000-0000-0000-0000-0000007a0f02',
   '00000000-0000-0000-0000-0000007a0502', '00000000-0000-0000-0000-0000007a0d02', 'active', 'approved'),
  ('00000000-0000-0000-0000-0000007a0902', '00000000-0000-0000-0000-0000007a0e02', '00000000-0000-0000-0000-0000007a0f02',
   '00000000-0000-0000-0000-0000007a0503', '00000000-0000-0000-0000-0000007a0d02', 'active', 'approved');

-- The member's 10.00 Haircut at 10:00 (no snapshot yet), a booking on the unmatched option, and one on Nails.
INSERT INTO public.bookings (id, venue_id, guest_id, calendar_id, service_item_id, service_variant_id, booking_date,
  booking_time, booking_end_time, party_size, status, source, booking_model, deposit_status)
VALUES
  ('00000000-0000-0000-0000-0000007a0b01', '00000000-0000-0000-0000-0000007a0f02', '00000000-0000-0000-0000-0000007a0a02',
   '00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0502', NULL, DATE '2031-03-03', TIME '10:00',
   TIME '10:45', 1, 'Booked'::booking_status, 'phone'::booking_source, 'unified_scheduling'::booking_model, 'Not Required'),
  ('00000000-0000-0000-0000-0000007a0b02', '00000000-0000-0000-0000-0000007a0f02', '00000000-0000-0000-0000-0000007a0a02',
   '00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0502', '00000000-0000-0000-0000-0000007a0603',
   DATE '2031-03-03', TIME '12:00', TIME '12:50', 1, 'Booked'::booking_status, 'phone'::booking_source,
   'unified_scheduling'::booking_model, 'Not Required'),
  ('00000000-0000-0000-0000-0000007a0b03', '00000000-0000-0000-0000-0000007a0f02', '00000000-0000-0000-0000-0000007a0a02',
   '00000000-0000-0000-0000-0000007a0d02', '00000000-0000-0000-0000-0000007a0504', NULL, DATE '2031-03-04', TIME '09:00',
   TIME '09:30', 1, 'Booked'::booking_status, 'phone'::booking_source, 'unified_scheduling'::booking_model, 'Not Required');

-- As bookings made before the snapshot column existed.
UPDATE public.bookings SET service_price_snapshot_pence = NULL WHERE venue_id = '00000000-0000-0000-0000-0000007a0f02';

CREATE TEMP TABLE booking_hash AS
SELECT id, md5((to_jsonb(b) - 'service_price_snapshot_pence' - 'updated_at')::text) AS h
FROM public.bookings b WHERE venue_id = '00000000-0000-0000-0000-0000007a0f02';

CREATE TEMP TABLE choices AS SELECT jsonb_build_object(
  'needs_master', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000007a0902', 'choice', 'create')),
  'member_only', jsonb_build_array(
    jsonb_build_object('service_id', '00000000-0000-0000-0000-0000007a0504', 'choice', 'add_to_page'),
    jsonb_build_object('service_id', '00000000-0000-0000-0000-0000007a0505', 'choice', 'park'))) AS c;

-- ---------------------------------------------------------------------------------------------
-- MIG-01: the dry run.
-- ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE plan AS
SELECT public.collective_migration_plan('00000000-0000-0000-0000-0000007a0c01', (SELECT c FROM choices)) AS r;

SELECT is(
  (SELECT concat_ws('|', r->'p1'->>'count', r->'p2'->>'count', r->'p3'->>'count', r->'p4'->>'count', r->'p5'->>'count') FROM plan),
  '0|0|0|1|1', 'The dry run counts the blockers: an unmatched booked option (P4) and an offering with no host source (P5)');
SELECT is(
  (SELECT m->>'created_from_service_id' FROM plan, jsonb_array_elements(r->'masters') m
   WHERE m->>'item_id' = '00000000-0000-0000-0000-0000007a0902'),
  '00000000-0000-0000-0000-0000007a0503', 'The missing master is made from the earliest provider''s service');
SELECT is(
  (SELECT x->>'before' || '>' || (x->>'after') FROM plan, jsonb_array_elements(r->'links') l, jsonb_array_elements(l->'replaced') x
   WHERE l->>'copy_service_id' = '00000000-0000-0000-0000-0000007a0502' AND x->>'column' = 'price_pence'),
  '1000>2500', 'It lists each replaced value, before and after');
SELECT is(
  (SELECT string_agg(o->>'rule', ',' ORDER BY o->>'copy_variant_id') FROM plan, jsonb_array_elements(r->'links') l,
     jsonb_array_elements(l->'options') o
   WHERE l->>'copy_service_id' = '00000000-0000-0000-0000-0000007a0502'),
  'name,kept_inactive', 'Options map by name, and a booked option with no match is kept inactive');
SELECT is(
  (SELECT string_agg((m->>'name') || ':' || (m->>'choice'), ',' ORDER BY m->>'name') FROM plan, jsonb_array_elements(r->'member_only') m),
  'Nails:add_to_page,Wax:park', 'Member-only services carry the owner''s choice');
SELECT is(
  (SELECT (r->'page_copy'->0->'differs')::text FROM plan), '["name"]', 'The page''s own wording that the master replaces is listed');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01')
  + (SELECT count(*)::int FROM public.collective_service_replicas WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01')
  + (SELECT count(*)::int FROM public.bookings WHERE service_price_snapshot_pence IS NOT NULL
     AND venue_id = '00000000-0000-0000-0000-0000007a0f02'),
  0, 'and writes nothing');

-- ---------------------------------------------------------------------------------------------
-- The start.
-- ---------------------------------------------------------------------------------------------
SELECT public.collective_migration_begin('00000000-0000-0000-0000-0000007a0c01', (SELECT c FROM choices), NULL);

SELECT is(
  (SELECT service_model FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000007a0c01'),
  'migrating', 'The collective is migrating');
SELECT is(
  (SELECT string_agg(provenance || ':' || coalesce(replica_service_id::text, '-'), ',' ORDER BY replica_service_id)
   FROM public.collective_service_replicas WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01'),
  'migrated:00000000-0000-0000-0000-0000007a0502,migrated:00000000-0000-0000-0000-0000007a0503',
  'Each member copy is linked as migrated');
SELECT is(
  (SELECT string_agg(coalesce(service_price_snapshot_pence::text, '-'), ',' ORDER BY id) FROM public.bookings
   WHERE venue_id = '00000000-0000-0000-0000-0000007a0f02'),
  '1000,1200,-', 'Every booking on the page keeps the price it was made at');
SELECT is(
  (SELECT sync_state || '|' || coalesce(synced_from_service_id::text, '-') FROM public.service_items
   WHERE id = '00000000-0000-0000-0000-0000007a0502'),
  'independent|-', 'The copy''s sync columns are cleared');
SELECT is(
  (SELECT string_agg(coalesce(replica_of_variant_id::text, '-') || ':' || is_active, ',' ORDER BY sort_order)
   FROM public.service_variants WHERE service_item_id = '00000000-0000-0000-0000-0000007a0502'),
  '00000000-0000-0000-0000-0000007a0601:true,-:false', 'Options are mapped before any apply');
SELECT is(
  (SELECT s.venue_id::text || '|' || s.name || '|' || s.price_pence FROM public.collective_service_items i
   JOIN public.service_items s ON s.id = i.master_service_id WHERE i.id = '00000000-0000-0000-0000-0000007a0902'),
  '00000000-0000-0000-0000-0000007a0f01|Massage|3000', 'The missing master is created at the host');
SELECT is(
  (SELECT count(*)::int FROM public.calendar_service_assignments
   WHERE calendar_id = '00000000-0000-0000-0000-0000007a0d02' AND service_item_id = '00000000-0000-0000-0000-0000007a0503'),
  1, 'A provider''s missing calendar assignment is created');
SELECT is(
  (SELECT count(*)::int FROM public.collective_audit_events
   WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01' AND event_type = 'migration_applied'
     AND target_venue_id = '00000000-0000-0000-0000-0000007a0f02' AND changes->'before' ? 'copies'),
  1, 'One before-image is recorded for the member');
SELECT is(
  (SELECT count(*)::int FROM public.collective_operations
   WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01' AND kind = 'notice'),
  0, 'Nothing is sent');

-- ---------------------------------------------------------------------------------------------
-- The drain and the finish.
-- ---------------------------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT public.collective_migration_finish('00000000-0000-0000-0000-0000007a0c01', NULL) $$,
  'COLLECTIVE_LINKS_BEHIND%', 'The switch waits for every link');
SELECT public.collective_apply_replica(id, NULL, NULL, 'collective-migrate')
FROM public.collective_service_replicas WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01' ORDER BY id;
CREATE TEMP TABLE finished AS
SELECT public.collective_migration_finish('00000000-0000-0000-0000-0000007a0c01', NULL) AS r;

SELECT is(
  (SELECT service_model FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000007a0c01'),
  'replicas', 'The collective is on shared services');
SELECT is(
  (SELECT price_pence || '|' || duration_minutes FROM public.service_items WHERE id = '00000000-0000-0000-0000-0000007a0502'),
  '2500|60', 'The host''s values apply to the copy');
SELECT is(
  (SELECT string_agg(h, ',' ORDER BY id) FROM (
     SELECT id, md5((to_jsonb(b) - 'service_price_snapshot_pence' - 'updated_at')::text) AS h
     FROM public.bookings b WHERE venue_id = '00000000-0000-0000-0000-0000007a0f02') x),
  (SELECT string_agg(h, ',' ORDER BY id) FROM booking_hash),
  'while every booking row is untouched');
SELECT is(
  (SELECT r.provenance FROM public.collective_service_replicas r
   WHERE r.replica_service_id = '00000000-0000-0000-0000-0000007a0504' AND r.released_at IS NULL),
  'adopted', 'The service the owner added is on the page, as the member''s own row');
SELECT is(
  (SELECT is_active::text || '|' || (SELECT count(*) FROM public.collective_service_replicas
                                      WHERE replica_service_id = s.id)::text
   FROM public.service_items s WHERE id = '00000000-0000-0000-0000-0000007a0505'),
  'true|0', 'The parked service is left alone');
SELECT is(
  (SELECT count(*)::int FROM public.collective_operations
   WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01' AND kind = 'notice'),
  0, 'and still nothing is sent');

-- ---------------------------------------------------------------------------------------------
-- MIG-03: rollback, with the Massage copy changed since the switch.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.service_items DISABLE TRIGGER service_items_touch_updated_at;
DO $$
DECLARE v_prev text := public.collective_engine_enter();
BEGIN
  UPDATE public.service_items SET updated_at = updated_at + interval '1 hour'
  WHERE id = '00000000-0000-0000-0000-0000007a0503';
  PERFORM public.collective_engine_leave(v_prev);
END $$;
ALTER TABLE public.service_items ENABLE TRIGGER service_items_touch_updated_at;

CREATE TEMP TABLE rolled AS
SELECT public.collective_migration_rollback('00000000-0000-0000-0000-0000007a0c01', NULL, NULL) AS r;

SELECT is(
  (SELECT service_model FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000007a0c01'),
  'legacy_copies', 'Rollback puts the collective back on the older model');
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_replicas
   WHERE collective_id = '00000000-0000-0000-0000-0000007a0c01' AND released_at IS NULL),
  0, 'with every link released');
SELECT is(
  (SELECT price_pence || '|' || duration_minutes || '|' || sync_state || '|' || synced_from_service_id::text
   FROM public.service_items WHERE id = '00000000-0000-0000-0000-0000007a0502'),
  '1000|45|linked|00000000-0000-0000-0000-0000007a0501', 'The copy is restored as recorded');
SELECT is(
  (SELECT string_agg(name || ':' || is_active, ',' ORDER BY sort_order)
   FROM public.service_variants WHERE service_item_id = '00000000-0000-0000-0000-0000007a0502'),
  'long:true,Odd:true', 'with its options');
SELECT is(
  (SELECT r->'skipped'->0->>'service_id' FROM rolled),
  '00000000-0000-0000-0000-0000007a0503', 'A copy changed since the switch is listed, not restored');
SELECT is(
  (SELECT i.name || '|' || coalesce(i.master_service_id::text, '-') || '|' || i.status
   FROM public.collective_service_items i WHERE i.id = '00000000-0000-0000-0000-0000007a0901'),
  'Haircut (page)|-|active', 'The page is as it was');
SELECT is(
  (SELECT string_agg(i.status, ',') FROM public.collective_service_items i
   JOIN public.service_items s ON s.id = i.master_service_id
   WHERE s.name = 'Nails' AND s.venue_id = '00000000-0000-0000-0000-0000007a0f01' AND NOT s.is_active),
  'archived', 'and the service added at the switch is off it');

-- It can run again.
SELECT lives_ok(
  $$ SELECT public.collective_migration_begin('00000000-0000-0000-0000-0000007a0c01', (SELECT c FROM choices), NULL) $$,
  'The migration can be started again after a rollback');

SELECT * FROM finish();

ROLLBACK;
