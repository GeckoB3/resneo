-- Resneo: bookings keep the price they were made at (20270212120000; plan PRICE-01, PRICE-02).
--
-- Proves:
--   * an appointment insert records its option's price, else its calendar's custom price, else
--     the service's price, matching the live resolver;
--   * a price supplied by the caller is kept;
--   * editing the catalogue afterwards does not move a booking's snapshot;
--   * moving a booking's time or calendar keeps the snapshot; changing its option re-prices;
--   * the snapshot cannot be negative; a non-appointment row is left alone.
--
-- Run with:  supabase test db
-- Each test file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(9);

INSERT INTO public.venues (id, name, slug, email, pricing_tier, plan_status, booking_model)
VALUES ('00000000-0000-0000-0000-00000000b0f1', 'Snapshot Venue', 'snapshot-venue',
        'venue@snapshot.test', 'appointments', 'active', 'unified_scheduling');

INSERT INTO public.guests (id, venue_id, first_name, last_name, email)
VALUES ('00000000-0000-0000-0000-00000000b0a1', '00000000-0000-0000-0000-00000000b0f1',
        'PgTap', 'Snapshot', 'pgtap@snapshot.test');

INSERT INTO public.unified_calendars (id, venue_id, name)
VALUES
  ('00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b0f1', 'Plain chair'),
  ('00000000-0000-0000-0000-00000000b0c2', '00000000-0000-0000-0000-00000000b0f1', 'Senior chair');

INSERT INTO public.service_items (id, venue_id, name, duration_minutes, price_pence)
VALUES ('00000000-0000-0000-0000-00000000b051', '00000000-0000-0000-0000-00000000b0f1', 'Cut', 30, 2500);

INSERT INTO public.service_variants (id, venue_id, service_item_id, name, duration_minutes, price_pence)
VALUES
  ('00000000-0000-0000-0000-00000000b0e1', '00000000-0000-0000-0000-00000000b0f1',
   '00000000-0000-0000-0000-00000000b051', 'Long hair', 45, 4000),
  ('00000000-0000-0000-0000-00000000b0e2', '00000000-0000-0000-0000-00000000b0f1',
   '00000000-0000-0000-0000-00000000b051', 'Short hair', 30, 3000);

INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id, custom_price_pence)
VALUES
  ('00000000-0000-0000-0000-00000000b0c1', '00000000-0000-0000-0000-00000000b051', NULL),
  ('00000000-0000-0000-0000-00000000b0c2', '00000000-0000-0000-0000-00000000b051', 3500);

CREATE OR REPLACE FUNCTION pg_temp.mk(
  p_cal uuid, p_variant uuid, p_snapshot integer DEFAULT NULL, p_service uuid DEFAULT '00000000-0000-0000-0000-00000000b051'
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.bookings
    (venue_id, guest_id, calendar_id, service_item_id, service_variant_id, service_price_snapshot_pence,
     booking_date, booking_time, booking_end_time, party_size, status, source, booking_model)
  VALUES
    ('00000000-0000-0000-0000-00000000b0f1', '00000000-0000-0000-0000-00000000b0a1',
     p_cal, p_service, p_variant, p_snapshot, DATE '2030-04-04', TIME '10:00', TIME '11:00', 1,
     'Booked'::booking_status, 'online'::booking_source, 'unified_scheduling'::booking_model)
  RETURNING id;
$$;

CREATE TEMP TABLE t AS SELECT
  pg_temp.mk('00000000-0000-0000-0000-00000000b0c1', NULL) AS plain,
  pg_temp.mk('00000000-0000-0000-0000-00000000b0c2', NULL) AS custom,
  pg_temp.mk('00000000-0000-0000-0000-00000000b0c2', '00000000-0000-0000-0000-00000000b0e1') AS variant,
  pg_temp.mk('00000000-0000-0000-0000-00000000b0c1', NULL, 1234) AS supplied,
  pg_temp.mk('00000000-0000-0000-0000-00000000b0c1', NULL, NULL, NULL) AS no_service;

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT plain FROM t)),
  2500, 'A plain booking records the service price');

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT custom FROM t)),
  3500, 'A booking on a calendar with a custom price records that price');

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT variant FROM t)),
  4000, 'A chosen option''s price wins over the calendar''s custom price');

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT supplied FROM t)),
  1234, 'A price the caller supplies is kept');

UPDATE public.service_items SET price_pence = 9900 WHERE id = '00000000-0000-0000-0000-00000000b051';
UPDATE public.calendar_service_assignments SET custom_price_pence = 9800
  WHERE calendar_id = '00000000-0000-0000-0000-00000000b0c2';

SELECT is(
  (SELECT array[
     (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT plain FROM t)),
     (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT custom FROM t))]),
  array[2500, 3500], 'Editing the catalogue afterwards does not re-price existing bookings');

UPDATE public.bookings
SET booking_time = TIME '14:00', booking_end_time = TIME '15:00', calendar_id = '00000000-0000-0000-0000-00000000b0c2'
WHERE id = (SELECT plain FROM t);

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT plain FROM t)),
  2500, 'Moving a booking''s time or calendar keeps the agreed price');

UPDATE public.bookings SET service_variant_id = '00000000-0000-0000-0000-00000000b0e2'
WHERE id = (SELECT variant FROM t);

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT variant FROM t)),
  3000, 'Changing the option re-prices the booking');

SELECT is(
  (SELECT service_price_snapshot_pence FROM public.bookings WHERE id = (SELECT no_service FROM t)),
  NULL, 'A booking with no service is left without a snapshot');

SELECT throws_ok(
  $$ UPDATE public.bookings SET service_price_snapshot_pence = -1 WHERE id = (SELECT plain FROM t) $$,
  '23514', NULL,
  'A negative snapshot is refused');

SELECT * FROM finish();

ROLLBACK;
