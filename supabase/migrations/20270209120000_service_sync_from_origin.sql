-- Members' service copies follow the origin's scheduling shape.
-- Docs/collective-service-sync-plan.md; spec §7.7.3.
--
-- EXPAND ONLY: three nullable-or-defaulted columns and one index. Old code ignores them.
--
-- A copy made by the combined-page tick (§7.7.2) records the origin it came from and starts
-- `linked`; the origin's duration, buffer, processing periods and variants are written to it
-- on every save of the origin while the two venues share a live collective. A member's own
-- edit to a synced field makes the copy `customised`; the host may set it `independent`.
--
-- The DEFAULT is the owner's rule that sync is NOT retroactive: every row that exists when
-- this runs is `independent`, whether or not it was created by a tick.

ALTER TABLE service_items
  ADD COLUMN IF NOT EXISTS synced_from_service_id uuid REFERENCES service_items (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'independent',
  ADD COLUMN IF NOT EXISTS synced_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'service_items_sync_state_valid'
  ) THEN
    ALTER TABLE service_items
      ADD CONSTRAINT service_items_sync_state_valid
      CHECK (sync_state IN ('independent', 'linked', 'customised'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_items_synced_from
  ON service_items (synced_from_service_id)
  WHERE sync_state = 'linked';

COMMENT ON COLUMN service_items.synced_from_service_id IS
  'The origin service this copy was made from by the combined-page tick. Null for a service that is not a copy, or whose origin was deleted.';
COMMENT ON COLUMN service_items.sync_state IS
  'independent: never follows the origin (every pre-existing row). linked: duration, buffer, processing periods and variants follow the origin on its save. customised: the member edited a synced field; the host may re-sync.';
COMMENT ON COLUMN service_items.synced_at IS
  'When the copy last matched the origin.';
