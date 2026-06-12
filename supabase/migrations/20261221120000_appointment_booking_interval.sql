-- Per-service booking interval + per-hour start marks for appointment services.
--
-- `booking_interval_minutes`: granularity (in minutes) of candidate start times offered to
--   guests, anchored to the top of each hour. Replaces the previously hard-coded 15-minute grid
--   in the appointment availability engine. Default 15 preserves prior behaviour for existing rows.
-- `booking_minute_marks`: optional JSON array of minute offsets within the hour (0-59) at which a
--   booking may start. NULL means "no restriction" (every interval mark across the hour is bookable).
--   When set, only these offsets are offered, e.g. [0,5,10,15,20,25] = "first 30 minutes, every 5 min".
--
-- Applied to both the legacy `appointment_services` table and the unified `service_items` table so
-- the field survives whichever data model a venue uses.

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS booking_interval_minutes int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS booking_minute_marks jsonb;

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS booking_interval_minutes int NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS booking_minute_marks jsonb;

-- Keep the interval within a sane, hour-anchored range (1-60 minutes).
ALTER TABLE appointment_services
  DROP CONSTRAINT IF EXISTS appointment_services_booking_interval_minutes_check;
ALTER TABLE appointment_services
  ADD CONSTRAINT appointment_services_booking_interval_minutes_check
  CHECK (booking_interval_minutes BETWEEN 1 AND 60);

ALTER TABLE service_items
  DROP CONSTRAINT IF EXISTS service_items_booking_interval_minutes_check;
ALTER TABLE service_items
  ADD CONSTRAINT service_items_booking_interval_minutes_check
  CHECK (booking_interval_minutes BETWEEN 1 AND 60);

COMMENT ON COLUMN appointment_services.booking_interval_minutes IS
  'Granularity (minutes, 1-60) of guest booking start times, anchored to the top of the hour.';
COMMENT ON COLUMN appointment_services.booking_minute_marks IS
  'Optional JSON int array of allowed start-minute offsets within the hour (0-59). NULL = every interval mark.';
COMMENT ON COLUMN service_items.booking_interval_minutes IS
  'Granularity (minutes, 1-60) of guest booking start times, anchored to the top of the hour.';
COMMENT ON COLUMN service_items.booking_minute_marks IS
  'Optional JSON int array of allowed start-minute offsets within the hour (0-59). NULL = every interval mark.';
