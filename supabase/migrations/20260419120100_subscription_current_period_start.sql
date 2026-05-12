-- Stripe billing period start (UTC). Used with subscription_current_period_end for SMS tallies aligned to metered billing.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS subscription_current_period_start timestamptz;

COMMENT ON COLUMN venues.subscription_current_period_start IS 'Start of current Stripe subscription billing period (UTC). Updated with period end from webhooks.';
