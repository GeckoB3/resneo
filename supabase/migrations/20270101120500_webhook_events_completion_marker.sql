-- Stripe webhook idempotency: distinguish "claimed" from "completed".
--
-- Today `webhook_events.processed_at` is stamped at INSERT (claim) time via its
-- default, and the row's mere existence is treated as "processed". If a worker
-- dies AFTER claiming an event but BEFORE finishing (OOM, timeout, deploy
-- kill), the claim row survives with no error handler having run, so Stripe's
-- redelivery sees "already processed" and the event is dropped forever. For an
-- async card-hold no-show fee, whose only completer is the webhook, that is a
-- silent stuck charge.
--
-- Fix: add a nullable `completed_at` stamped only when processing SUCCEEDS.
-- The claim path treats a row with `completed_at IS NULL` and a stale
-- `processed_at` (claim time) as reclaimable, so a crashed claim is retried
-- rather than lost. `processed_at` keeps its claim-time meaning so the platform
-- monitoring queries that order/filter on it are unaffected.
--
-- Backfill: every existing row was, under the old model, a successfully
-- processed event (the error path deletes the row), so completed_at = the old
-- processed_at. This prevents a redelivery of a historical event from being
-- seen as never-completed and reprocessed.

ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE webhook_events SET completed_at = processed_at WHERE completed_at IS NULL;

-- Reclaim scan support: find stale, still-uncompleted claims quickly.
CREATE INDEX IF NOT EXISTS idx_webhook_events_incomplete
  ON webhook_events (processed_at)
  WHERE completed_at IS NULL;
