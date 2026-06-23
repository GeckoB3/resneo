-- Concurrency guard for the import executor (M3).
--
-- Two concurrent execute POSTs for the same session could both process the same
-- checkpoint and re-insert the same rows (e.g. a double-click on "Resume import",
-- two open tabs, or a concurrent POST arriving just after the first-run batch
-- flips status to 'importing'). The first-run ready->importing transition is
-- already a compare-and-swap, but the resume path had no guard.
--
-- This adds a self-healing lease: the execute route claims the lease with a
-- conditional UPDATE before running a batch and releases it when the batch
-- returns. The timestamp expiry (set longer than the route's maxDuration) means a
-- batch killed mid-run without releasing recovers automatically once the lease
-- lapses. Idempotent.
ALTER TABLE import_sessions
  ADD COLUMN IF NOT EXISTS execute_lease_until timestamptz;
