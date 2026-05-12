-- Temporary walk-in tables allow staff to seat a guest even when no configured
-- table is formally available. They are linked to one booking and removed when
-- that booking reaches a terminal lifecycle state.

ALTER TABLE venue_tables
  ADD COLUMN IF NOT EXISTS is_temporary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_booking_id uuid REFERENCES bookings (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_venue_tables_temporary_booking
  ON venue_tables (temporary_booking_id)
  WHERE is_temporary = true;

COMMENT ON COLUMN venue_tables.is_temporary IS
  'True for ad hoc walk-in tables created by staff when overriding table availability.';

COMMENT ON COLUMN venue_tables.temporary_booking_id IS
  'Booking that owns this temporary walk-in table. Temporary tables are removed when the booking is completed/cancelled/no-show.';
