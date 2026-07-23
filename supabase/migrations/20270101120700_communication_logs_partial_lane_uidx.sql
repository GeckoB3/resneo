-- Reconcile communication_logs uniqueness with what production actually runs.
--
-- 20260503104500 made booking_id nullable for CRM/contacts messages and deferred the
-- partial unique index; 20260601000000 instead added a full table constraint
-- (unique_message_per_booking_lane). Production was later changed by hand to the partial
-- index `communication_logs_booking_message_lane_uidx`, leaving migrations and the live
-- schema out of step. The two are functionally identical (NULL booking_id rows are
-- distinct under either rule), but only the partial form is present in production.
--
-- Codify the partial index so every environment matches. Note that a partial index can
-- never be inferred by `ON CONFLICT (cols)` — PostgREST sends column names only, not the
-- index predicate — so writers must use insert-then-update, not `.upsert({ onConflict })`.
-- See upsertPending in src/lib/communications/delivery.ts.

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS unique_message_per_booking_lane;

CREATE UNIQUE INDEX IF NOT EXISTS communication_logs_booking_message_lane_uidx
  ON communication_logs (booking_id, message_type, communication_lane)
  WHERE booking_id IS NOT NULL;
