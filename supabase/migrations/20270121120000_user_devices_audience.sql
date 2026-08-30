-- P0-13 (R1): an audience discriminator on user_devices.
--
-- WHY THIS CANNOT WAIT. `sendStaffPush` selects EVERY row for a user_id
-- (staff-push-notification.ts) and pushes staff booking alerts to all of them.
-- Today only the staff app writes to this table, so that is harmless. The
-- moment a customer app registers a device, a dual-role person, which linked
-- accounts actively create, receives staff booking alerts in the customer app
-- and customer alerts on their work phone. Once both apps have written rows
-- there is no column that says which is which, and the origin is unrecoverable:
-- platform, device_name and push_token are all identical in shape. This column
-- has to exist BEFORE the second writer, not after.
--
-- WHY THE DEFAULT IS NOT COSMETIC. Build 1.0.7 is in the stores and its device
-- payload carries no audience field (registerDevice.ts). A NOT NULL column
-- without a default fails every registration from that build and kills staff
-- push for every existing user. A CHECK that requires the client to DECLARE its
-- audience has the same effect and could only be gated behind a client header
-- that no shipped build sends, so the constraint below bounds the value domain
-- and nothing more.
--
-- 'staff' is the right default for the backfill as well as for new rows:
-- every row in this table today was written by the staff app, because it is
-- currently the only writer.

ALTER TABLE public.user_devices
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'staff';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_devices_audience_check'
      AND conrelid = 'public.user_devices'::regclass
  ) THEN
    ALTER TABLE public.user_devices
      ADD CONSTRAINT user_devices_audience_check
      CHECK (audience IN ('staff', 'customer'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_devices.audience IS
  'Which app registered this device: staff or customer. Defaults to staff because '
  'the shipped staff build sends no audience field. sendStaffPush must filter on '
  'this, or a dual-role user gets staff alerts in the customer app (P0-13).';

-- The staff push sender reads (user_id, audience) together on every send, and
-- the existing index is on user_id alone.
CREATE INDEX IF NOT EXISTS idx_user_devices_user_audience
  ON public.user_devices (user_id, audience);

-- The RLS policy is `user_id = auth.uid()` FOR ALL, so it already covers this
-- column. Grants are a different matter: hosted Supabase manages them outside
-- the migration history, so `npm run check:table-grants` verifies that
-- `authenticated` can still write the column. A new column a client cannot
-- write means every device registration starts failing, silently, on a table
-- whose failure mode is "push notifications quietly stop".
