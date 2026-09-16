-- Resneo: invitations on the shared-services model (20270218170000; plan §6.7, DL8; N34, N35).
--
-- Proves: the host's invitation is audited; the host (only) withdraws one and the invitee is to
-- be told; the system (only) expires one and both sides are to be told; an answered invitation is
-- never closed; and neither function is open to the roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(10);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000006a0f01', 'Invite Host', 'invite-host', 'host@invite.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000006a0f02', 'Invite One', 'invite-one', 'one@invite.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000006a0f03', 'Invite Two', 'invite-two', 'two@invite.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000006a0f04', 'Invite Three', 'invite-three', 'three@invite.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000006a0c01', 'invite-collective', 'Invite Collective',
        '00000000-0000-0000-0000-0000006a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000006a0e01', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f01', 'active'),
  ('00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02', 'invited'),
  ('00000000-0000-0000-0000-0000006a0e03', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f03', 'invited'),
  ('00000000-0000-0000-0000-0000006a0e04', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f04', 'active');

SELECT isnt(
  public.collective_record_invitation('00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0f01', NULL),
  NULL, 'The host''s invitation is audited');

SELECT throws_like(
  $$ SELECT public.collective_close_invitation('00000000-0000-0000-0000-0000006a0e02', 'withdrawn',
       '00000000-0000-0000-0000-0000006a0f04', NULL) $$,
  'COLLECTIVE_NOT_HOST%', 'Only the host withdraws an invitation');

SELECT isnt(
  public.collective_close_invitation('00000000-0000-0000-0000-0000006a0e02', 'withdrawn',
    '00000000-0000-0000-0000-0000006a0f01', NULL),
  NULL, 'The host withdraws one');
SELECT is(
  (SELECT status FROM public.venue_collective_members WHERE id = '00000000-0000-0000-0000-0000006a0e02'),
  'removed', 'and it closes');
SELECT is(
  (SELECT progress->>'notice' FROM public.collective_operations
   WHERE idempotency_key = 'invitation:00000000-0000-0000-0000-0000006a0e02'),
  'N34', 'and the invitee is to be told');

SELECT throws_like(
  $$ SELECT public.collective_close_invitation('00000000-0000-0000-0000-0000006a0e03', 'expired',
       '00000000-0000-0000-0000-0000006a0f01', NULL) $$,
  'collective_close_invitation: only the system%', 'Only the system expires one');
SELECT public.collective_close_invitation('00000000-0000-0000-0000-0000006a0e03', 'expired', NULL, NULL);
SELECT is(
  (SELECT event_type || '|' || system_job FROM public.collective_audit_events
   WHERE target_venue_id = '00000000-0000-0000-0000-0000006a0f03' AND event_type = 'invitation_expired'),
  'invitation_expired|collective-invitations', 'An expiry is the system''s');
SELECT is(
  (SELECT progress->>'notice' FROM public.collective_operations
   WHERE idempotency_key = 'invitation:00000000-0000-0000-0000-0000006a0e03'),
  'N35', 'and both sides are to be told');

SELECT is(
  public.collective_close_invitation('00000000-0000-0000-0000-0000006a0e04', 'expired', NULL, NULL),
  NULL, 'An answered invitation is never closed');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_close_invitation(uuid, text, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_record_invitation(uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'Neither is open to the roles a browser holds');

SELECT * FROM finish();

ROLLBACK;
