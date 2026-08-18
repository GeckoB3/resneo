-- Stage 6a of the scheduling resolver plan: calendar date overrides.
-- Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §2.4, §4 Stage 6a.
--
-- EXPAND ONLY. This migration adds a table and backfills it. It drops nothing, renames
-- nothing, adds no CHECK or NOT NULL to an existing column, and leaves
-- `practitioner_leave_periods` and every other source exactly as it is.
--
-- That is not tidiness, it is the deploy ritual: migrations reach production BEFORE the
-- code that uses them is merged, so for the whole window production runs the OLD code
-- against the NEW schema. An expand migration is invisible to old code. A contraction is a
-- 42703 and the route 500s -- `resource-booking-engine.ts` selects
-- `id, working_hours, days_off, break_times, break_times_by_day` explicitly, so dropping
-- either column would take the entire resource booking engine down mid-window. Contraction
-- is Stage 6b, a separate pass of the full ritual, after this is live and soaked.
--
-- WHY A NEW TABLE rather than a type discriminator on `practitioner_leave_periods`:
-- that table is FK'd to `practitioners`, which has zero rows, while every calendar now
-- lives in `unified_calendars`. Extending it would mean re-pointing an FK on a table that
-- still has live readers. A new table named for what it is costs one backfill and leaves
-- the old one untouched for Stage 6b to retire on its own schedule.

CREATE TABLE IF NOT EXISTS calendar_date_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  -- unified_calendars, NOT practitioners. Every calendar (staff, resource, class, event
  -- column) is a row there; `practitioners` has no production rows and its FK is the
  -- reason practitioner_calendar_blocks can never receive one.
  calendar_id uuid NOT NULL REFERENCES unified_calendars (id) ON DELETE CASCADE,

  -- 'closed'  -> the calendar is unavailable for this window (what leave becomes)
  -- 'hours'   -> the calendar works exactly these periods, REPLACING its weekly shape
  override_kind text NOT NULL CHECK (override_kind IN ('closed', 'hours')),

  date_start date NOT NULL,
  date_end date NOT NULL,

  -- Null pair on a 'closed' row = the whole day, matching
  -- practitioner_leave_periods.unavailable_start_time/_end_time. A set pair is that window
  -- repeated on every date in the range, which is how partial leave already behaves.
  time_start time,
  time_end time,

  -- Required for 'hours', ignored for 'closed'. [{"open":"09:00","close":"17:00"}, ...]
  periods jsonb,

  -- Carried from practitioner_leave_periods rather than dropped. `leave_type` is read by no
  -- engine, but a venue typed it in and reads it back in the leave panel: it is HR data, and
  -- "unread by an availability engine" is not the same as "safe to discard" (§1.3 tier 3).
  leave_type text,
  notes text,
  source_leave_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_date_overrides_date_order CHECK (date_end >= date_start),
  CONSTRAINT calendar_date_overrides_time_pair CHECK (
    (time_start IS NULL AND time_end IS NULL)
    OR (time_start IS NOT NULL AND time_end IS NOT NULL AND time_end > time_start)
  ),
  -- An 'hours' override with no periods is invalid DATA, not an intent to close. The
  -- resolver ignores such a row rather than shutting the day (§2.2); refusing it here stops
  -- one being written in the first place, which is the same fix Stage 1 applied to
  -- availability_blocks' PATCH schema.
  CONSTRAINT calendar_date_overrides_hours_need_periods CHECK (
    override_kind <> 'hours'
    OR (jsonb_typeof(periods) = 'array' AND jsonb_array_length(periods) > 0)
  )
);

COMMENT ON TABLE calendar_date_overrides IS
  'Per-date Closed and Hours overrides for a unified_calendars column. Stage 6a of the scheduling resolver plan; leave rows are backfilled here and practitioner_leave_periods stays authoritative until Stage 6b.';

CREATE INDEX IF NOT EXISTS idx_calendar_date_overrides_venue_range
  ON calendar_date_overrides (venue_id, date_start, date_end);

CREATE INDEX IF NOT EXISTS idx_calendar_date_overrides_calendar_range
  ON calendar_date_overrides (calendar_id, date_start, date_end);

