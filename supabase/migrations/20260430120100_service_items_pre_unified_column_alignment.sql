-- Apply columns that older migrations (20260402190000, 20260419120000) add only when
-- public.service_items already existed. On a linear migration run, CREATE TABLE runs in
-- 20260430120000 first; this file ensures those columns exist on every database.

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS staff_may_customize_name boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_description boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_duration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_buffer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_price boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_deposit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS staff_may_customize_colour boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_availability_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_working_hours jsonb;

COMMENT ON COLUMN service_items.custom_availability_enabled IS 'When true, guest slots for this service are intersected with custom_working_hours (venue + calendar + service).';
COMMENT ON COLUMN service_items.custom_working_hours IS 'Weekly TimeRange map (same keys as WorkingHours: "0"–"6").';
