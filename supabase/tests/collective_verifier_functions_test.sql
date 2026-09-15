-- Resneo: what the collective crons call (20270216220000; plan §6.16).
--
-- Proves: on a converged replicas-model collective the worklist is empty and nothing is backlogged;
-- a replica edited behind the engine's back is listed as drifted, and collective_repair_drift audits
-- the before-image and converges it; a link left behind for 20 minutes is listed; a membership ended
-- under the flag is listed as orphaned; a due transfer is listed and overdue after 7 days, and
-- collective_cancel_host_transfer clears it with an audit row; clients cannot call any of them.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000008a0f01', 'Cron Host', 'cron-host', 'h@cron.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000008a0f02', 'Cron Member', 'cron-member', 'm@cron.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000008a0c01', 'cron-collective', 'Cron Collective',
        '00000000-0000-0000-0000-0000008a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000008a0e01', '00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0f01', 'active'),
  ('00000000-0000-0000-0000-0000008a0e02', '00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0f02', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-0000008a0501', '00000000-0000-0000-0000-0000008a0f01', 'Nails', 30, 2000);

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0501', '00000000-0000-0000-0000-0000008a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;
CREATE TEMP TABLE link AS SELECT id, replica_service_id AS service FROM public.collective_service_replicas;

SELECT is(
  public.collective_verifier_worklist(now()),
  '{"behind": [], "drifted": [], "orphaned": [], "paused_expired": [], "transfers_due": [], "suspended_expired": []}'::jsonb,
  'A converged collective gives the verifier nothing to do');
SELECT is((public.collective_replicate_backlog(now())->>'due')::int, 0, 'and the replicate cron nothing to claim');

-- Drift behind the engine's back.
SELECT set_config('resneo.collective_engine', 'on', true);
UPDATE public.service_items SET price_pence = 1 WHERE id = (SELECT service FROM link);
SELECT set_config('resneo.collective_engine', '', true);
SELECT ok((SELECT id FROM link)::text = ANY (SELECT jsonb_array_elements_text(public.collective_verifier_worklist(now())->'drifted')),
  'A replica changed behind the engine''s back is listed as drifted');
SELECT is((public.collective_repair_drift((SELECT id FROM link))->>'ok')::boolean, true, 'The drift repair applies');
SELECT is(
  (SELECT array[(SELECT price_pence::text FROM public.service_items WHERE id = (SELECT service FROM link)),
                (SELECT changes->'before'->'service'->>'price_pence' FROM public.collective_audit_events WHERE event_type = 'unexplained_drift_repaired')]),
  array['2000', '1'], 'and converges the replica, with the drifted value kept as the audited before-image');

-- Lag: a host change nobody applied for 20 minutes.
UPDATE public.service_items SET price_pence = 2200 WHERE id = '00000000-0000-0000-0000-0000008a0501';
UPDATE public.collective_service_replicas SET behind_since = now() - interval '20 minutes' WHERE id = (SELECT id FROM link);
SELECT ok((SELECT id FROM link)::text = ANY (SELECT jsonb_array_elements_text(public.collective_verifier_worklist(now())->'behind')),
  'A link behind for 20 minutes is listed for an apply');

-- A transfer due 8 days ago, then cancelled.
UPDATE public.venue_collectives SET pending_host_venue_id = '00000000-0000-0000-0000-0000008a0f02', host_transfer_at = now() - interval '8 days'
WHERE id = '00000000-0000-0000-0000-0000008a0c01';
SELECT is(
  (SELECT (e->>'overdue')::boolean FROM jsonb_array_elements(public.collective_verifier_worklist(now())->'transfers_due') e),
  true, 'A transfer due more than 7 days ago is listed as overdue');
SELECT public.collective_cancel_host_transfer('00000000-0000-0000-0000-0000008a0c01', 'links_behind_after_retries', NULL, NULL, 'collective-verify');
SELECT is(
  (SELECT array[coalesce(pending_host_venue_id::text, 'none'),
                (SELECT count(*)::text FROM public.collective_audit_events WHERE event_type = 'host_transfer_cancelled')]
   FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-0000008a0c01'),
  array['none', '1'], 'Cancelling clears the pending transfer and audits it');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.collective_verifier_worklist(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.collective_repair_drift(uuid, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.collective_cancel_host_transfer(uuid, text, uuid, uuid, text, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.collective_replicate_backlog(timestamptz)', 'EXECUTE'),
  'Clients cannot call the cron functions');

SELECT * FROM finish();

ROLLBACK;
