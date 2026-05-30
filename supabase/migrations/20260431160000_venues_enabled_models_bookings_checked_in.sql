-- Multi-model foundation: secondary bookable types + attendance for C/D/E rosters.
-- See Docs/Resneo_Unified_Booking_Functionality.md (Database migrations).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS enabled_models jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN venues.enabled_models IS
  'JSON array of additional booking_model values (secondaries). Primary is always venues.booking_model; only event_ticket, class_session, resource_booking are valid as secondaries in v1.';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz;

COMMENT ON COLUMN bookings.checked_in_at IS
  'Door check-in / roster timestamp for ticketed events, classes, resources. Model B may continue using client_arrived_at; do not overload status=Seated for non-table attendance.';
