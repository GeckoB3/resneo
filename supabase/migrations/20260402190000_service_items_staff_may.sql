-- Align service_items with appointment_services staff-customization flags (unified scheduling).
-- Table is created in 20260430120000_unified_scheduling_engine.sql; guard so fresh DBs do not fail.
-- Columns are (re)applied in 20260430120100_service_items_pre_unified_column_alignment.sql after CREATE TABLE.

DO $$
BEGIN
  IF to_regclass('public.service_items') IS NOT NULL THEN
    ALTER TABLE service_items
      ADD COLUMN IF NOT EXISTS staff_may_customize_name boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_description boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_duration boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_buffer boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_price boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_deposit boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS staff_may_customize_colour boolean NOT NULL DEFAULT false;
  END IF;
END $$;
