-- Service variants: optional sub-options for appointment-style services.
--
-- A service may declare 0 or more variants. When 0, the service is bookable as-is and
-- duration/price/deposit are taken from the parent (current behavior, no change).
-- When 1+, the guest must pick exactly one variant during booking; the variant's
-- duration/price (and optional deposit) override the parent's bookable values.
-- Parent service keeps payment_requirement and is used for staff/calendar assignment.

CREATE TABLE IF NOT EXISTS service_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  -- Exactly one of these two FKs is set, matching the venue's service-data path.
  service_item_id uuid REFERENCES service_items(id) ON DELETE CASCADE,
  appointment_service_id uuid REFERENCES appointment_services(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes int NOT NULL CHECK (duration_minutes BETWEEN 5 AND 480),
  buffer_minutes int NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
  price_pence int CHECK (price_pence IS NULL OR price_pence >= 0),
  deposit_pence int CHECK (deposit_pence IS NULL OR deposit_pence >= 0),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_variants_one_parent CHECK (
    (service_item_id IS NOT NULL)::int + (appointment_service_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS idx_service_variants_venue
  ON service_variants (venue_id);

CREATE INDEX IF NOT EXISTS idx_service_variants_service_item
  ON service_variants (service_item_id)
  WHERE service_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_variants_appointment_service
  ON service_variants (appointment_service_id)
  WHERE appointment_service_id IS NOT NULL;

COMMENT ON TABLE service_variants IS
  'Optional sub-options for an appointment-style service. When present, customers must pick one; variant duration/price overrides parent for the booking.';

-- Bookings: store the chosen variant so admin/communications can show the exact option.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS service_variant_id uuid
    REFERENCES service_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_service_variant
  ON bookings (service_variant_id)
  WHERE service_variant_id IS NOT NULL;

ALTER TABLE service_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_manage_service_variants"
  ON service_variants FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

CREATE POLICY "service_role_service_variants"
  ON service_variants FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "public_read_service_variants"
  ON service_variants FOR SELECT TO anon
  USING (is_active = true);
