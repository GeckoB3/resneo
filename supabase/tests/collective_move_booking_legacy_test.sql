-- Resneo: moving a booking between venues of a collective still on the older model
-- (20270218210000). Found on staging: the move refused a Beard Trim booking because it only looked
-- for shared-services replicas.
--
-- Proves: on a "legacy_copies" collective the booking moves to the member's own copy of the service
-- when that venue's calendar provides it on the page, even when the booking still names an
-- archived offering; a calendar that does not provide it is refused; and a withdrawn provider does
-- not count.
--
-- Run with:  supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES
  ('00000000-0000-0000-0000-0000006a0f01', 'Old Host', 'old-host', 'h@old.test', 'appointments', 'active', 'unified_scheduling'),
  ('00000000-0000-0000-0000-0000006a0f02', 'Old Member', 'old-member', 'm@old.test', 'appointments', 'active', 'unified_scheduling');
INSERT INTO public.venue_collectives (id, slug, name, host_venue_id, status, page_mode, service_model)
VALUES ('00000000-0000-0000-0000-0000006a0c01', 'old-collective', 'Old Collective',
        '00000000-0000-0000-0000-0000006a0f01', 'active', 'unified_catalog', 'legacy_copies');
INSERT INTO public.venue_collective_members (id, collective_id, venue_id, status)
VALUES
  ('00000000-0000-0000-0000-0000006a0e01', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f01', 'active'),
  ('00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0f02', 'active');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0f01', 'Beard Trim', 20, 1500),
  ('00000000-0000-0000-0000-0000006a0502', '00000000-0000-0000-0000-0000006a0f02', 'Beard Trim', 20, 1600);
INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0f01', 'Andrew'),
  ('00000000-0000-0000-0000-0000006a0d02', '00000000-0000-0000-0000-0000006a0f02', 'John'),
  ('00000000-0000-0000-0000-0000006a0d03', '00000000-0000-0000-0000-0000006a0f02', 'Nobody');
INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
VALUES
  ('00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0501'),
  ('00000000-0000-0000-0000-0000006a0d02', '00000000-0000-0000-0000-0000006a0502'),
  ('00000000-0000-0000-0000-0000006a0d03', '00000000-0000-0000-0000-0000006a0502');
INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES
  ('00000000-0000-0000-0000-0000006a0a01', '00000000-0000-0000-0000-0000006a0f01', 'Sam', 'Guest', 'sam@old.test'),
  ('00000000-0000-0000-0000-0000006a0a02', '00000000-0000-0000-0000-0000006a0f02', 'Sam', 'Guest', 'sam@old.test');

-- An archived offering the booking still names, and the live one with its providers.
INSERT INTO public.collective_service_items (id, collective_id, name, status)
VALUES
  ('00000000-0000-0000-0000-0000006a0901', '00000000-0000-0000-0000-0000006a0c01', 'Beard Trim', 'archived'),
  ('00000000-0000-0000-0000-0000006a0902', '00000000-0000-0000-0000-0000006a0c01', 'Beard Trim', 'active');
INSERT INTO public.collective_service_providers (item_id, member_id, venue_id, source_service_id, practitioner_id, status)
VALUES
  ('00000000-0000-0000-0000-0000006a0902', '00000000-0000-0000-0000-0000006a0e01', '00000000-0000-0000-0000-0000006a0f01',
   '00000000-0000-0000-0000-0000006a0501', '00000000-0000-0000-0000-0000006a0d01', 'active'),
  ('00000000-0000-0000-0000-0000006a0902', '00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0f02',
   '00000000-0000-0000-0000-0000006a0502', '00000000-0000-0000-0000-0000006a0d02', 'active'),
  ('00000000-0000-0000-0000-0000006a0902', '00000000-0000-0000-0000-0000006a0e02', '00000000-0000-0000-0000-0000006a0f02',
   '00000000-0000-0000-0000-0000006a0502', '00000000-0000-0000-0000-0000006a0d03', 'removed');

INSERT INTO public.bookings (id, venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time,
  booking_end_time, party_size, status, source, booking_model, deposit_status, collective_id, collective_service_item_id,
  service_price_snapshot_pence)
VALUES
  ('00000000-0000-0000-0000-0000006a0b01', '00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0a01',
   '00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0501', DATE '2031-03-03', TIME '10:00',
   TIME '10:20', 1, 'Booked'::booking_status, 'phone'::booking_source, 'unified_scheduling'::booking_model, 'Not Required',
   '00000000-0000-0000-0000-0000006a0c01', '00000000-0000-0000-0000-0000006a0901', 1500),
  ('00000000-0000-0000-0000-0000006a0b02', '00000000-0000-0000-0000-0000006a0f01', '00000000-0000-0000-0000-0000006a0a01',
   '00000000-0000-0000-0000-0000006a0d01', '00000000-0000-0000-0000-0000006a0501', DATE '2031-03-03', TIME '11:00',
   TIME '11:20', 1, 'Booked'::booking_status, 'phone'::booking_source, 'unified_scheduling'::booking_model, 'Not Required',
   NULL, NULL, 1500);

SELECT throws_like(
  $$ SELECT public.collective_move_booking('00000000-0000-0000-0000-0000006a0b02', '00000000-0000-0000-0000-0000006a0d03',
       DATE '2031-03-04', TIME '14:00', '00000000-0000-0000-0000-0000006a0a02', '00000000-0000-0000-0000-0000006a0f01', NULL) $$,
  'COLLECTIVE_MOVE_SERVICE%', 'A calendar whose provider was withdrawn does not take it');

CREATE TEMP TABLE moved (id uuid);
DO $$ BEGIN
  INSERT INTO moved SELECT public.collective_move_booking('00000000-0000-0000-0000-0000006a0b01',
    '00000000-0000-0000-0000-0000006a0d02', DATE '2031-03-04', TIME '14:00', '00000000-0000-0000-0000-0000006a0a02',
    '00000000-0000-0000-0000-0000006a0f01', NULL);
END $$;

SELECT is(
  (SELECT venue_id::text || '|' || calendar_id::text || '|' || service_item_id::text || '|' || guest_id::text
   FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '00000000-0000-0000-0000-0000006a0f02|00000000-0000-0000-0000-0000006a0d02|00000000-0000-0000-0000-0000006a0502|00000000-0000-0000-0000-0000006a0a02',
  'The booking moves to the member, on its own copy of the service');
SELECT is(
  (SELECT booking_time::text || '-' || booking_end_time::text || '|' || service_price_snapshot_pence
   FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '14:00:00-14:20:00|1500', 'at the new time and the price booked');
SELECT is(
  (SELECT collective_service_item_id::text FROM public.bookings WHERE id = (SELECT id FROM moved)),
  '00000000-0000-0000-0000-0000006a0902', 'naming the live offering, not the archived one');
SELECT is(
  (SELECT status::text FROM public.bookings WHERE id = '00000000-0000-0000-0000-0000006a0b01'),
  'Cancelled', 'and the original is cancelled');

-- A booking at the member moves back to the host's calendar the same way.
DO $$ BEGIN
  PERFORM public.collective_move_booking((SELECT id FROM moved),
    '00000000-0000-0000-0000-0000006a0d01', DATE '2031-03-05', TIME '09:00', '00000000-0000-0000-0000-0000006a0a01',
    '00000000-0000-0000-0000-0000006a0f02', NULL);
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.bookings
   WHERE venue_id = '00000000-0000-0000-0000-0000006a0f01' AND booking_date = DATE '2031-03-05'
     AND service_item_id = '00000000-0000-0000-0000-0000006a0501' AND status = 'Booked'),
  1, 'and back again');

SELECT * FROM finish();

ROLLBACK;