-- Makes the backfill re-runnable and stops a double-push duplicating every leave row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_date_overrides_source_leave
  ON calendar_date_overrides (source_leave_id)
  WHERE source_leave_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill: leave periods -> closed overrides.
--
-- Only rows whose practitioner_id matches a unified_calendars row are copied. The column is
-- FK'd to `practitioners`, and `20260918140000` re-pointed leave at unified calendars
-- without renaming it, so the id space is shared but not guaranteed. A row that matches
-- nothing is left behind rather than silently dropped on the floor: it stays in
-- practitioner_leave_periods, which this migration does not touch, and Stage 6b's
-- pre-contraction check will surface it.
-- ---------------------------------------------------------------------------
INSERT INTO calendar_date_overrides (
  venue_id, calendar_id, override_kind, date_start, date_end,
  time_start, time_end, leave_type, notes, source_leave_id, created_at
)
SELECT
  l.venue_id,
  l.practitioner_id,
  'closed',
  l.start_date,
  l.end_date,
  l.unavailable_start_time,
  l.unavailable_end_time,
  l.leave_type,
  l.notes,
  l.id,
  l.created_at
FROM practitioner_leave_periods l
JOIN unified_calendars uc ON uc.id = l.practitioner_id AND uc.venue_id = l.venue_id
WHERE NOT EXISTS (
  SELECT 1 FROM calendar_date_overrides o WHERE o.source_leave_id = l.id
)
-- Defensive: a legacy row with an inverted or equal time pair would violate the CHECK and
-- abort the whole migration. Copy it as a whole-day closure instead, which is what the
-- engines already do with such a row.
AND (
  (l.unavailable_start_time IS NULL AND l.unavailable_end_time IS NULL)
  OR (l.unavailable_start_time IS NOT NULL
      AND l.unavailable_end_time IS NOT NULL
      AND l.unavailable_end_time > l.unavailable_start_time)
);

-- ---------------------------------------------------------------------------
-- RLS and grants.
--
-- Modelled on practitioner_leave_periods (20260428120000) and the grant posture
-- 20270113120000 established. Three things here are load-bearing and easy to omit:
--   * the service_role policy -- without it the app cannot reach the table at all;
--   * NO `TO anon` SELECT policy -- 20270113120000 exists because nine such policies
--     leaked every venue's schedule platform-wide;
--   * the full six-verb REVOKE. Omitting TRUNCATE is the one that would hurt.
-- ---------------------------------------------------------------------------
ALTER TABLE calendar_date_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_manage_calendar_date_overrides" ON calendar_date_overrides;
CREATE POLICY "staff_manage_calendar_date_overrides"
  ON calendar_date_overrides FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

DROP POLICY IF EXISTS "service_role_calendar_date_overrides" ON calendar_date_overrides;
CREATE POLICY "service_role_calendar_date_overrides"
  ON calendar_date_overrides FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.calendar_date_overrides FROM anon, authenticated;
GRANT SELECT ON public.calendar_date_overrides TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICATION -- run against the environment just migrated, not from this file.
--
-- Hosted Supabase grants anon/authenticated a full default privilege set through
-- project-level defaults that live outside this repository, and table privileges are
-- checked BEFORE RLS. A local pgTAP pass therefore proves nothing about staging or
-- production; run this on each separately and expect SELECT only for both roles.
--
--   SELECT grantee, privilege_type
--     FROM information_schema.role_table_grants
--    WHERE table_name = 'calendar_date_overrides'
--      AND grantee IN ('anon','authenticated')
--    ORDER BY grantee, privilege_type;
--
-- Then confirm the backfill landed, and that nothing was left behind:
--
--   SELECT count(*) AS overrides FROM calendar_date_overrides WHERE source_leave_id IS NOT NULL;
--   SELECT count(*) AS leave_rows FROM practitioner_leave_periods;
--   SELECT l.id FROM practitioner_leave_periods l
--     LEFT JOIN calendar_date_overrides o ON o.source_leave_id = l.id
--    WHERE o.id IS NULL;   -- rows not copied: no matching calendar, or an invalid time pair
-- ---------------------------------------------------------------------------
