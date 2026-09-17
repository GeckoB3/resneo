-- Resneo: re-offering reconnects only unchanged services (20270216170000; plan DL5, RT2-27).
--
-- Proves: after a member leaves and rejoins while two offerings are withdrawn, re-offering them
-- reconnects the member's released service that is unchanged since its release, and gives the one
-- changed since a new link, leaving the changed service's old link released.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000003a0f01', 'Reoffer Host', 'reoffer-host', 'host@reoffer.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000003a0f02', 'Reoffer Member', 'reoffer-member', 'member@reoffer.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000003a0c01', 'reoffer-collective', 'Reoffer Collective',
        '00000000-0000-0000-0000-0000003a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000003a0e01', '00000000-0000-0000-0000-0000003a0c01', '00000000-0000-0000-0000-0000003a0f01', 'active'),
  ('00000000-0000-0000-0000-0000003a0e02', '00000000-0000-0000-0000-0000003a0c01', '00000000-0000-0000-0000-0000003a0f02', 'active');
INSERT INTO public.account_links (venue_low_id, venue_high_id, requested_by_venue_id, status,
  low_grants_calendar, low_grants_pii, low_grants_act, high_grants_calendar, high_grants_pii, high_grants_act)
VALUES ('00000000-0000-0000-0000-0000003a0f01', '00000000-0000-0000-0000-0000003a0f02', '00000000-0000-0000-0000-0000003a0f01', 'accepted',
  'full_details', true, 'create_edit_cancel', 'full_details', true, 'create_edit_cancel');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000003a05a1', '00000000-0000-0000-0000-0000003a0f01', 'Unchanged', 30, 3000),
  ('00000000-0000-0000-0000-0000003a05b1', '00000000-0000-0000-0000-0000003a0f01', 'Changed', 30, 3000);

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000003a0c01', s, '00000000-0000-0000-0000-0000003a0f01', NULL)
FROM unnest(ARRAY['00000000-0000-0000-0000-0000003a05a1', '00000000-0000-0000-0000-0000003a05b1']::uuid[]) s;
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas ORDER BY id;
CREATE TEMP TABLE first_links AS
SELECT i.master_service_id AS master, l.id, l.replica_service_id FROM public.collective_service_replicas l
JOIN public.collective_service_items i ON i.id = l.collective_service_item_id;

-- Withdraw both, the member leaves, and time passes: A untouched since, B changed after its release.
SELECT public.collective_withdraw_service(id, '00000000-0000-0000-0000-0000003a0f01', NULL)
FROM public.collective_service_items WHERE collective_id = '00000000-0000-0000-0000-0000003a0c01';
UPDATE public.venue_collective_members SET status = 'left' WHERE id = '00000000-0000-0000-0000-0000003a0e02';
SELECT set_config('resneo.collective_engine', 'on', true);
UPDATE public.collective_service_replicas SET released_at = now() + interval '1 minute'
WHERE id = (SELECT id FROM first_links WHERE master = '00000000-0000-0000-0000-0000003a05a1');
UPDATE public.collective_service_replicas SET released_at = now() - interval '1 minute'
WHERE id = (SELECT id FROM first_links WHERE master = '00000000-0000-0000-0000-0000003a05b1');
SELECT set_config('resneo.collective_engine', '', true);

-- Rejoin, then re-offer both.
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES ('00000000-0000-0000-0000-0000003a0e03', '00000000-0000-0000-0000-0000003a0c01', '00000000-0000-0000-0000-0000003a0f02', 'invited');
SELECT public.collective_join_member('00000000-0000-0000-0000-0000003a0e03', 'v1', '{}'::jsonb, '00000000-0000-0000-0000-0000003a0f02', NULL);
SELECT public.collective_offer_service('00000000-0000-0000-0000-0000003a0c01', s, '00000000-0000-0000-0000-0000003a0f01', NULL)
FROM unnest(ARRAY['00000000-0000-0000-0000-0000003a05a1', '00000000-0000-0000-0000-0000003a05b1']::uuid[]) s;

SELECT is(
  (SELECT array[provenance, (released_at IS NULL)::text, member_id::text] FROM public.collective_service_replicas
   WHERE id = (SELECT id FROM first_links WHERE master = '00000000-0000-0000-0000-0000003a05a1')),
  array['reconnected', 'true', '00000000-0000-0000-0000-0000003a0e03'],
  'Re-offering reconnects the member''s unchanged released service');
SELECT is(
  (SELECT array[l.provenance, coalesce(l.replica_service_id::text, 'none')] FROM public.collective_service_replicas l
   JOIN public.collective_service_items i ON i.id = l.collective_service_item_id
   WHERE i.master_service_id = '00000000-0000-0000-0000-0000003a05b1' AND l.released_at IS NULL),
  array['created', 'none'], 'DL5: a service changed since its release gets a new link');
SELECT ok(
  (SELECT released_at IS NOT NULL FROM public.collective_service_replicas
   WHERE id = (SELECT id FROM first_links WHERE master = '00000000-0000-0000-0000-0000003a05b1')),
  'and its old link stays released, so the member keeps the changed service as its own');

SELECT * FROM finish();

ROLLBACK;
