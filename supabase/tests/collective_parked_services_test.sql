-- Resneo: parked services (20270217120000; plan §6.6, D2).
--
-- Proves, on a replicas-model collective:
--   * the live state and bookable services: the host's masters of active offerings, the member's live
--     replicas; nothing is parked at a venue outside a live collective;
--   * a new booking for a parked service is refused (RN007) at the host and at a member, while the
--     collective's services book normally;
--   * an existing booking on a parked service stays manageable: its status and time can change;
--     moving a booking onto a parked service is refused;
--   * a withdrawn offering's master is parked at the host;
--   * parking lifts when the member is suspended, when the page pauses, and on a legacy_copies
--     collective nothing is ever parked.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(13);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000009a0f01', 'Park Host', 'park-host', 'h@park.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000009a0f02', 'Park Member', 'park-member', 'm@park.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000009a0f03', 'Park Outsider', 'park-outsider', 'o@park.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000009a0c01', 'park-collective', 'Park Collective',
        '00000000-0000-0000-0000-0000009a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000009a0e01', '00000000-0000-0000-0000-0000009a0c01', '00000000-0000-0000-0000-0000009a0f01', 'active'),
  ('00000000-0000-0000-0000-0000009a0e02', '00000000-0000-0000-0000-0000009a0c01', '00000000-0000-0000-0000-0000009a0f02', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000009a0501', '00000000-0000-0000-0000-0000009a0f01', 'On the page', 30, 3000),
  ('00000000-0000-0000-0000-0000009a0502', '00000000-0000-0000-0000-0000009a0f01', 'Host only', 30, 3000),
  ('00000000-0000-0000-0000-0000009a0503', '00000000-0000-0000-0000-0000009a0f02', 'Member only', 30, 3000),
  ('00000000-0000-0000-0000-0000009a0504', '00000000-0000-0000-0000-0000009a0f03', 'Outsider', 30, 3000);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0f01', 'Host room'),
  ('00000000-0000-0000-0000-0000009a0d02', '00000000-0000-0000-0000-0000009a0f02', 'Member room'),
  ('00000000-0000-0000-0000-0000009a0d03', '00000000-0000-0000-0000-0000009a0f03', 'Outsider room');
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES
  ('00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0f01', 'Host', 'Guest', 'hg@park.test'),
  ('00000000-0000-0000-0000-0000009a0a02', '00000000-0000-0000-0000-0000009a0f02', 'Member', 'Guest', 'mg@park.test'),
  ('00000000-0000-0000-0000-0000009a0a03', '00000000-0000-0000-0000-0000009a0f03', 'Out', 'Guest', 'og@park.test');

-- A booking on the member's own service made before anything was offered: it stays manageable.
SELECT set_config('resneo.collective_engine', 'on', true);
INSERT INTO public.bookings (id, venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time, booking_end_time,
  party_size, status, source, booking_model)
VALUES ('00000000-0000-0000-0000-0000009a0b01', '00000000-0000-0000-0000-0000009a0f02', '00000000-0000-0000-0000-0000009a0a02',
  '00000000-0000-0000-0000-0000009a0d02', '00000000-0000-0000-0000-0000009a0503', DATE '2031-03-03', TIME '10:00', TIME '10:30', 1,
  'Booked'::booking_status, 'online'::booking_source, 'unified_scheduling'::booking_model);
SELECT set_config('resneo.collective_engine', '', true);

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000009a0c01', '00000000-0000-0000-0000-0000009a0501', '00000000-0000-0000-0000-0000009a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;
CREATE TEMP TABLE replica AS SELECT replica_service_id AS id FROM public.collective_service_replicas;

CREATE OR REPLACE FUNCTION pg_temp.book(p_venue uuid, p_guest uuid, p_cal uuid, p_service uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$ INSERT INTO public.bookings (venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time,
    booking_end_time, party_size, status, source, booking_model)
    VALUES (%L, %L, %L, %L, DATE '2031-03-04', TIME '11:00', TIME '11:30', 1, 'Booked'::booking_status, 'online'::booking_source,
    'unified_scheduling'::booking_model) $q$, p_venue, p_guest, p_cal, p_service)
$$;

SELECT is(
  (SELECT array[public.collective_venue_live_state('00000000-0000-0000-0000-0000009a0f01')->>'role',
                public.collective_venue_live_state('00000000-0000-0000-0000-0000009a0f02')->>'role',
                coalesce(public.collective_venue_live_state('00000000-0000-0000-0000-0000009a0f03')::text, 'none')]),
  array['host', 'member', 'none'], 'One answer: host, member, and no collective for an outsider');
SELECT is(
  (SELECT array[public.collective_bookable_service_ids('00000000-0000-0000-0000-0000009a0f01'),
                public.collective_bookable_service_ids('00000000-0000-0000-0000-0000009a0f02')]),
  array[ARRAY['00000000-0000-0000-0000-0000009a0501'::uuid], ARRAY[(SELECT id FROM replica)]],
  'Bookable: the host''s master, the member''s replica');
SELECT is(public.collective_bookable_service_ids('00000000-0000-0000-0000-0000009a0f03'), NULL::uuid[], 'Nothing is parked outside a collective');

SELECT lives_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f01', '00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0501'),
  'The host''s collective service books');
