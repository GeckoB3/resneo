-- Phase 1.4.3: track when a "credits expiring" reminder has been sent for a
-- credit balance batch so the daily cron doesn't re-send it.

ALTER TABLE public.user_class_credit_balances
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

COMMENT ON COLUMN public.user_class_credit_balances.reminder_sent_at IS
  'Stamped by class-credit-expiry cron when the 7-day-before reminder email has been sent.';
