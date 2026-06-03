-- Reserve NI: appointment-anchored form-link reminders (improvement plan Phase 1, G3).
--
-- Adds reminder tracking to compliance_form_links so the nightly/periodic cron can
-- chase a guest to complete a pending form before their booking, capped at a small
-- number of sends and suppressed once the link is consumed.

ALTER TABLE public.compliance_form_links
  ADD COLUMN IF NOT EXISTS reminder_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

-- Find pending links attached to a booking that still need chasing.
CREATE INDEX IF NOT EXISTS idx_compliance_form_links_reminder
  ON public.compliance_form_links (venue_id, booking_id)
  WHERE status = 'pending' AND booking_id IS NOT NULL;
