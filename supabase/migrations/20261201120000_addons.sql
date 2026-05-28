-- Service Add-Ons: optional extras a client can stack on a service booking.
--
-- Mirrors the service_variants migration pattern with dual FK to support both
-- `service_items` (unified scheduling) and `appointment_services` (legacy).
-- Add-ons are organised into groups so a venue can express selection constraints
-- (single-select / multi-select with min/max). Each `booking_addons` row is an
-- immutable snapshot of what was chosen at booking time.

-- 1. addon_groups -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS addon_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt_to_client text,
  description text,
  selection_type text NOT NULL CHECK (selection_type IN ('single', 'multi')),
  min_select int NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select int CHECK (max_select IS NULL OR max_select >= 0),
  hidden_from_online boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addon_groups_min_le_max CHECK (
    max_select IS NULL OR max_select >= min_select
  ),
  CONSTRAINT addon_groups_single_max_one CHECK (
    selection_type = 'multi'
    OR (selection_type = 'single' AND (max_select IS NULL OR max_select <= 1))
  ),
  CONSTRAINT addon_groups_single_min_le_one CHECK (
    selection_type = 'multi'
    OR (selection_type = 'single' AND min_select IN (0, 1))
  )
);

CREATE INDEX IF NOT EXISTS idx_addon_groups_venue
  ON addon_groups (venue_id);

CREATE INDEX IF NOT EXISTS idx_addon_groups_venue_active
  ON addon_groups (venue_id)
  WHERE is_active = true;

COMMENT ON TABLE addon_groups IS
  'Container for selection constraints on optional add-ons; links to one or many services via service_addon_groups.';

-- 2. addons -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  addon_group_id uuid NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  additional_price_pence int NOT NULL DEFAULT 0 CHECK (additional_price_pence >= 0),
  additional_duration_minutes int NOT NULL DEFAULT 0
    CHECK (additional_duration_minutes BETWEEN 0 AND 240),
  cost_to_business_pence int CHECK (cost_to_business_pence IS NULL OR cost_to_business_pence >= 0),
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_addons_group
  ON addons (addon_group_id);

CREATE INDEX IF NOT EXISTS idx_addons_venue_active
  ON addons (venue_id)
  WHERE is_active = true AND archived_at IS NULL;

COMMENT ON TABLE addons IS
  'Selectable options within an addon_group. Soft-delete via archived_at; price/duration snapshotted to booking_addons.';

-- 3. service_addon_groups ---------------------------------------------------

