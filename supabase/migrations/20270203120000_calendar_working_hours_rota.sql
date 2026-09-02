-- Rotating schedule: a calendar's working hours can differ week by week.
--
-- WHAT IT IS FOR. A practitioner who works Monday, Tuesday and Saturday morning
-- one week and Tuesday to Friday the next has no way to say so: `working_hours`
-- is one shape keyed by weekday. This column holds a cycle of two to six weekly
-- shapes, the Monday the cycle starts, and the last date it applies. The
-- resolver picks the week by counting whole weeks since the start, so the
-- pattern repeats on its own. See Docs/rotating-schedule-plan.md.
--
-- WHY NOT REPEATING CLOSURES. Closures are leave, which nothing may book
-- through and which the diary draws as leave. Working hours are what staff may
-- deliberately book outside for a walk-in, and what the diary header states. A
-- rota is working hours.
--
-- SHAPE (validated in src/lib/availability/working-hours-rota.ts):
--   { "version": 1,
--     "cycle_start": "YYYY-MM-DD",        -- a Monday
--     "weeks": [ <working_hours>, ... ],   -- 2 to 6 entries, same shape as working_hours
--     "repeat_until": "YYYY-MM-DD" | null } -- inclusive; null = until further notice
--
-- `working_hours` keeps applying before cycle_start and after repeat_until.
-- NULL means the calendar has no rota, which is every calendar today.
--
-- EXPAND-ONLY: one nullable column. Safe to apply before or after the code.

ALTER TABLE public.unified_calendars
  ADD COLUMN IF NOT EXISTS working_hours_rota jsonb;

COMMENT ON COLUMN public.unified_calendars.working_hours_rota IS
  'Rotating schedule: {version:1, cycle_start (a Monday), weeks: [working_hours x 2..6], '
  'repeat_until|null}. The resolver uses week (weeks since cycle_start mod length) inside '
  'the window and working_hours outside it. NULL = no rota.';
