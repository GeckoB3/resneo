-- Schedule periods: plan a calendar's hours ahead, as a timeline.
--
-- WHAT IT IS FOR. 20270203120000 added one rotating schedule per calendar.
-- Testing it showed the general need underneath: "new hours from a date" (which
-- a single rota could not express, its minimum cycle being two weeks), and more
-- than one change planned ahead. So the calendar now carries a timeline of
-- non-overlapping periods, each with a Monday start, an optional Sunday end,
-- and one to six weekly shapes; a one-week period is simply new hours from that
-- date. Dates no period covers keep the ordinary `working_hours`, so a change
-- from a future date leaves earlier dates exactly as they were.
-- See Docs/rotating-schedule-plan.md.
--
-- SHAPE (validated in src/lib/availability/working-hours-rota.ts):
--   { "version": 1,
--     "periods": [ { "id": "...",
--                    "from": "YYYY-MM-DD",          -- a Monday
--                    "until": "YYYY-MM-DD" | null,  -- a Sunday, inclusive; null = until further notice
--                    "cycle_start": "YYYY-MM-DD",   -- Monday the week count runs from (<= from);
--                                                   -- differs from `from` only after a split
--                    "weeks": [ <working_hours>, ... ] } ] }  -- 1 to 6
--
-- WHY A NEW COLUMN. `working_hours_rota` was applied to staging before this
-- reshaping, and an applied migration is never edited. The old column is
-- backfilled into the new one below, then left in place unread by new writes;
-- the code still falls back to it on a row whose `schedule_periods` is NULL, so
-- nothing changes for a calendar between the two pushes. A later contraction
-- can drop it.
--
-- EXPAND-ONLY: one nullable column plus an idempotent backfill.

ALTER TABLE public.unified_calendars
  ADD COLUMN IF NOT EXISTS schedule_periods jsonb;

COMMENT ON COLUMN public.unified_calendars.schedule_periods IS
  'Timeline of non-overlapping schedule periods {version:1, periods:[{id, from (Monday), '
  'until (Sunday|null), cycle_start, weeks: [working_hours x 1..6]}]}. The resolver uses '
  'the period covering a date, else working_hours. NULL = no periods. Supersedes '
  'working_hours_rota.';

COMMENT ON COLUMN public.unified_calendars.working_hours_rota IS
  'Superseded by schedule_periods (20270204120000): backfilled from here, no longer '
  'written. Read only as a fallback while schedule_periods is NULL.';

-- Backfill: a rota becomes a one-period timeline. A rota was allowed to end on
-- any date; a period ends on a Sunday, so the end is moved to the Sunday that
-- finishes its week (extract(dow) is 0 for Sunday).
UPDATE public.unified_calendars
SET schedule_periods = jsonb_build_object(
  'version', 1,
  'periods', jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'from', working_hours_rota ->> 'cycle_start',
      'cycle_start', working_hours_rota ->> 'cycle_start',
      'until', CASE
        WHEN working_hours_rota ->> 'repeat_until' IS NULL THEN NULL
        ELSE to_char(
          (working_hours_rota ->> 'repeat_until')::date
            + ((7 - extract(dow FROM (working_hours_rota ->> 'repeat_until')::date)::int) % 7),
          'YYYY-MM-DD'
        )
      END,
      'weeks', working_hours_rota -> 'weeks'
    )
  )
)
WHERE working_hours_rota IS NOT NULL
  AND schedule_periods IS NULL
  AND working_hours_rota ->> 'cycle_start' IS NOT NULL
  AND jsonb_typeof(working_hours_rota -> 'weeks') = 'array';
