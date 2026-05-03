-- Allow CRM / contacts custom messages without a booking anchor.
-- booking_id nullable + guest_id; partial unique preserves upsert semantics for anchored rows only.

ALTER TABLE communication_logs
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE communication_logs
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES guests (id) ON DELETE SET NULL;

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS unique_message_per_booking_lane;

CREATE UNIQUE INDEX IF NOT EXISTS communication_logs_booking_message_lane_uidx
  ON communication_logs (booking_id, message_type, communication_lane)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS communication_logs_guest_id_created_idx
  ON communication_logs (guest_id, created_at DESC)
  WHERE guest_id IS NOT NULL;
