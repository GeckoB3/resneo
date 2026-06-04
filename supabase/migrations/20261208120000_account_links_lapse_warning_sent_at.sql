-- §16.1 #7 — make the foreseeable-lapse warning (§6.7) idempotent.
--
-- Previously the daily cron relied on a 6–7-day "lapses soon" window aligning
-- with the once-daily schedule to avoid double-sending. A manual re-run inside
-- that window double-sent the warning. We now persist when a link's lapse
-- warning was sent and gate on it; the flag is cleared when the link resumes so
-- a future lapse cycle re-warns.

ALTER TABLE account_links
  ADD COLUMN IF NOT EXISTS lapse_warning_sent_at timestamptz;

COMMENT ON COLUMN account_links.lapse_warning_sent_at IS
  'When the §6.7 foreseeable-lapse warning was last sent for this link. Gates the daily cron against double-sending; cleared on resume so a future lapse re-warns.';
