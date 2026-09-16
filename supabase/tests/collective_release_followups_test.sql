-- Resneo: the work after a release (20270218140000; plan §6.7 "The release", RT1-15).
--
-- Proves: a photo copy is recorded against the venue the release handed the service to, only for a
-- release_followup job and a service that job released; the review panel has its own mark; and
-- none of it is open to the roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-000000bc0f01', 'Photo Host', 'photo-host', 'h@photo.test', 'appointments', 'active', 'unified_scheduling'),
       ('00000000-0000-0000-0000-000000bc0f02', 'Photo Member', 'photo-member', 'm@photo.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-000000bc0c01', 'photo-collective', 'Photos', '00000000-0000-0000-0000-000000bc0f01',
        'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES ('00000000-0000-0000-0000-000000bc0e01', '00000000-0000-0000-0000-000000bc0c01',
        '00000000-0000-0000-0000-000000bc0f02', 'active');
INSERT INTO public.collective_service_items (id, collective_id, name, status)
VALUES ('00000000-0000-0000-0000-000000bc0b01', '00000000-0000-0000-0000-000000bc0c01', 'Cut', 'active');
INSERT INTO public.service_items (id, venue_id, name, duration_minutes)
VALUES ('00000000-0000-0000-0000-000000bc0d02', '00000000-0000-0000-0000-000000bc0f02', 'Cut', 30),
       ('00000000-0000-0000-0000-000000bc0d03', '00000000-0000-0000-0000-000000bc0f02', 'Own nails', 30);
INSERT INTO public.collective_service_replicas
  (collective_id, collective_service_item_id, member_id, venue_id, provenance, replica_service_id, released_at)
VALUES ('00000000-0000-0000-0000-000000bc0c01', '00000000-0000-0000-0000-000000bc0b01',
        '00000000-0000-0000-0000-000000bc0e01', '00000000-0000-0000-0000-000000bc0f02', 'created',
        '00000000-0000-0000-0000-000000bc0d02', now());
INSERT INTO public.collective_operations (id, collective_id, venue_id, kind, idempotency_key, progress)
VALUES ('00000000-0000-0000-0000-000000bc0a01', '00000000-0000-0000-0000-000000bc0c01',
        '00000000-0000-0000-0000-000000bc0f02', 'release_followup', 'release:photo-test', '{"reason":"left"}'),
       ('00000000-0000-0000-0000-000000bc0a02', '00000000-0000-0000-0000-000000bc0c01',
        '00000000-0000-0000-0000-000000bc0f02', 'notice', 'notice:photo-test', '{"notice":"N19"}');

SELECT isnt(
  public.collective_record_release_photo('00000000-0000-0000-0000-000000bc0a01', '00000000-0000-0000-0000-000000bc0d02',
                                         true, 'copied'),
  NULL, 'A copied photo is recorded');
SELECT is(
  (SELECT event_type || '|' || target_venue_id::text || '|' || system_job FROM public.collective_audit_events
   WHERE service_id = '00000000-0000-0000-0000-000000bc0d02'),
  'photo_copied|00000000-0000-0000-0000-000000bc0f02|collective-release',
  'against the venue that now owns the service, by the release job');

SELECT is(
  public.collective_record_release_photo('00000000-0000-0000-0000-000000bc0a01', '00000000-0000-0000-0000-000000bc0d03',
                                         false, 'nope'),
  NULL, 'Nothing is recorded for a service the release did not hand over');
SELECT is(
  public.collective_record_release_photo('00000000-0000-0000-0000-000000bc0a02', '00000000-0000-0000-0000-000000bc0d02',
                                         false, 'nope'),
  NULL, 'nor for a job that is not a release follow-up');

SELECT isnt(
  public.collective_record_release_photo('00000000-0000-0000-0000-000000bc0a01', '00000000-0000-0000-0000-000000bc0d02',
                                         false, 'the file was gone'),
  NULL, 'A failed copy is recorded too');

INSERT INTO public.collective_notice_marks (collective_id, venue_id, kind, sent_through)
VALUES ('00000000-0000-0000-0000-000000bc0c01', '00000000-0000-0000-0000-000000bc0f02', 'review', now());
SELECT is(
  (SELECT count(*)::int FROM public.collective_notice_marks WHERE kind = 'review'),
  1, 'The review panel keeps how far it was dismissed');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_record_release_photo(uuid, uuid, boolean, text, timestamptz)', 'EXECUTE'),
  'A signed-in venue user cannot record a copy');
SELECT ok(
  NOT has_function_privilege('anon',
    'public.collective_record_release_photo(uuid, uuid, boolean, text, timestamptz)', 'EXECUTE'),
  'nor can a guest');

SELECT * FROM finish();

ROLLBACK;