SELECT lives_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f02', '00000000-0000-0000-0000-0000009a0a02', '00000000-0000-0000-0000-0000009a0d02', (SELECT id FROM replica)),
  'The member''s copy books');
SELECT throws_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f01', '00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0502'),
  'RN007', NULL, 'A new booking for a host service not on the page is refused');
SELECT throws_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f02', '00000000-0000-0000-0000-0000009a0a02', '00000000-0000-0000-0000-0000009a0d02', '00000000-0000-0000-0000-0000009a0503'),
  'RN007', NULL, 'A new booking for the member''s own service is refused');

SELECT lives_ok(
  $$ UPDATE public.bookings SET status = 'Confirmed'::booking_status, booking_time = TIME '12:00', booking_end_time = TIME '12:30'
     WHERE id = '00000000-0000-0000-0000-0000009a0b01' $$,
  'An existing booking on a parked service can still be changed and rescheduled');
SELECT throws_ok(
  format($$ UPDATE public.bookings SET service_item_id = '00000000-0000-0000-0000-0000009a0503' WHERE service_item_id = %L $$, (SELECT id FROM replica)),
  'RN007', NULL, 'Moving a booking onto a parked service is refused');

SELECT public.collective_withdraw_service(id, '00000000-0000-0000-0000-0000009a0f01', NULL) FROM public.collective_service_items;
SELECT throws_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f01', '00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0501'),
  'RN007', NULL, 'A master whose offering was withdrawn is parked at the host');

UPDATE public.venue_collective_members SET suspended_at = now() WHERE id = '00000000-0000-0000-0000-0000009a0e02';
SELECT lives_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f02', '00000000-0000-0000-0000-0000009a0a02', '00000000-0000-0000-0000-0000009a0d02', '00000000-0000-0000-0000-0000009a0503'),
  'A suspended member''s own services book again');

UPDATE public.venue_collectives SET paused_at = now(), paused_reason = 'host_left' WHERE id = '00000000-0000-0000-0000-0000009a0c01';
SELECT lives_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f01', '00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0502'),
  'A paused collective parks nothing');

UPDATE public.venue_collectives SET paused_at = NULL, paused_reason = NULL, service_model = 'legacy_copies' WHERE id = '00000000-0000-0000-0000-0000009a0c01';
SELECT lives_ok(pg_temp.book('00000000-0000-0000-0000-0000009a0f01', '00000000-0000-0000-0000-0000009a0a01', '00000000-0000-0000-0000-0000009a0d01', '00000000-0000-0000-0000-0000009a0502'),
  'On today''s collectives nothing is parked');

SELECT * FROM finish();

ROLLBACK;
