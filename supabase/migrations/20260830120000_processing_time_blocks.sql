-- Salon-style processing time: internal gaps where the practitioner is free
-- but the client/chair span still occupies the full service duration + buffer.

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS processing_time_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS processing_time_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE service_variants
  ADD COLUMN IF NOT EXISTS processing_time_blocks jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS processing_time_blocks jsonb NULL;

COMMENT ON COLUMN appointment_services.processing_time_blocks IS
  'JSON array of {id, start_minute, duration_minutes} gaps within duration_minutes where practitioner is free.';
COMMENT ON COLUMN service_items.processing_time_blocks IS
  'JSON array of {id, start_minute, duration_minutes} gaps within duration_minutes where practitioner is free.';
COMMENT ON COLUMN service_variants.processing_time_blocks IS
  'Variant-level processing gaps; overrides parent service blocks when a variant is chosen.';
COMMENT ON COLUMN bookings.processing_time_blocks IS
  'Snapshot of processing gaps for this booking; null = derive from service/variant template for legacy rows.';
