-- Measures what an appointment capacity guard (P2-3a) would do to real data.
--
-- READ ONLY. This is one SELECT. It contains no INSERT, UPDATE, DELETE, DDL or
-- function call that writes, and it is safe to run on production.
--
-- WHY IT EXISTS. `enforce_cde_capacity` covers class, event and resource
-- bookings and explicitly excludes appointments, so two concurrent reschedules
-- can double-book an appointment slot (P2-3a). The obvious fix copies that
-- function's RESOURCE branch, which rejects any overlapping active booking on
-- the same calendar. For appointments that is wrong twice over:
--
--   1. `unified_calendars.parallel_clients` caps how many clients a calendar
--      handles SIMULTANEOUSLY. A venue running two chairs off one calendar
--      legitimately has overlapping appointments.
--   2. A booking's busy time is not one contiguous span. `processing_time_blocks`
--      splits it: during a colour's processing gap the chair is free and the
--      availability engine will book another client into it.
--
-- A trigger fires on UPDATE as well as INSERT, so any row that already violates
-- whatever rule the guard applies would be refused a RESCHEDULE. That is what
-- M3 and M4 count, and it is the difference between a fix and an incident.
--
-- The JS sibling `scripts/measure-appointment-concurrency.mjs` computes the same
-- five numbers over the REST API. This exists so production can be measured from
-- the SQL editor without a service-role key leaving the dashboard.
--
-- Verified against staging 2026-08-29: both tools return identical numbers
-- (M1 0/45, M2 9 of 195 with a usable window, M3 0, M4 1, M5 0).
--
-- Writing both was worth it. They DISAGREED on M2 at first, 9 against 7 on the
-- same database, because the JS counted only bookings whose busy time split
-- into more than one run. A processing gap that reaches the END of the span
-- leaves one run, so it went uncounted even though the engine can still book
-- into that gap. The definition here is the right one and the JS was corrected
-- to match.
--
-- To bound it on a large database, set the date floor below.

WITH params AS (
  -- Every active booking, however old, can still be UPDATEd, so the honest
  -- default is no floor. Raise it to '2026-01-01' if the query is too slow.
  SELECT DATE '1900-01-01' AS since
),

/* Statuses that occupy a slot, matching `enforce_cde_capacity`'s own list. */
active AS (
  SELECT
    b.id,
    b.venue_id,
    b.calendar_id,
    b.booking_date,
    (EXTRACT(EPOCH FROM b.booking_time) / 60)::int AS start_min,
    (EXTRACT(EPOCH FROM b.booking_end_time) / 60)::int AS end_min,
    COALESCE(b.processing_time_blocks, '[]'::jsonb) AS blocks
  FROM public.bookings b, params p
  WHERE b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated')
    AND b.calendar_id IS NOT NULL
    AND b.booking_date >= p.since
    AND b.booking_time IS NOT NULL
    AND b.booking_end_time IS NOT NULL
    AND b.booking_end_time > b.booking_time
),

/* Cap per calendar. The column defaults to 1; it is not fixed at it. */
cal AS (
  SELECT id, venue_id, name, calendar_type,
         GREATEST(1, COALESCE(parallel_clients, 1)) AS cap,
         COALESCE(capacity, 1) AS capacity,
         COALESCE(parallel_clients, 1) AS parallel_clients
  FROM public.unified_calendars
),

/* Processing gaps, as absolute minutes. Shape is {start_minute, duration_minutes}
   per src/lib/appointments/processing-time.ts:173. */
gap AS (
  SELECT a.id,
         a.start_min + (e->>'start_minute')::int AS gap_start,
         a.start_min + (e->>'start_minute')::int + (e->>'duration_minutes')::int AS gap_end
  FROM active a
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.blocks) = 'array' THEN a.blocks ELSE '[]'::jsonb END
  ) AS e
  WHERE (e->>'start_minute') ~ '^[0-9]+$'
    AND (e->>'duration_minutes') ~ '^[0-9]+$'
    AND (e->>'duration_minutes')::int > 0
),

