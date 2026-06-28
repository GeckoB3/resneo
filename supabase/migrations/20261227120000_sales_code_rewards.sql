-- Per-code reward configuration for the salesperson programme.
--
-- Each sales code can grant its own free-trial length (the subscriber-facing reward), so one
-- salesperson can hand out several codes with different offers — e.g. 1 month, 2 months, or a
-- custom length for prospects on a long cancellation notice who need help bridging the switch.
--
-- Existing codes inherit the current behaviour: NOT NULL DEFAULT 30 backfills every row to the
-- 30-day (one month) reward that was previously hardcoded as SALES_SIGNUP_TRIAL_DAYS.

ALTER TABLE public.sales_codes
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS label text;

-- Bound the trial so a typo can't mint a multi-year free ride. Minimum 1 (a sales code always
-- grants at least a 1-day trial — Stripe's trial_period_days floor); maximum one year.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_codes_trial_days_range'
  ) THEN
    ALTER TABLE public.sales_codes
      ADD CONSTRAINT sales_codes_trial_days_range
      CHECK (trial_days >= 1 AND trial_days <= 365);
  END IF;
END $$;

COMMENT ON COLUMN public.sales_codes.trial_days IS
  'Free-trial days granted to a subscriber who signs up with this code (Stripe trial_period_days). Defaults to 30 (one month).';
COMMENT ON COLUMN public.sales_codes.label IS
  'Optional internal note describing the code''s purpose, e.g. "Acme switchers - 2 months free".';
