-- Account claim: require proof of inbox ownership before linking guest rows.
--
-- claim_user_account runs on every login and links every unlinked guest row whose
-- email matches the caller's, with no check that the address was ever proved.
-- "Confirm email" is off in the production project, so a password signup returns a
-- session immediately: signing up as someone else's address inherited their
-- appointment history, phone number and spend on first login, and allowed
-- cancelling their bookings.
--
-- Measured on production before this change: 677 guest rows carry an email, have
-- no user_id, and have no corresponding auth.users row. Every one of those was
-- claimable. They are predominantly CSV-imported clients, since online and staff
-- bookings already provision an auth user, and an existing auth user makes the
-- attacking signup fail.
--
-- WHAT THIS DOES NOT DO, contrary to an earlier assessment: it does not unlink
-- anybody. The statement is `WHERE g.user_id IS NULL`, so it only ever fills in
-- blanks. Existing links, and therefore existing portals, are untouched.
--
-- The actual cost: of 354 auth users, 56 carry email_confirmed_at (set by using a
-- magic link). The other 298 will not have a NEW guest row at a NEW venue linked
-- until they next click a magic link, which sets the flag permanently. Bounded and
-- self-healing, and the magic link is already in every booking confirmation.
--
-- Deliberately NOT backfilling email_confirmed_at for existing users. It would
-- smooth that transition, but it means writing an assertion into an auth table
-- that is not true, to spare 298 users a degradation most of them will never
-- encounter given current portal usage.
--
-- Body is otherwise identical to 20261101120500.

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
      AND lower(trim(g.email)) = v_email
      -- Only claim on a session whose owner has proved they hold the inbox.
      -- Without this, signing up as someone else's address inherits their guest
      -- rows on first login, because "Confirm email" is off in production and a
      -- password signup returns a session immediately.
      AND EXISTS (
        SELECT 1 FROM auth.users u2
        WHERE u2.id = auth.uid()
          AND u2.email_confirmed_at IS NOT NULL
      );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_user_account() TO authenticated;

COMMENT ON FUNCTION public.claim_user_account() IS
  'Marks the account claimed and links unlinked guest rows matching the caller''s email. Requires auth.users.email_confirmed_at, so a password signup on someone else''s address cannot inherit their records.';