/* Blocks this query could not read. If this is not zero, M2 and M4 UNDERSTATE
   and the stored shape has moved. Reported rather than skipped. */
bad_block AS (
  SELECT a.id, e AS block
  FROM active a
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(a.blocks) = 'array' THEN a.blocks ELSE '[]'::jsonb END
  ) AS e
  WHERE NOT (
    (e->>'start_minute') ~ '^[0-9]+$'
    AND (e->>'duration_minutes') ~ '^[0-9]+$'
    AND (e->>'duration_minutes')::int > 0
  )
),

/* The minutes each booking actually occupies: its span, less its gaps.
   Minute granularity, which is the grid the engine works on. */
busy_minute AS (
  SELECT a.calendar_id, a.booking_date, a.id, m
  FROM active a
  CROSS JOIN LATERAL generate_series(a.start_min, a.end_min - 1) AS m
  WHERE NOT EXISTS (
    SELECT 1 FROM gap g
    WHERE g.id = a.id AND m >= g.gap_start AND m < g.gap_end
  )
),

/* A booking whose busy time is split into more than one run. */
split_booking AS (
  SELECT a.id, a.venue_id
  FROM active a
  WHERE EXISTS (
    SELECT 1 FROM gap g
    WHERE g.id = a.id AND g.gap_start > a.start_min AND g.gap_start < a.end_min
  )
),

/* M4: peak simultaneous bookings per calendar-day, the ENGINE's rule. */
peak_by_day AS (
  SELECT bm.calendar_id, bm.booking_date, MAX(n) AS peak
  FROM (
    SELECT calendar_id, booking_date, m, COUNT(DISTINCT id) AS n
    FROM busy_minute
    GROUP BY 1, 2, 3
  ) bm
  GROUP BY 1, 2
),

/* M3: bookings sharing one start time, which is what the RACE produces. Two
   clients confirming the same offered slot pick the same booking_time. */
exact_slot AS (
  SELECT a.calendar_id, a.booking_date, a.start_min, COUNT(*) AS n
  FROM active a
  GROUP BY 1, 2, 3
)

