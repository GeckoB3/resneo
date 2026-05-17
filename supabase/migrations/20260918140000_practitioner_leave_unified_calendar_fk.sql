-- practitioner_leave_periods.practitioner_id stores unified_calendars.id (host columns).
-- Backfill unified_calendars for any leave rows that only exist in legacy practitioners, then retarget FK.

-- 1. Mirror practitioners → unified_calendars for ids referenced by leave but missing from UC
INSERT INTO unified_calendars (
  id,
  venue_id,
  name,
  staff_id,
  slug,
  working_hours,
  break_times,
  break_times_by_day,
  days_off,
  sort_order,
  is_active,
  colour,
  calendar_type
)
SELECT
  p.id,
  p.venue_id,
  p.name,
  p.staff_id,
  p.slug,
  COALESCE(p.working_hours, '{}'::jsonb),
  COALESCE(p.break_times, '[]'::jsonb),
  p.break_times_by_day,
  COALESCE(p.days_off, '[]'::jsonb),
  COALESCE(p.sort_order, 0),
  COALESCE(p.is_active, true),
  '#3B82F6',
  'practitioner'
FROM practitioners p
WHERE EXISTS (
  SELECT 1
  FROM practitioner_leave_periods l
  WHERE l.practitioner_id = p.id
    AND l.venue_id = p.venue_id
)
AND NOT EXISTS (
  SELECT 1 FROM unified_calendars uc WHERE uc.id = p.id
)
ON CONFLICT (id) DO NOTHING;

-- 2. Drop legacy FK to practitioners
ALTER TABLE practitioner_leave_periods
  DROP CONSTRAINT IF EXISTS practitioner_leave_periods_practitioner_id_fkey;

-- 3. Point FK at unified_calendars (same UUID space as dashboard calendar columns)
ALTER TABLE practitioner_leave_periods
  ADD CONSTRAINT practitioner_leave_periods_practitioner_id_fkey
  FOREIGN KEY (practitioner_id) REFERENCES unified_calendars (id) ON DELETE CASCADE;

COMMENT ON COLUMN practitioner_leave_periods.practitioner_id IS
  'Host calendar column id (unified_calendars.id). Legacy venues may share the same UUID as practitioners.id.';
