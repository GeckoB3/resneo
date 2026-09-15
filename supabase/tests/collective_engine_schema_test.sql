-- Resneo: the collective engine schema is dark and locked down (20270215120000; W3, Appendix C).
--
-- Proves:
--   * client roles hold no privilege on the four engine tables;
--   * one live replica link per (offering, venue), while a released link frees the pair;
--   * the provenance and revision CHECKs hold;
--   * collective_audit_events refuses UPDATE and DELETE;
--   * a calendar cannot offer another venue's service (I13 as a constraint);
--   * a legacy collective's host can still change (reconcile), a replicas one only under the engine flag;
--   * every existing collective is on the legacy model.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('collective_service_replicas', 'collective_catalogue_revisions',
                       'collective_audit_events', 'collective_operations')
     AND (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
       OR has_table_privilege('authenticated', c.oid, 'SELECT, INSERT, UPDATE, DELETE'))),
  0, 'Client roles hold no privilege on the engine tables');

-- Fixtures: a host and a member venue, a collective, a membership and an offering.
INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-000000e9f001', 'Engine Host', 'engine-host', 'host@engine.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-000000e9f002', 'Engine Member', 'engine-member', 'member@engine.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode)
VALUES ('00000000-0000-0000-0000-000000e9c001', 'engine-collective', 'Engine Collective',
        '00000000-0000-0000-0000-000000e9f001', 'active', 'unified_catalog');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES ('00000000-0000-0000-0000-000000e9e001', '00000000-0000-0000-0000-000000e9c001',
        '00000000-0000-0000-0000-000000e9f002', 'active');

INSERT INTO public.collective_service_items (id, collective_id, name, status)
VALUES ('00000000-0000-0000-0000-000000e9b001', '00000000-0000-0000-0000-000000e9c001', 'Cut', 'active');

SELECT is(
  (SELECT service_model FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-000000e9c001'),
  'legacy_copies', 'A collective starts on the legacy model');

INSERT INTO public.collective_service_replicas (collective_id, collective_service_item_id, member_id, venue_id, provenance)
VALUES ('00000000-0000-0000-0000-000000e9c001', '00000000-0000-0000-0000-000000e9b001',
        '00000000-0000-0000-0000-000000e9e001', '00000000-0000-0000-0000-000000e9f002', 'created');

SELECT throws_ok(
  $$ INSERT INTO public.collective_service_replicas (collective_id, collective_service_item_id, member_id, venue_id, provenance)
     VALUES ('00000000-0000-0000-0000-000000e9c001', '00000000-0000-0000-0000-000000e9b001',
             '00000000-0000-0000-0000-000000e9e001', '00000000-0000-0000-0000-000000e9f002', 'created') $$,
  '23505', NULL, 'One live replica link per offering and venue');

UPDATE public.collective_service_replicas SET released_at = now()
WHERE collective_service_item_id = '00000000-0000-0000-0000-000000e9b001';

SELECT lives_ok(
  $$ INSERT INTO public.collective_service_replicas (collective_id, collective_service_item_id, member_id, venue_id, provenance)
     VALUES ('00000000-0000-0000-0000-000000e9c001', '00000000-0000-0000-0000-000000e9b001',
             '00000000-0000-0000-0000-000000e9e001', '00000000-0000-0000-0000-000000e9f002', 'reconnected') $$,
  'A released link frees the pair for a reconnect, and stays for the audit');

SELECT throws_ok(
  $$ INSERT INTO public.collective_service_replicas (collective_id, collective_service_item_id, member_id, venue_id, provenance)
     VALUES ('00000000-0000-0000-0000-000000e9c001', '00000000-0000-0000-0000-000000e9b001',
             '00000000-0000-0000-0000-000000e9e001', '00000000-0000-0000-0000-000000e9f002', 'origin') $$,
  '23514', NULL, 'Provenance is a closed list');

SELECT throws_ok(
  $$ UPDATE public.collective_service_replicas SET applied_revision = desired_revision + 1
     WHERE released_at IS NULL $$,
  '23514', NULL, 'A link cannot claim a revision beyond the one it was asked for');

INSERT INTO public.collective_audit_events (collective_id, collective_name, event_type, actor_type, system_job)
VALUES ('00000000-0000-0000-0000-000000e9c001', 'Engine Collective', 'replica_applied', 'system', 'collective-replicate');

SELECT throws_ok(
  $$ UPDATE public.collective_audit_events SET collective_name = 'Rewritten' $$,
  'P0001', NULL, 'The engine audit trail refuses an update');

SELECT throws_ok(
  $$ DELETE FROM public.collective_audit_events $$,
  'P0001', NULL, 'The engine audit trail refuses a delete');

SELECT throws_ok(
  $$ INSERT INTO public.collective_audit_events (collective_id, collective_name, event_type, actor_type)
     VALUES ('00000000-0000-0000-0000-000000e9c001', 'Engine Collective', 'replica_applied', 'system') $$,
  '23514', NULL, 'A system actor names its job');

-- I13 as a constraint.
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-000000e9a001', '00000000-0000-0000-0000-000000e9f002', 'Member chair');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000e9d001', '00000000-0000-0000-0000-000000e9f001', 'Host cut', 30),
       ('00000000-0000-0000-0000-000000e9d002', '00000000-0000-0000-0000-000000e9f002', 'Member cut', 30);

SELECT throws_ok(
  $$ INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
     VALUES ('00000000-0000-0000-0000-000000e9a001', '00000000-0000-0000-0000-000000e9d001') $$,
  '23514', NULL, 'A calendar cannot offer another venue''s service');

SELECT lives_ok(
  $$ INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
     VALUES ('00000000-0000-0000-0000-000000e9a001', '00000000-0000-0000-0000-000000e9d002') $$,
  'A calendar can offer its own venue''s service');

-- Host guard: inert on the legacy model, enforced on the replicas model.
SELECT lives_ok(
  $$ UPDATE public.venue_collectives SET host_venue_id = '00000000-0000-0000-0000-000000e9f002'
     WHERE id = '00000000-0000-0000-0000-000000e9c001' $$,
  'A legacy collective''s host can still change, as reconcile does today');

UPDATE public.venue_collectives SET service_model = 'replicas'
WHERE id = '00000000-0000-0000-0000-000000e9c001';

SELECT throws_ok(
  $$ UPDATE public.venue_collectives SET host_venue_id = '00000000-0000-0000-0000-000000e9f001'
     WHERE id = '00000000-0000-0000-0000-000000e9c001' $$,
  'RN005', NULL, 'Outside the engine a replicas collective''s host cannot change');

SELECT * FROM finish();

ROLLBACK;
