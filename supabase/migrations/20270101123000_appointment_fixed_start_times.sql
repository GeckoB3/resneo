-- Per-service fixed start times for appointment services.
--
-- `booking_start_times`: optional JSON array of "HH:MM" strings giving the exact times of day a
--   booking may start, e.g. ["09:20","11:30","13:45","15:30"] for a tuner who takes four jobs a day.
--   NULL (or an empty array, which is normalized to NULL on save) means "no fixed times": candidate
--   starts come from `booking_interval_minutes` + `booking_minute_marks` exactly as before.
--   When set, these absolute times replace the hour-anchored grid entirely; the interval and mark
--   columns are still stored so switching back restores the previous configuration.
--
-- A fixed time is only offered when the whole appointment (duration + buffer + processing) fits
-- inside the venue, calendar and service-schedule hours for that date, so the existing custom
-- schedule can still narrow which of the fixed times apply on a given day.
--
-- Applied to both the legacy `appointment_services` table and the unified `service_items` table,
-- matching 20261221120000_appointment_booking_interval.sql.

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS booking_start_times jsonb;

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS booking_start_times jsonb;

COMMENT ON COLUMN appointment_services.booking_start_times IS
  'Optional JSON array of "HH:MM" start times of day. NULL = use booking_interval_minutes/booking_minute_marks.';
COMMENT ON COLUMN service_items.booking_start_times IS
  'Optional JSON array of "HH:MM" start times of day. NULL = use booking_interval_minutes/booking_minute_marks.';
