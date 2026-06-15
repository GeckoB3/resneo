-- One Stripe customer maps to exactly one venue.
--
-- Two signup-provisioning paths race for the same checkout: the success-page POST
-- (/api/signup/complete) and the checkout.session.completed subscription webhook.
-- Each has an app-level "already provisioned?" pre-check, but the check-then-insert
-- window means both can pass and insert, producing duplicate venues for one customer
-- (and a doubled subscription/attribution/notification trail).
--
-- A partial UNIQUE index closes that window at the database: the losing racer's INSERT
-- fails with SQLSTATE 23505, which both provisioning paths now catch and resolve to the
-- already-created venue instead of erroring. Partial (WHERE NOT NULL) so the many
-- founding/legacy/in-progress venues that never set a customer id are unaffected -- NULLs
-- are never "equal" in a unique index. Audit on 2026-06-15 found 0 existing duplicates,
-- so the index builds cleanly.
--
-- Replaces the older non-unique idx_venues_stripe_customer (same column + predicate): a
-- unique index serves the same equality lookups, so the plain index is redundant once
-- this one exists.

DROP INDEX IF EXISTS idx_venues_stripe_customer;

CREATE UNIQUE INDEX IF NOT EXISTS venues_stripe_customer_id_unique
  ON venues (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