CREATE TABLE IF NOT EXISTS service_addon_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  service_item_id uuid REFERENCES service_items(id) ON DELETE CASCADE,
  appointment_service_id uuid REFERENCES appointment_services(id) ON DELETE CASCADE,
  addon_group_id uuid NOT NULL REFERENCES addon_groups(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_addon_groups_one_parent CHECK (
    (service_item_id IS NOT NULL)::int + (appointment_service_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT service_addon_groups_unique_service_item UNIQUE (service_item_id, addon_group_id),
  CONSTRAINT service_addon_groups_unique_appt_service UNIQUE (appointment_service_id, addon_group_id)
);

CREATE INDEX IF NOT EXISTS idx_service_addon_groups_service_item
  ON service_addon_groups (service_item_id)
  WHERE service_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_addon_groups_appt_service
  ON service_addon_groups (appointment_service_id)
  WHERE appointment_service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_service_addon_groups_addon_group
  ON service_addon_groups (addon_group_id);

CREATE INDEX IF NOT EXISTS idx_service_addon_groups_venue
  ON service_addon_groups (venue_id);

COMMENT ON TABLE service_addon_groups IS
  'Junction linking an addon_group to one or many services (dual FK to mirror service_variants).';

-- 4. booking_addons (snapshot) ---------------------------------------------

CREATE TABLE IF NOT EXISTS booking_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id uuid REFERENCES addons(id) ON DELETE SET NULL,
  addon_group_id uuid REFERENCES addon_groups(id) ON DELETE SET NULL,
  booking_segment_index int,
  addon_name_snapshot text NOT NULL,
  addon_group_name_snapshot text,
  price_pence_at_booking int NOT NULL CHECK (price_pence_at_booking >= 0),
  duration_minutes_at_booking int NOT NULL DEFAULT 0
    CHECK (duration_minutes_at_booking BETWEEN 0 AND 240),
  cost_to_business_pence_at_booking int
    CHECK (cost_to_business_pence_at_booking IS NULL OR cost_to_business_pence_at_booking >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_addons_booking
  ON booking_addons (booking_id);

CREATE INDEX IF NOT EXISTS idx_booking_addons_addon
  ON booking_addons (addon_id)
  WHERE addon_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_booking_addons_group
  ON booking_addons (addon_group_id)
  WHERE addon_group_id IS NOT NULL;

COMMENT ON TABLE booking_addons IS
  'Immutable snapshot of add-ons chosen at booking time. Snapshot fields are source of truth; FKs may go NULL when catalog rows are deleted.';

-- 5. Aggregate columns on bookings -----------------------------------------

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS addons_total_price_pence int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addons_total_duration_minutes int NOT NULL DEFAULT 0;

-- 6. updated_at triggers ----------------------------------------------------

CREATE OR REPLACE FUNCTION addons_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_addon_groups_updated_at ON addon_groups;
CREATE TRIGGER trg_addon_groups_updated_at
  BEFORE UPDATE ON addon_groups
  FOR EACH ROW EXECUTE PROCEDURE addons_set_updated_at();

DROP TRIGGER IF EXISTS trg_addons_updated_at ON addons;
CREATE TRIGGER trg_addons_updated_at
  BEFORE UPDATE ON addons
  FOR EACH ROW EXECUTE PROCEDURE addons_set_updated_at();

-- 7. Row-Level Security ----------------------------------------------------

ALTER TABLE addon_groups          ENABLE ROW LEVEL SECURITY;
ALTER TABLE addons                ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_addon_groups  ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_addons        ENABLE ROW LEVEL SECURITY;

-- service_role: full access for server APIs
CREATE POLICY "service_role_addon_groups"
  ON addon_groups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_addons"
  ON addons FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_service_addon_groups"
  ON service_addon_groups FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "service_role_booking_addons"
  ON booking_addons FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Staff at venue: manage addon_groups, addons, service_addon_groups
CREATE POLICY "staff_manage_addon_groups"
  ON addon_groups FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

CREATE POLICY "staff_manage_addons"
  ON addons FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

CREATE POLICY "staff_manage_service_addon_groups"
  ON service_addon_groups FOR ALL
  USING (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')));

-- Staff: read booking_addons for their venue's bookings (writes via service_role)
CREATE POLICY "staff_read_booking_addons"
  ON booking_addons FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM bookings b
      JOIN staff s ON s.venue_id = b.venue_id
      WHERE b.id = booking_addons.booking_id
        AND s.email = (auth.jwt() ->> 'email')
    )
  );

-- Public anon: read active, visible add-ons for the booking page
CREATE POLICY "public_read_addon_groups"
  ON addon_groups FOR SELECT TO anon
  USING (is_active = true AND hidden_from_online = false);

CREATE POLICY "public_read_addons"
  ON addons FOR SELECT TO anon
  USING (
    is_active = true
    AND archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM addon_groups g
      WHERE g.id = addons.addon_group_id
        AND g.is_active = true
        AND g.hidden_from_online = false
    )
  );

CREATE POLICY "public_read_service_addon_groups"
  ON service_addon_groups FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM addon_groups g
      WHERE g.id = service_addon_groups.addon_group_id
        AND g.is_active = true
        AND g.hidden_from_online = false
    )
  );

-- Linked accounts: SELECT for venues with full_details grant
CREATE POLICY "linked_venue_can_view_addon_groups"
  ON addon_groups FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) = 'full_details'
  );

CREATE POLICY "linked_venue_can_view_addons"
  ON addons FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) = 'full_details'
  );

CREATE POLICY "linked_venue_can_view_service_addon_groups"
  ON service_addon_groups FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) = 'full_details'
  );

-- End of add-ons migration ----------------------------------------------------
