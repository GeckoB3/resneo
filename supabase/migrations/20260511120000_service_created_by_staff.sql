-- Track which staff member created a bookable service so non-creator staff cannot edit/delete the definition.

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES staff (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_items_created_by_staff
  ON service_items (created_by_staff_id)
  WHERE created_by_staff_id IS NOT NULL;

COMMENT ON COLUMN service_items.created_by_staff_id IS 'Staff row that created this service; non-admin editors must match.';

ALTER TABLE appointment_services
  ADD COLUMN IF NOT EXISTS created_by_staff_id uuid REFERENCES staff (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointment_services_created_by_staff
  ON appointment_services (created_by_staff_id)
  WHERE created_by_staff_id IS NOT NULL;

COMMENT ON COLUMN appointment_services.created_by_staff_id IS 'Staff row that created this service; non-admin editors must match.';
