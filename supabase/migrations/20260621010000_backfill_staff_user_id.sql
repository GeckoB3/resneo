-- Backfill staff.user_id from auth.users by email (egress optimisation).
--
-- staff.user_id is created in 20260629120000_user_accounts_foundation.sql, which
-- also backfills it. This migration is dated earlier for historical ordering on
-- databases that already had the column; on fresh installs it is a no-op until
-- that column exists.
--
-- Idempotent: only fills rows where user_id is currently null and a single
-- matching auth user exists for that email.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff'
      AND column_name = 'user_id'
  ) THEN
    RETURN;
  END IF;

  UPDATE public.staff AS s
  SET user_id = u.id
  FROM auth.users AS u
  WHERE s.user_id IS NULL
    AND s.email IS NOT NULL
    AND lower(s.email) = lower(u.email)
    AND (
      SELECT count(*)
      FROM auth.users AS u2
      WHERE lower(u2.email) = lower(s.email)
    ) = 1;
END $$;
