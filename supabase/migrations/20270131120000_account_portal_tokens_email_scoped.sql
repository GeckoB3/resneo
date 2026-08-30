-- P3-4d: portal tokens become EMAIL-scoped, because the people they are for do
-- not have an account yet.
--
-- THE MEASUREMENT THAT FORCED THIS, taken on production 2026-08-29. Of 6,290
-- guest rows, 317 carry a `user_id`. **1,078 distinct guest emails have no
-- `auth.users` row at all**, and zero guests are unclaimed while a user for
-- their address exists. So a customer who has never signed in has no auth user,
-- which is not a gap in the data: nothing in the public booking flow creates
-- one. An account appears when somebody signs in.
--
-- P3-4a made `user_id` NOT NULL against `auth.users`. That made a token
-- impossible to mint for exactly the population P3-4 exists to serve: the
-- first-time booker who has never been in the portal. The feature would have
-- shipped working only for customers who had already solved the problem it
-- addresses.
--
-- WHY NOT CREATE THE ACCOUNT AT BOOKING TIME. It would mean 1,078 auth users
-- for people who never asked for one, most of whom will never click. Instead
-- the account is created WHEN SOMEBODY ACTUALLY CLICKS: verified on staging,
-- `admin.auth.admin.generateLink({ type: 'magiclink' })` creates the user if
-- the address has none, which is what `/auth/portal` already calls. Nobody gets
-- an account they did not touch.
--
-- The address is the identity here in the same way it is for a magic link, and
-- the trust is identical: whoever holds the email sent to that address gets in.

ALTER TABLE public.account_portal_tokens
  ADD COLUMN IF NOT EXISTS email text;

-- `user_id` stays for the tokens that DO have an account behind them, and for
-- revoking every token belonging to one, but it can no longer be required.
ALTER TABLE public.account_portal_tokens
  ALTER COLUMN user_id DROP NOT NULL;

/*
  One of the two must identify somebody, or the row grants a session to nobody
  and the verifier would have to guess. Written as a constraint rather than as a
  rule in TypeScript because the table is the thing that outlives the code.
*/
ALTER TABLE public.account_portal_tokens
  DROP CONSTRAINT IF EXISTS account_portal_tokens_identifies_someone;
ALTER TABLE public.account_portal_tokens
  ADD CONSTRAINT account_portal_tokens_identifies_someone
  CHECK (email IS NOT NULL OR user_id IS NOT NULL);

-- Stored lowercased by the writer; indexed for revoking every token issued to
-- one address, which is the email-scoped equivalent of revoking by user.
CREATE INDEX IF NOT EXISTS idx_account_portal_tokens_email
  ON public.account_portal_tokens (lower(email))
  WHERE email IS NOT NULL;

COMMENT ON COLUMN public.account_portal_tokens.email IS
  'P3-4d - the address this token signs in. Set for customers who have no auth '
  'user yet, which is most first-time bookers: 1,078 guest emails on production '
  'had none. The account is created when the link is clicked, never before.';

COMMENT ON COLUMN public.account_portal_tokens.user_id IS
  'P3-4d - nullable since the email became the identity. Present when the token '
  'was issued to somebody who already had an account.';
