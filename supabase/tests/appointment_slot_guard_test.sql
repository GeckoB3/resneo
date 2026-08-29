-- Resneo: appointment slot guard (P2-3a).
-- Spec: Docs/Resneo_Customer_Portal_World_Class_Plan.md, task P2-3a.
--
-- Proves `claim_appointment_slot`, which closes the appointment reschedule
-- race that `enforce_cde_capacity` leaves open (its trigger fires only on
-- experience_event_id, class_instance_id and resource_id).
--
-- WHY SERIAL AND NOT CONCURRENT. No harness in this repo can force a genuine
-- two-connection race: there is no pg client, and pgTAP runs on a single
-- connection inside one transaction. So this asserts the DECISION the guard
-- makes when it sees a full slot, which is the part that can be wrong in code.
-- That the advisory lock serialises two real connections is Postgres's
-- guarantee, not this suite's. The genuine two-connection race WAS run, on
-- staging 2026-08-29: two `supabase db query` connections claimed one cap-1
-- slot, one won and one was refused with 23P01. It is recorded in the plan
-- under P2-3a, along with why the CLI needs staggered starts to do it.
--
-- Run with:  supabase test db
-- The file runs inside a transaction that is rolled back afterwards.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(7);

-- ── Fixture ────────────────────────────────────────────────────────────────
-- One venue, two calendars (cap 1 and cap 2), one guest, and bookings placed
-- so that every assertion below has something real to collide with.
CREATE TEMP TABLE fx (k text PRIMARY KEY, v uuid);

INSERT INTO fx SELECT 'venue', id FROM public.venues LIMIT 1;

-- Data-modifying CTEs: an INSERT ... RETURNING cannot sit in a FROM subquery.
WITH c1 AS (
  INSERT INTO public.unified_calendars (venue_id, name, parallel_clients, capacity)
  SELECT v, 'pgtap cap1', 1, 1 FROM fx WHERE k = 'venue'
  RETURNING id
)
INSERT INTO fx SELECT 'cal1', id FROM c1;

WITH c2 AS (
  INSERT INTO public.unified_calendars (venue_id, name, parallel_clients, capacity)
  SELECT v, 'pgtap cap2', 2, 2 FROM fx WHERE k = 'venue'
  RETURNING id
)
INSERT INTO fx SELECT 'cal2', id FROM c2;

WITH g AS (
  INSERT INTO public.guests (venue_id, first_name, last_name, email)
  SELECT v, 'PgTap', 'Guard', 'pgtap-guard@example.invalid' FROM fx WHERE k = 'venue'
  RETURNING id
)
INSERT INTO fx SELECT 'guest', id FROM g;

CREATE OR REPLACE FUNCTION pg_temp.mk(
  p_cal_key text, p_time time, p_status text DEFAULT 'Booked'
) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.bookings
    (venue_id, guest_id, calendar_id, booking_date, booking_time, booking_end_time,
     party_size, status, source, booking_model)
  SELECT
    (SELECT v FROM fx WHERE k = 'venue'),
    (SELECT v FROM fx WHERE k = 'guest'),
    (SELECT v FROM fx WHERE k = p_cal_key),
    DATE '2030-03-03', p_time, (p_time + INTERVAL '1 hour')::time, 1,
    p_status::booking_status, 'online'::booking_source, 'unified_scheduling'::booking_model
  RETURNING id;
$$;

/* Does a claim succeed? Returns the row count, or the SQLSTATE it raised. */
CREATE OR REPLACE FUNCTION pg_temp.try_claim(
  p_booking uuid, p_cal_key text, p_time time, p_updated timestamptz DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; u timestamptz;
BEGIN
  u := COALESCE(p_updated, (SELECT updated_at FROM public.bookings WHERE id = p_booking));
  SELECT count(*) INTO n FROM public.claim_appointment_slot(
    p_booking, (SELECT v FROM fx WHERE k = p_cal_key), NULL,
    DATE '2030-03-03', p_time, u, '{}'::jsonb);
  RETURN 'rows:' || n;
EXCEPTION WHEN others THEN
  RETURN SQLSTATE;
END;
$$;

-- ── 1. A free slot is claimable ────────────────────────────────────────────
SELECT is(
  pg_temp.try_claim(pg_temp.mk('cal1', TIME '09:00'), 'cal1', TIME '09:30'),
  'rows:1',
  'a claim on an empty slot succeeds'
);

-- ── 2. A full slot is refused, and with the shared SQLSTATE ────────────────
SELECT pg_temp.mk('cal1', TIME '10:00');
SELECT is(
  pg_temp.try_claim(pg_temp.mk('cal1', TIME '11:00'), 'cal1', TIME '10:00'),
  '23P01',
  'a claim on a slot already at capacity raises 23P01, as enforce_cde_capacity does'
);

-- ── 3. The cap is read, not assumed ────────────────────────────────────────
-- The same collision on a parallel_clients=2 calendar is legitimate. This is
-- the assertion that stops the guard disagreeing with the availability engine,
-- which reads the same column.
SELECT pg_temp.mk('cal2', TIME '10:00');
SELECT is(
  pg_temp.try_claim(pg_temp.mk('cal2', TIME '11:00'), 'cal2', TIME '10:00'),
  'rows:1',
  'a second client at one time is allowed when parallel_clients is 2'
);

-- ── 4. ...but only up to the cap ───────────────────────────────────────────
SELECT is(
  pg_temp.try_claim(pg_temp.mk('cal2', TIME '13:00'), 'cal2', TIME '10:00'),
  '23P01',
  'a third client at one time is refused when parallel_clients is 2'
);

-- ── 5. A booking does not collide with itself ──────────────────────────────
-- A reschedule that changes the service but keeps the time must not be read as
-- the booking competing with itself for its own slot.
-- `mk` is volatile and inserts, so it must be evaluated exactly once. Called
-- from a WHERE clause it fires per row scanned, quietly manufacturing the very
-- collision the test is meant to rule out. Bound in a subquery it runs once.
SELECT is(
  pg_temp.try_claim(b.id, 'cal1', TIME '14:00'),
  'rows:1',
  'rescheduling a booking onto its own slot is not a conflict'
) FROM (SELECT pg_temp.mk('cal1', TIME '14:00') AS id) b;

-- ── 6. A cancelled booking frees its slot ──────────────────────────────────
-- The status list matches enforce_cde_capacity's: only capacity-consuming
-- statuses occupy a slot.
SELECT pg_temp.mk('cal1', TIME '15:00', 'Cancelled');
SELECT is(
  pg_temp.try_claim(pg_temp.mk('cal1', TIME '16:00'), 'cal1', TIME '15:00'),
  'rows:1',
  'a cancelled booking does not hold its slot against a new claim'
);

-- ── 7. Optimistic concurrency survives the move into SQL ───────────────────
-- The caller's `updated_at` check moved inside the function so it stays part of
-- the same atomic step. A stale value must still claim nothing.
SELECT is(
  pg_temp.try_claim(
    pg_temp.mk('cal1', TIME '17:00'), 'cal1', TIME '17:30',
    TIMESTAMPTZ '2020-01-01 00:00:00+00'
  ),
  'rows:0',
  'a stale updated_at claims nothing, so the row was written elsewhere'
);

SELECT * FROM finish();
ROLLBACK;
