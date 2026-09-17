-- Resneo: moving a booking to a calendar at another venue of a collective (20270218200000; D46
-- revised 2026-09-16).
--
-- Proves: a plain booking moves as one step, to the target venue's own service and client record,
-- at the new time and the price it was booked at, and the original is cancelled with both logs
-- saying where it went; a booking with money or forms attached, a visit, a calendar that does not
-- offer the service, a client record at the wrong venue and a venue outside the collective are all
-- refused; and the function is not open to the roles a browser holds.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(14);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000008a0f01', 'Move Host', 'move-host', 'h@move.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000008a0f02', 'Move Member', 'move-member', 'm@move.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000008a0f03', 'Move Outsider', 'move-outsider', 'o@move.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000008a0c01', 'move-collective', 'Move Collective',
        '00000000-0000-0000-0000-0000008a0f01', 'active', 'unified_catalog', 'replicas');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000008a0e01', '00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0f01', 'active'),
  ('00000000-0000-0000-0000-0000008a0e02', '00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0f02', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000008a0501', '00000000-0000-0000-0000-0000008a0f01', 'Cut', 30, 3000),
  ('00000000-0000-0000-0000-0000008a0502', '00000000-0000-0000-0000-0000008a0f03', 'Outsider cut', 30, 3000);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000008a0d01', '00000000-0000-0000-0000-0000008a0f01', 'Host chair'),
  ('00000000-0000-0000-0000-0000008a0d02', '00000000-0000-0000-0000-0000008a0f02', 'Member chair'),
  ('00000000-0000-0000-0000-0000008a0d04', '00000000-0000-0000-0000-0000008a0f02', 'Member nails'),
  ('00000000-0000-0000-0000-0000008a0d03', '00000000-0000-0000-0000-0000008a0f03', 'Outsider chair');
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES
  ('00000000-0000-0000-0000-0000008a0a01', '00000000-0000-0000-0000-0000008a0f01', 'Sam', 'Guest', 'sam@move.test'),
  ('00000000-0000-0000-0000-0000008a0a02', '00000000-0000-0000-0000-0000008a0f02', 'Sam', 'Guest', 'sam@move.test');

SELECT public.collective_offer_service('00000000-0000-0000-0000-0000008a0c01', '00000000-0000-0000-0000-0000008a0501', '00000000-0000-0000-0000-0000008a0f01', NULL);
SELECT public.collective_apply_replica(id, NULL, NULL, 'inline') FROM public.collective_service_replicas;
CREATE TEMP TABLE replica AS SELECT replica_service_id AS id FROM public.collective_service_replicas;
INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
VALUES
  ('00000000-0000-0000-0000-0000008a0d01', '00000000-0000-0000-0000-0000008a0501'),
  ('00000000-0000-0000-0000-0000008a0d02', (SELECT id FROM replica));

CREATE OR REPLACE FUNCTION pg_temp.booking(p_id uuid, p_extra text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.bookings (id, venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time,
    booking_end_time, party_size, status, source, booking_model, service_price_snapshot_pence, special_requests, deposit_status)
  VALUES (p_id, '00000000-0000-0000-0000-0000008a0f01', '00000000-0000-0000-0000-0000008a0a01',
    '00000000-0000-0000-0000-0000008a0d01', '00000000-0000-0000-0000-0000008a0501', DATE '2031-03-03', TIME '10:00',
    TIME '10:30', 1, 'Booked'::booking_status, 'phone'::booking_source, 'unified_scheduling'::booking_model, 2500,
    'Window seat', 'Not Required');
  IF p_extra <> '' THEN EXECUTE format(p_extra, p_id); END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.move(p_id uuid, p_cal uuid DEFAULT '00000000-0000-0000-0000-0000008a0d02',
  p_guest uuid DEFAULT '00000000-0000-0000-0000-0000008a0a02') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$ SELECT public.collective_move_booking(%L, %L, DATE '2031-03-04', TIME '14:00', %L,
    '00000000-0000-0000-0000-0000008a0f01', NULL) $q$, p_id, p_cal, p_guest)
$$;

-- A plain booking moves.
SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b01');
CREATE TEMP TABLE moved (id uuid);
DO $$ BEGIN
  INSERT INTO moved SELECT public.collective_move_booking('00000000-0000-0000-0000-0000008a0b01',
    '00000000-0000-0000-0000-0000008a0d02', DATE '2031-03-04', TIME '14:00', '00000000-0000-0000-0000-0000008a0a02',
    '00000000-0000-0000-0000-0000008a0f01', NULL);
END $$;

SELECT is(
  (SELECT venue_id::text || '|' || guest_id::text || '|' || calendar_id::text || '|' || service_item_id::text
   FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '00000000-0000-0000-0000-0000008a0f02|00000000-0000-0000-0000-0000008a0a02|00000000-0000-0000-0000-0000008a0d02|'
    || (SELECT id FROM replica)::text,
  'The copy is at the member, on its calendar, service and client record');
SELECT is(
  (SELECT booking_date::text || ' ' || booking_time::text || '-' || booking_end_time::text || '|'
          || status::text || '|' || service_price_snapshot_pence || '|' || special_requests || '|' || source::text
   FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '2031-03-04 14:00:00-14:30:00|Booked|2500|Window seat|phone',
  'at the new time, for as long, at the price booked, with its notes');
SELECT is(
  (SELECT collective_id::text || '|' || (collective_service_item_id IS NOT NULL)::text
   FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '00000000-0000-0000-0000-0000008a0c01|true', 'and it carries the collective and the offering');
SELECT is(
  (SELECT status::text || '|' || cancellation_actor_type FROM public.bookings WHERE id = '00000000-0000-0000-0000-0000008a0b01'),
  'Cancelled|staff', 'The original is cancelled by staff');
SELECT is(
  (SELECT count(*)::int FROM public.events
   WHERE (event_type = 'booking_moved_out' AND booking_id = '00000000-0000-0000-0000-0000008a0b01'
          AND payload->>'to_booking_id' = (SELECT id FROM moved)::text)
      OR (event_type = 'booking_moved_in' AND booking_id = (SELECT id FROM moved)
          AND payload->>'from_booking_id' = '00000000-0000-0000-0000-0000008a0b01')),
  2, 'and both venues record where it went');

-- What cannot move.
SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b02',
  $x$ UPDATE public.bookings SET deposit_status = 'Paid', deposit_amount_pence = 1000 WHERE id = %L $x$);
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b02'), 'COLLECTIVE_MOVE_ATTACHED: payment%',
  'A booking with a deposit is refused');
SELECT is((SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-0000008a0b02'), 'Booked',
  'and left as it was');

SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b03',
  $x$ INSERT INTO public.booking_payments (booking_id, venue_id, method, status, amount_pence)
      VALUES (%1$L, '00000000-0000-0000-0000-0000008a0f01', 'cash', 'succeeded', 500) $x$);
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b03'), 'COLLECTIVE_MOVE_ATTACHED: payment%',
  'So is one with a payment taken');

SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b04',
  $x$ UPDATE public.bookings SET group_booking_id = gen_random_uuid() WHERE id = %L $x$);
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b04'), 'COLLECTIVE_MOVE_ATTACHED: visit%',
  'and one that is part of a visit');

SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b05');
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b05', '00000000-0000-0000-0000-0000008a0d04'),
  'COLLECTIVE_MOVE_SERVICE%', 'A calendar that does not offer the service is refused');
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b05', '00000000-0000-0000-0000-0000008a0d02',
  '00000000-0000-0000-0000-0000008a0a01'),
  'COLLECTIVE_MOVE_NOT_ALLOWED%', 'as is a client record at the wrong venue');
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b05', '00000000-0000-0000-0000-0000008a0d03'),
  'COLLECTIVE_MOVE_NOT_ALLOWED%', 'and a venue outside the collective');

SELECT pg_temp.booking('00000000-0000-0000-0000-0000008a0b06',
  $x$ UPDATE public.bookings SET status = 'Completed' WHERE id = %L $x$);
SELECT throws_like(pg_temp.move('00000000-0000-0000-0000-0000008a0b06'), 'COLLECTIVE_MOVE_ATTACHED: status%',
  'A finished booking stays where it is');

SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.collective_move_booking(uuid, uuid, date, time, uuid, uuid, uuid, timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('anon',
    'public.collective_move_booking(uuid, uuid, date, time, uuid, uuid, uuid, timestamptz)', 'EXECUTE'),
  'It is not open to the roles a browser holds');

SELECT * FROM finish();

ROLLBACK;
