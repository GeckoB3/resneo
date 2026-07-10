-- Card holds: late-cancellation keep (design doc §9.3 amendment; delivers
-- future-work item 2, "late-cancellation fees").
--
-- A cancellation made AFTER the booking's cancellation_deadline no longer
-- releases a SAVED hold: the booking still cancels, but the hold stays open
-- and the no-show fee stays chargeable until the charge window ends. The keep
-- is stamped here so the charge gate can verify the hold was deliberately kept
-- by a late cancellation, not merely left open by a failed release.

ALTER TABLE public.booking_card_holds
  ADD COLUMN IF NOT EXISTS late_cancellation_at timestamptz;

COMMENT ON COLUMN public.booking_card_holds.late_cancellation_at IS
  'Set when the booking was cancelled after its cancellation_deadline with a saved card: the hold is kept and the no-show fee stays chargeable until the charge window ends (or staff release it).';
