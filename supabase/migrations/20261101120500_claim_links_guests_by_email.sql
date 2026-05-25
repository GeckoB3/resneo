-- claim_user_account previously only stamped user_profiles.account_claimed_at
-- and did not backfill guests.user_id for rows that match the user's email but
-- were created from imports / phone bookings / pre-account guest checkouts.
--
-- Consequence: a user who is both a venue staff member and an existing contact/
-- guest at the same venue would be treated as "staff only" on login, because
-- `hasGuest` in src/lib/post-login-destination.ts checks guests.user_id only.
-- The post-login chooser at /auth/choose-destination was therefore skipped, and
-- /account/bookings would show no history.
--
-- This migration extends claim_user_account to also link any unclaimed guest
-- rows whose email matches the caller's auth.users email. The link is by email
-- only and only fills NULL user_id values — it never reassigns an existing link.

CREATE OR REPLACE FUNCTION public.claim_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_profiles
  SET
    account_claimed_at = COALESCE(account_claimed_at, now()),
    last_active_at = now(),
    updated_at = now()
  WHERE id = auth.uid();

  -- Backfill unclaimed guest rows for this user's email.
  SELECT lower(trim(u.email)) INTO v_email
  FROM auth.users u
  WHERE u.id = auth.uid();

  IF v_email IS NOT NULL AND v_email <> '' THEN
    UPDATE public.guests g
    SET user_id = auth.uid(),
        updated_at = now()
    WHERE g.user_id IS NULL
      AND NULLIF(trim(COALESCE(g.email, '')), '') IS NOT NULL
      AND lower(trim(g.email)) = v_email;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_user_account() TO authenticated;

-- One-time backfill for users who logged in before this migration shipped.
UPDATE public.guests g
SET user_id = u.id,
    updated_at = now()
FROM auth.users u
WHERE g.user_id IS NULL
  AND NULLIF(trim(COALESCE(g.email, '')), '') IS NOT NULL
  AND lower(trim(g.email)) = lower(trim(u.email));

COMMENT ON FUNCTION public.claim_user_account() IS
  'Marks the auth user''s profile as claimed and links any unlinked guest rows whose email matches the user. Called on every login.';
