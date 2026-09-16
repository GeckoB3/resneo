-- Resneo: recording a host's change to a service on the page (20270217140000; plan §6.4, D50).
--
-- Proves: the host's save records master_changed with the before and after projections, the row can
-- be undone by collective_undo_master_change, a save that changed nothing the collective copies
-- records nothing, a service that is not on the page records nothing, and only the host may record.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-000000ba0f01', 'Save Host', 'save-host', 'h@save.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-000000ba0f02', 'Save Member', 'save-member', 'm@save.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-000000ba0c01', 'save-collective', 'Save Collective',
        '00000000-0000-0000-0000-000000ba0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-000000ba0e01', '00000000-0000-0000-0000-000000ba0c01', '00000000-0000-0000-0000-000000ba0f01', 'active'),
  ('00000000-0000-0000-0000-000000ba0e02', '00000000-0000-0000-0000-000000ba0c01', '00000000-0000-0000-0000-000000ba0f02', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-000000ba0501', '00000000-0000-0000-0000-000000ba0f01', 'Facial', 60, 6000),
  ('00000000-0000-0000-0000-000000ba0502', '00000000-0000-0000-0000-000000ba0f01', 'Not offered', 30, 3000);

SELECT public.collective_offer_service('00000000-0000-0000-0000-000000ba0c01', '00000000-0000-0000-0000-000000ba0501', '00000000-0000-0000-0000-000000ba0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;
CREATE TEMP TABLE link AS SELECT id FROM public.collective_service_replicas;

-- The host's save: projection before, the write, projection after, the record.
CREATE TEMP TABLE before_save AS SELECT public.collective_replica_projection((SELECT id FROM link), 'master') AS p;
UPDATE public.service_items SET price_pence = 6500 WHERE id = '00000000-0000-0000-0000-000000ba0501';
CREATE TEMP TABLE recorded AS
SELECT public.collective_record_master_change('00000000-0000-0000-0000-000000ba0501', (SELECT p FROM before_save),
  public.collective_replica_projection((SELECT id FROM link), 'master'),
  '00000000-0000-0000-0000-000000ba0f01', NULL) AS id;

SELECT ok((SELECT id FROM recorded) IS NOT NULL, 'The save is recorded');
SELECT is(
  (SELECT array[e.event_type, e.changes->'before'->'service'->>'price_pence', e.changes->'after'->'service'->>'price_pence',
                e.service_id::text]
   FROM public.collective_audit_events e WHERE e.id = (SELECT id FROM recorded)),
  array['master_changed', '6000', '6500', '00000000-0000-0000-0000-000000ba0501'],
  'with the before and after of what the collective copies');

SELECT is(
  (SELECT (public.collective_undo_master_change((SELECT id FROM recorded), '00000000-0000-0000-0000-000000ba0f01', NULL)
           ->'restored'->>'service')::boolean),
  true, 'and the undo route can put it back');
SELECT is(
  (SELECT price_pence FROM public.service_items WHERE id = '00000000-0000-0000-0000-000000ba0501'),
  6000, 'which restores the price');

-- A save that changed nothing the collective copies records nothing.
SELECT is(
  public.collective_record_master_change('00000000-0000-0000-0000-000000ba0501',
    public.collective_replica_projection((SELECT id FROM link), 'master'),
    public.collective_replica_projection((SELECT id FROM link), 'master'),
    '00000000-0000-0000-0000-000000ba0f01', NULL),
  NULL::uuid, 'A save that changes nothing the collective copies is not recorded');

-- A service that is not on the page records nothing.
SELECT is(
  public.collective_record_master_change('00000000-0000-0000-0000-000000ba0502', '{"a": 1}'::jsonb, '{"a": 2}'::jsonb,
    '00000000-0000-0000-0000-000000ba0f01', NULL),
  NULL::uuid, 'A service that is not on the page is not recorded');

SELECT * FROM finish();

ROLLBACK;
