-- Optional per-service weekly hours (intersected with venue + calendar hours in the appointment engine).
-- service_items is created in 20260430120000; guard this block on fresh databases.
-- Columns are (re)applied in 20260430120100_service_items_pre_unified_column_alignment.sql.

DO $$
BEGIN
  IF to_regclass('public.service_items') IS NOT NULL THEN
    ALTER TABLE service_items
      ADD COLUMN IF NOT EXISTS custom_availability_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS custom_working_hours jsonb;
    COMMENT ON COLUMN service_items.custom_availability_enabled IS 'When true, guest slots for this service are intersected with custom_working_hours (venue + calendar + service).';
    COMMENT ON COLUMN service_items.custom_working_hours IS 'Weekly TimeRange map (same keys as WorkingHours: "0"–"6").';
  END IF;
END $$;

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS custom_availability_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_working_hours jsonb;

COMMENT ON COLUMN appointment_services.custom_availability_enabled IS 'When true, guest slots for this service are intersected with custom_working_hours.';
COMMENT ON COLUMN appointment_services.custom_working_hours IS 'Weekly TimeRange map (same keys as WorkingHours).';
