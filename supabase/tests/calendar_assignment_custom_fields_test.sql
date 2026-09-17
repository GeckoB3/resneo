-- Resneo: a calendar's seven own values have storage (20270214140000; W8, D5, PB-01).
--
-- Proves:
--   * the five new values are stored alongside length and price;
--   * out-of-range values are refused by CHECK;
--   * updated_at moves when a value changes, not on an unrelated update;
--   * a booking's service name snapshot is the calendar's own name while the name flag is on,
--     and the service's name once it is off.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-00000000f0f1', 'Seven Values Venue', 'seven-values-venue',
        'venue@sevenvalues.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f0f1',
        'PgTap', 'Seven', 'pgtap@sevenvalues.test');

INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES ('00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f0f1', 'Sam');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence, staff_may_customize_name)
VALUES ('00000000-0000-0000-0000-00000000f051', '00000000-0000-0000-0000-00000000f0f1', 'Cut', 30, 2500, true);

INSERT INTO public.calendar_service_assignments
  (id, calendar_id, service_item_id, custom_name, custom_description, custom_buffer_minutes,
   custom_deposit_pence, custom_colour, updated_at)
VALUES ('00000000-0000-0000-0000-00000000f0d1', '00000000-0000-0000-0000-00000000f0c1',
        '00000000-0000-0000-0000-00000000f051', 'Senior cut', 'With Sam', 10, 500, '#123456',
        TIMESTAMPTZ '2030-01-01 00:00+00');

SELECT is(
  (SELECT array[custom_name, custom_description, custom_buffer_minutes::text, custom_deposit_pence::text, custom_colour]
   FROM public.calendar_service_assignments WHERE id = '00000000-0000-0000-0000-00000000f0d1'),
  array['Senior cut', 'With Sam', '10', '500', '#123456'],
  'Name, description, buffer, deposit and colour are stored on the assignment');

SELECT throws_ok(
  $$ UPDATE public.calendar_service_assignments SET custom_buffer_minutes = 121
     WHERE id = '00000000-0000-0000-0000-00000000f0d1' $$,
  '23514', NULL, 'A buffer over 120 minutes is refused');

SELECT throws_ok(
  $$ UPDATE public.calendar_service_assignments SET custom_name = '   '
     WHERE id = '00000000-0000-0000-0000-00000000f0d1' $$,
  '23514', NULL, 'A blank name is refused');

SELECT throws_ok(
  $$ UPDATE public.calendar_service_assignments SET custom_deposit_pence = -1
     WHERE id = '00000000-0000-0000-0000-00000000f0d1' $$,
  '23514', NULL, 'A negative deposit is refused');

UPDATE public.calendar_service_assignments SET calendar_id = calendar_id
WHERE id = '00000000-0000-0000-0000-00000000f0d1';
SELECT is(
  (SELECT updated_at FROM public.calendar_service_assignments WHERE id = '00000000-0000-0000-0000-00000000f0d1'),
  TIMESTAMPTZ '2030-01-01 00:00+00', 'An update that changes no value leaves updated_at alone');

UPDATE public.calendar_service_assignments SET custom_buffer_minutes = 15
WHERE id = '00000000-0000-0000-0000-00000000f0d1';
SELECT ok(
  (SELECT updated_at <> TIMESTAMPTZ '2030-01-01 00:00+00' FROM public.calendar_service_assignments
   WHERE id = '00000000-0000-0000-0000-00000000f0d1'),
  'Changing a value moves updated_at');

CREATE OR REPLACE FUNCTION pg_temp.mk() RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.bookings
    (venue_id, guest_id, calendar_id, service_item_id, booking_date, booking_time, booking_end_time,
     party_size, status, source, booking_model)
  VALUES
    ('00000000-0000-0000-0000-00000000f0f1', '00000000-0000-0000-0000-00000000f0a1',
     '00000000-0000-0000-0000-00000000f0c1', '00000000-0000-0000-0000-00000000f051',
     DATE '2030-05-05', TIME '10:00', TIME '10:30', 1,
     'Booked'::booking_status, 'online'::booking_source, 'unified_scheduling'::booking_model)
  RETURNING id;
$$;

CREATE TEMP TABLE with_flag AS SELECT pg_temp.mk() AS id;

SELECT is(
  (SELECT service_name_snapshot FROM public.bookings WHERE id = (SELECT id FROM with_flag)),
  'Senior cut', 'The booking records the calendar''s own name while the name flag is on');

UPDATE public.service_items SET staff_may_customize_name = false
WHERE id = '00000000-0000-0000-0000-00000000f051';

CREATE TEMP TABLE without_flag AS SELECT pg_temp.mk() AS id;

SELECT is(
  (SELECT service_name_snapshot FROM public.bookings WHERE id = (SELECT id FROM without_flag)),
  'Cut', 'Once the flag is off the booking records the service''s name');

SELECT * FROM finish();

ROLLBACK;
