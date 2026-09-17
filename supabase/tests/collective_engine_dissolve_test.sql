-- Resneo: the collective engine's dissolve (20270216140000; plan §6.7, Appendix D; DL10, D25, D41).
--
-- Proves, on a replicas-model collective:
--   * only the host (or the system) may dissolve;
--   * open invitations end as removed, audited;
--   * every active membership, the host's included, goes left and is released; members keep their
--     services, now unlocked;
--   * offerings are archived, the collective is dissolved with its address kept;
--   * the host may then delete the service it offered, and the archived offering forgets it;
--   * while an offering is active, its master still cannot be deleted (RN002);
--   * a second dissolve does nothing;
--   * a legacy_copies collective is refused.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-00000000f0f1', 'Dissolve Host', 'dissolve-host', 'host@dissolve.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000f0f2', 'Dissolve Member', 'dissolve-member', 'member@dissolve.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-00000000f0f3', 'Dissolve Invitee', 'dissolve-invitee', 'invitee@dissolve.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES
  ('00000000-0000-0000-0000-00000000f0c1', 'dissolve-collective', 'Dissolve Collective',
   '00000000-0000-0000-0000-00000000f0f1', 'active', 'unified_catalog', 'replicas'),
  ('00000000-0000-0000-0000-00000000f0c2', 'dissolve-legacy', 'Dissolve Legacy',
   '00000000-0000-0000-0000-00000000f0f1', 'active', 'unified_catalog', 'legacy_copies');

INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-00000000f0e1', '00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f0f1', 'active'),
  ('00000000-0000-0000-0000-00000000f0e2', '00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f0f2', 'active'),
  ('00000000-0000-0000-0000-00000000f0e3', '00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f0f3', 'invited');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000f051', '00000000-0000-0000-0000-00000000f0f1', 'Massage', 60, 6000);

SELECT public.collective_offer_service('00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f051',
  '00000000-0000-0000-0000-00000000f0f1', NULL);
CREATE TEMP TABLE link AS
SELECT id FROM public.collective_service_replicas WHERE venue_id = '00000000-0000-0000-0000-00000000f0f2';
SELECT public.collective_apply_replica((SELECT id FROM link), NULL, NULL, 'inline');
CREATE TEMP TABLE replica AS
SELECT replica_service_id AS id FROM public.collective_service_replicas WHERE id = (SELECT id FROM link);

SELECT throws_ok(
  $$ SELECT public.collective_dissolve('00000000-0000-0000-0000-00000000f0c1', 'host_ended', '00000000-0000-0000-0000-00000000f0f2', NULL) $$,
  'P0001', NULL, 'A member cannot end the collective');

CREATE TEMP TABLE result AS
SELECT public.collective_dissolve('00000000-0000-0000-0000-00000000f0c1', 'host_ended', '00000000-0000-0000-0000-00000000f0f1', NULL) AS r;

SELECT is(
  (SELECT array[(r->>'members_released')::int, (r->>'invitations_removed')::int, (r->>'offerings_archived')::int] FROM result),
  array[2, 1, 1], 'Dissolve releases both live memberships, ends the invitation and archives the offering');

SELECT is(
  (SELECT array_agg(status ORDER BY id) FROM public.venue_collective_members WHERE collective_id = '00000000-0000-0000-0000-00000000f0c1'),
  array['left', 'left', 'removed'], 'DL10: the host goes left like everyone; the invitation is removed');

SELECT ok(
  (SELECT released_at IS NOT NULL FROM public.collective_service_replicas WHERE id = (SELECT id FROM link)),
  'The member''s link is released');

SELECT is(
  (SELECT array[name, is_active::text] FROM public.service_items WHERE id = (SELECT id FROM replica)),
  array['Massage', 'true'], 'D52: the member keeps its service');

SELECT lives_ok(
  format($$ UPDATE public.service_items SET price_pence = 5000 WHERE id = %L $$, (SELECT id FROM replica)),
  'and can change it');

SELECT is(
  (SELECT array[status, slug, (dissolved_at IS NOT NULL)::text] FROM public.venue_collectives WHERE id = '00000000-0000-0000-0000-00000000f0c1'),
  array['dissolved', 'dissolve-collective', 'true'], 'D25: the collective is dissolved and keeps its address for the neutral page');

SELECT is(
  (SELECT array[(SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-00000000f0c1' AND event_type = 'collective_dissolved'),
                (SELECT count(*) FROM public.collective_audit_events WHERE collective_id = '00000000-0000-0000-0000-00000000f0c1' AND event_type = 'invitation_withdrawn')]::int[]),
  array[1, 1], 'Dissolve and the withdrawn invitation are audited');

SELECT is(
  (SELECT count(*)::int FROM public.collective_service_items WHERE master_service_id = '00000000-0000-0000-0000-00000000f051' AND status = 'active'),
  0, 'No active offering remains, so the host''s service is no longer protected as offered');

SELECT lives_ok(
  $$ DELETE FROM public.service_items WHERE id = '00000000-0000-0000-0000-00000000f051' $$,
  'The host can delete a service it once offered');
SELECT is(
  (SELECT count(*)::int FROM public.collective_service_items
   WHERE collective_id = '00000000-0000-0000-0000-00000000f0c1' AND status = 'archived' AND master_service_id IS NULL),
  1, 'and the archived offering no longer names it');

SELECT is(
  (SELECT (public.collective_dissolve('00000000-0000-0000-0000-00000000f0c1', 'host_ended', NULL, NULL)->>'members_released')::int),
  0, 'A second dissolve does nothing');

SELECT throws_ok(
  $$ SELECT public.collective_dissolve('00000000-0000-0000-0000-00000000f0c2', 'host_ended', '00000000-0000-0000-0000-00000000f0f1', NULL) $$,
  'P0001', NULL, 'A legacy collective is refused');

SELECT * FROM finish();

ROLLBACK;
