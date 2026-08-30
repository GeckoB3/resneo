-- P3-4a: the portal entry token (AD7).
--
-- WHAT IT IS FOR. The account link in a transactional email carries a token
-- that establishes a real Supabase session directly, so a customer reaches
-- their bookings in one click instead of asking for a second email and waiting
-- for it. AD7's justification is consistency, not convenience: the same email
-- already carries a manage link, which lets whoever holds it cancel a booking
-- and trigger a refund with no second factor, so requiring a full email round
-- trip to READ the same booking applies a higher bar to a lower-risk action.
--
-- WHY A TABLE, AND NOT THE STATELESS HMAC this codebase already has in
-- `short-manage-link.ts` and `payment-token.ts`: those pack the expiry into
-- the payload and cannot be revoked before it. This token establishes a
-- SESSION, so revocation has to be possible, which needs somewhere to record
-- that it happened.
--
-- WHY NOT `booking_short_links`, which is the other stored-token table:
-- its `purpose` CHECK is `manage | confirm | payment`, its `booking_id` is NOT
-- NULL with an FK, and `/b/[code]` MUTATES `access_count` on every read. This
-- token is user-scoped rather than booking-scoped, and mutating on read is
-- exactly what it must not do (see below).
--
-- REUSABLE, NEVER SINGLE-USE, AND NO WRITE ON VERIFY. This is a hard
-- requirement rather than an optimisation. Corporate link scanners (Outlook
-- Safe Links, Proofpoint, Mimecast) fetch every URL in inbound mail before the
-- human sees it, so a single-use token is consumed by the scanner and the
-- customer clicks a dead link. That is also why nothing here records a use
-- count: there is no column for one, so no future reader can be tempted.
--
-- THE HASH IS THE KEY. The plaintext token exists only in the email. A dump of
-- this table grants nothing.

CREATE TABLE IF NOT EXISTS public.account_portal_tokens (
  -- sha256 hex of the token, per `src/lib/confirm-token.ts`. Primary key
  -- because lookup is BY hash: the verifier hashes what it was given and reads
  -- one row, and there is nothing else to look a token up by.
  token_hash text PRIMARY KEY,

  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,

  -- The only scope AD7 defines. Constrained rather than left free-form so that
  -- a second scope is a deliberate migration and not a string someone writes.
  scope text NOT NULL DEFAULT 'limited' CHECK (scope = 'limited'),

  -- Which booking's email carried it, for revocation. NULLABLE: a token can be
  -- issued for a customer rather than a booking, and ON DELETE SET NULL so
  -- deleting a booking cannot take a live token with it.
  issued_for_booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,

  /*
    Advisory, and that word is load-bearing (AD7's lifetime rules).

    The verifier DOES refuse an expired token, because that is what bounds the
    link. What must never happen is the LIMITED-SESSION table treating absence
    as full; that is P3-4b's problem and is called out there. Here, expiry is
    checked in the verifier rather than in a partial index, so that a token
    which has expired is still visible to a support query asking why a link
    stopped working.
  */
  expires_at timestamptz NOT NULL,

  -- Set rather than deleted, so a revoked token stays answerable: "was this
  -- revoked, or did it never exist" is a question worth being able to answer.
  revoked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_portal_tokens IS
  'P3-4a / AD7 - one-click portal entry tokens. Hash only, never plaintext. '
  'Reusable within the window and NEVER single-use, because corporate link '
  'scanners fetch every URL in inbound mail and would consume a single-use '
  'token before the customer clicked. Verification must not write to this '
  'table. Service role only: no client ever reads or writes it.';

-- Revocation is by booking ("this booking is long past, kill its links") and
-- by user ("this account is compromised"), so both are indexed. The hash
-- lookup is the primary key and needs nothing.
CREATE INDEX IF NOT EXISTS idx_account_portal_tokens_booking
  ON public.account_portal_tokens (issued_for_booking_id)
  WHERE issued_for_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_account_portal_tokens_user
  ON public.account_portal_tokens (user_id);

-- Supports the cleanup sweep, which deletes rows whose window is long gone.
CREATE INDEX IF NOT EXISTS idx_account_portal_tokens_expires
  ON public.account_portal_tokens (expires_at);

/*
  SERVICE ROLE ONLY, and RLS as the second layer.

  A client that could read this table would hold every live entry token for
  every customer. RLS is enabled with NO policy, which denies everything to
  `anon` and `authenticated` even if a grant is added by accident later:
  P0-6 records that hosted Supabase grants those roles outside the migration
  history, so the REVOKEs below cannot be the only control.
*/
ALTER TABLE public.account_portal_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_portal_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.account_portal_tokens FROM anon;
REVOKE ALL ON TABLE public.account_portal_tokens FROM authenticated;
