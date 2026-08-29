-- Characterises the bookings a P2-3a guard would refuse, for ONE calendar.
--
-- READ ONLY. SELECTs only, safe on production.
--
-- WHY. The first production run of `measure-appointment-concurrency.sql` found
-- 27 colliding slots and 14 over-cap calendar-days, and EVERY one of them was
-- the same calendar. That is a very different problem from the same count
-- spread across a fleet: one calendar is either misconfigured (it really runs
-- two clients at once and `parallel_clients` still says 1) or its double
-- bookings are deliberate, and the fix differs completely between those.
--
-- Set the calendar below, then run. Nothing here decides anything; it answers
-- "what are these bookings, who made them, and are they in the future".

WITH params AS (
  SELECT
    -- The calendar every production collision belonged to on 2026-08-29.
    '499ed959-03b2-4d9e-b9ca-f424094a8e10'::uuid AS calendar_id
),

active AS (
  SELECT b.*
  FROM public.bookings b, params p
  WHERE b.calendar_id = p.calendar_id
    AND b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated')
    AND b.booking_time IS NOT NULL
),

/* Start times shared by more than one active booking on the same day. */
collision AS (
  SELECT booking_date, booking_time, COUNT(*) AS n
  FROM active
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
),

colliding_rows AS (
  SELECT a.*
  FROM active a
  JOIN collision c
    ON c.booking_date = a.booking_date AND c.booking_time = a.booking_time
)

SELECT * FROM (
  -- Who the calendar is, and what it claims its capacity is.
  SELECT 1::numeric AS sort,
         'calendar' AS fact,
         c.name AS value,
         'venue ' || v.name || ' | type ' || c.calendar_type
           || ' | parallel_clients ' || c.parallel_clients
           || ' | capacity ' || c.capacity AS detail
  FROM public.unified_calendars c
  JOIN public.venues v ON v.id = c.venue_id, params p
  WHERE c.id = p.calendar_id

  UNION ALL
  SELECT 2, 'colliding bookings in total',
         (SELECT COUNT(*) FROM colliding_rows)::text,
         'across ' || (SELECT COUNT(*) FROM collision)::text || ' shared start time(s)'

  UNION ALL
  -- The decisive one. Only a reschedule meets the trigger, and nobody
  -- reschedules last spring's appointment.
  SELECT 3, 'of those, in the future',
         (SELECT COUNT(*) FROM colliding_rows WHERE booking_date >= CURRENT_DATE)::text,
         'these are the rows a guard would actually refuse a reschedule'

  UNION ALL
  -- Deliberate staff overbooking looks different from a race, and a table
  -- trigger blocks staff too.
  SELECT 4, 'how the colliding bookings were made',
         COALESCE((
           SELECT string_agg(src || ': ' || n, '; ' ORDER BY n DESC)
           FROM (SELECT COALESCE(source::text, 'unknown') AS src, COUNT(*) AS n
                 FROM colliding_rows GROUP BY 1) s
         ), 'none'),
         'staff-made collisions suggest deliberate overbooking, which a table trigger would block'

  UNION ALL
  SELECT 5, 'distinct guests involved',
         (SELECT COUNT(DISTINCT guest_id) FROM colliding_rows)::text,
         'same guest twice is a duplicate; different guests is real double-booking'

  UNION ALL
  SELECT 6, 'earliest and latest colliding date',
         COALESCE((SELECT MIN(booking_date)::text || ' to ' || MAX(booking_date)::text
                   FROM colliding_rows), 'none'),
         'a long spread suggests standing practice, not a one-off incident'
) results
ORDER BY sort;
