-- Allow CRM / contacts custom messages without a booking anchor.
-- booking_id nullable + guest_id; partial unique preserves upsert semantics for anchored rows only.

ALTER TABLE communication_logs
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests (id) ON DELETE SET NULL;

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS unique_message_per_booking_lane;

-- Partial unique on (booking_id, message_type, communication_lane) deferred: `communication_lane`
-- is added in 20260601000000_lane_keyed_communication_policies.sql (after this file). That migration
-- adds table constraint `unique_message_per_booking_lane`, which enforces the same keys for
-- booking-anchored rows.

CREATE INDEX IF NOT EXISTS communication_logs_guest_id_created_idx
  ON communication_logs (guest_id, created_at DESC)
  WHERE guest_id IS NOT NULL;
