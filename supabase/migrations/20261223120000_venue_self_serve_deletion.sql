-- Self-serve venue deletion: 30-day grace-period marker on venues.
-- A venue admin schedules deletion (sets deletion_scheduled_at = now + 30 days); the
-- `venue-hard-delete` cron purges storage + calls admin_hard_delete_venue once the date elapses.
-- Mirrors the customer-account flow (user_profiles.deleted_at + account-hard-delete cron).
--
-- Audit columns (deletion_requested_by / _email) are intentionally FK-free: the hard-delete
-- path deletes the venue's staff rows, and we don't want a venues -> staff FK complicating it.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS deletion_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_requested_by uuid,
  ADD COLUMN IF NOT EXISTS deletion_requested_by_email text;

-- Partial index keeps the daily cron's "due for deletion" scan cheap.
CREATE INDEX IF NOT EXISTS idx_venues_deletion_scheduled_at
  ON public.venues (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;

COMMENT ON COLUMN public.venues.deletion_scheduled_at IS
  'When set, the venue is scheduled for permanent hard-deletion at this timestamp (30-day self-serve grace period). NULL = not scheduled. Cleared if the admin cancels.';
COMMENT ON COLUMN public.venues.deletion_requested_at IS
  'When the venue admin requested deletion.';
COMMENT ON COLUMN public.venues.deletion_requested_by IS
  'staff.id of the admin who requested deletion (audit only; no FK so hard-delete is unconstrained).';
COMMENT ON COLUMN public.venues.deletion_requested_by_email IS
  'Email of the admin who requested deletion (audit; survives staff-row removal).';
