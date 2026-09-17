-- Resneo: how far each venue has been told about the host's changes (20270217160000; N6, N7).
--
-- Proves: one mark per venue and kind, only the two kinds the notices use, and nothing for the
-- roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(5);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-000000bb0f01', 'Marks Host', 'marks-host', 'h@marks.test', 'appointments', 'active', 'unified_scheduling'),
       ('00000000-0000-0000-0000-000000bb0f02', 'Marks Member', 'marks-member', 'm@marks.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-000000bb0c01', 'marks-collective', 'Marks', '00000000-0000-0000-0000-000000bb0f01',
        'active', 'unified_catalog', 'replicas');

INSERT INTO public.collective_notice_marks (collective_id, venue_id, kind, sent_through)
VALUES ('00000000-0000-0000-0000-000000bb0c01', '00000000-0000-0000-0000-000000bb0f02', 'commercial', now());

SELECT is(
  (SELECT count(*)::int FROM public.collective_notice_marks),
  1, 'A mark is kept per venue and kind');

SELECT throws_ok(
  $$INSERT INTO public.collective_notice_marks (collective_id, venue_id, kind, sent_through)
    VALUES ('00000000-0000-0000-0000-000000bb0c01', '00000000-0000-0000-0000-000000bb0f02', 'commercial', now())$$,
  '23505', NULL, 'and only one');

SELECT throws_ok(
  $$INSERT INTO public.collective_notice_marks (collective_id, venue_id, kind, sent_through)
    VALUES ('00000000-0000-0000-0000-000000bb0c01', '00000000-0000-0000-0000-000000bb0f02', 'gossip', now())$$,
  '23514', NULL, 'for the two notices that use marks, and nothing else');

SELECT ok(
  NOT has_table_privilege('anon', 'public.collective_notice_marks', 'SELECT'),
  'A guest cannot read it');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.collective_notice_marks', 'SELECT'),
  'nor can a signed-in venue user');

SELECT * FROM finish();

ROLLBACK;
