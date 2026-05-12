-- Optional clock window per leave row: full day when both times null; otherwise block only that interval on each day in the range.

ALTER TABLE practitioner_leave_periods
  ADD COLUMN IF NOT EXISTS unavailable_start_time time,
  ADD COLUMN IF NOT EXISTS unavailable_end_time time;

COMMENT ON COLUMN practitioner_leave_periods.unavailable_start_time IS
  'With unavailable_end_time, blocks only this time window on each date in [start_date, end_date]. When both null, entire calendar day is unavailable (legacy full-day).';

ALTER TABLE practitioner_leave_periods DROP CONSTRAINT IF EXISTS practitioner_leave_periods_time_pair;

ALTER TABLE practitioner_leave_periods
  ADD CONSTRAINT practitioner_leave_periods_time_pair CHECK (
    (unavailable_start_time IS NULL AND unavailable_end_time IS NULL)
    OR (
      unavailable_start_time IS NOT NULL
      AND unavailable_end_time IS NOT NULL
      AND unavailable_end_time > unavailable_start_time
    )
  );