SELECT * FROM (
  SELECT 1::numeric AS sort, 'M1  calendars taking more than one client at once' AS measure,
         (SELECT COUNT(*) FROM cal WHERE parallel_clients > 1 OR capacity > 1)::text
           || ' of ' || (SELECT COUNT(*) FROM cal)::text || ' calendars' AS value,
         COALESCE((
           SELECT string_agg(name || ' (parallel_clients=' || parallel_clients
                             || ', capacity=' || capacity || ')', '; ')
           FROM (SELECT name, parallel_clients, capacity FROM cal
                 WHERE parallel_clients > 1 OR capacity > 1 LIMIT 10) x
         ), 'none') AS detail

  UNION ALL
  SELECT 2, 'M1b venues with such a calendar',
         (SELECT COUNT(DISTINCT venue_id) FROM cal
          WHERE parallel_clients > 1 OR capacity > 1)::text,
         'if > 0 the guard MUST read parallel_clients, not assume 1'

  UNION ALL
  SELECT 3, 'M2  active bookings whose busy time is NOT contiguous',
         (SELECT COUNT(*) FROM split_booking)::text
           || ' of ' || (SELECT COUNT(*) FROM active)::text || ' bookings with a usable window'
           || ' (of ' || (SELECT COUNT(*) FROM public.bookings b, params p
                          WHERE b.status::text IN ('Pending','Booked','Confirmed','Seated')
                            AND b.calendar_id IS NOT NULL
                            AND b.booking_date >= p.since)::text || ' active)',
         'across ' || (SELECT COUNT(DISTINCT venue_id) FROM split_booking)::text
           || ' venue(s); if > 0 a span-based guard is STRICTER than the engine'

  UNION ALL
  SELECT 4, 'M2b processing blocks in an unreadable shape',
         (SELECT COUNT(*) FROM bad_block)::text,
         CASE WHEN (SELECT COUNT(*) FROM bad_block) = 0
              THEN 'good: M2 and M4 can be trusted'
              ELSE 'WARNING: M2 and M4 UNDERSTATE. Sample: '
                   || COALESCE((SELECT block::text FROM bad_block LIMIT 1), '')
         END

  UNION ALL
  SELECT 5, 'M3  SLOTS an EXACT-SLOT guard would refuse',
         (SELECT COUNT(*) FROM exact_slot e JOIN cal c ON c.id = e.calendar_id
          WHERE e.n > c.cap)::text,
         COALESCE((
           SELECT string_agg(calendar_id::text || ' ' || booking_date::text
                             || ' (' || n || ' at one time, cap ' || cap || ')', '; ')
           FROM (SELECT e.calendar_id, e.booking_date, e.n, c.cap
                 FROM exact_slot e JOIN cal c ON c.id = e.calendar_id
                 WHERE e.n > c.cap LIMIT 10) x
         ), 'none: an exact-slot guard refuses no existing row')

  /* M3 counts (calendar, date, start time) groups and M4 counts (calendar,
     date) groups, so the two numbers are in DIFFERENT UNITS and comparing them
     directly is meaningless. The b/c rows put both on calendar-days, and split
     out the future, which is the real blast radius: a past booking is unlikely
     to be rescheduled, and only a reschedule would meet the trigger. */
  UNION ALL
  SELECT 5.1, 'M3b calendar-days affected by M3',
         (SELECT COUNT(*) FROM (
            SELECT DISTINCT e.calendar_id, e.booking_date
            FROM exact_slot e JOIN cal c ON c.id = e.calendar_id WHERE e.n > c.cap
          ) d)::text,
         'of which in the future: ' || (SELECT COUNT(*) FROM (
            SELECT DISTINCT e.calendar_id, e.booking_date
            FROM exact_slot e JOIN cal c ON c.id = e.calendar_id
            WHERE e.n > c.cap AND e.booking_date >= CURRENT_DATE
          ) d)::text

  UNION ALL
  SELECT 5.2, 'M3c distinct calendars affected by M3',
         (SELECT COUNT(DISTINCT e.calendar_id)
          FROM exact_slot e JOIN cal c ON c.id = e.calendar_id WHERE e.n > c.cap)::text,
         'concentration matters: one misconfigured calendar is a different problem from many'

  UNION ALL
  SELECT 6, 'M4  calendar-days a CONCURRENCY guard would refuse',
         (SELECT COUNT(*) FROM peak_by_day p JOIN cal c ON c.id = p.calendar_id
          WHERE p.peak > c.cap)::text,
         COALESCE((
           SELECT string_agg(calendar_id::text || ' ' || booking_date::text
                             || ' (peak ' || peak || ', cap ' || cap || ')', '; ')
           FROM (SELECT p.calendar_id, p.booking_date, p.peak, c.cap
                 FROM peak_by_day p JOIN cal c ON c.id = p.calendar_id
                 WHERE p.peak > c.cap LIMIT 10) x
         ), 'none')

  UNION ALL
  SELECT 6.1, 'M4b of those, in the future',
         (SELECT COUNT(*) FROM peak_by_day p JOIN cal c ON c.id = p.calendar_id
          WHERE p.peak > c.cap AND p.booking_date >= CURRENT_DATE)::text,
         'past rows are unlikely to be rescheduled, so these are the ones that would break'

  UNION ALL
  SELECT 7, 'M5  active LEGACY appointments (no calendar_id)',
         (SELECT COUNT(*) FROM public.bookings b, params p
          WHERE b.status::text IN ('Pending', 'Booked', 'Confirmed', 'Seated')
            AND b.calendar_id IS NULL
            AND b.practitioner_id IS NOT NULL
            AND b.booking_date >= p.since)::text,
         'if 0 the guard only needs to cover unified calendars'
) results
ORDER BY sort;
