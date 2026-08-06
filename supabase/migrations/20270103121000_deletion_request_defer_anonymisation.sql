-- Account deletion: stop destroying the customer's identity at request time.
--
-- `request_account_deletion` set a 30-day `deleted_at` AND immediately anonymised
-- every linked guest row: first_name, last_name, email overwritten, phone nulled,
-- and user_id set to NULL. `cancel_account_deletion` only clears `deleted_at`, so
-- none of that came back.
--
-- The confirmation email we send tells the customer they can cancel before the
-- deletion date. They cannot. By the time they try, their name and contact details
-- are gone at every venue, their account is unlinked from their bookings, and the
-- venue they are booked with next week can no longer contact them. That is a data
-- integrity defect and a statement to a data subject that is not true.
--
-- After this migration the request marks intent only. The hard-delete cron
-- (src/app/api/cron/account-hard-delete/route.ts) performs the anonymisation when
-- the grace period actually elapses, which is where it always belonged.
--
-- WHAT IS DELIBERATELY KEPT AT REQUEST TIME: the marketing opt-out. Asking to be
-- deleted is an unambiguous objection to marketing, and honouring it immediately
-- costs the customer nothing if they change their mind. Keeping it here also means
-- the existing consent checks in the marketing send paths continue to suppress
-- correctly during the grace period, without a second gate. Operational messages
-- about a booking they still hold continue, which is both what the customer needs
-- and defensible: erasure is not instantaneous, and the booking is live until they
-- either attend it or cancel it.
--
-- NOT ADDRESSED HERE: rows anonymised by the previous behaviour are unrecoverable.
-- No backfill can restore them, and inventing values would be worse than the gap.

CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  until timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  until := now() + interval '30 days';

  UPDATE public.user_profiles
  SET
    deleted_at = until,
    updated_at = now()
  WHERE id = auth.uid();

  -- Marketing stops now. Identity is left intact so the request stays reversible
  -- until `until` passes; the hard-delete cron anonymises at that point.
  UPDATE public.guests
  SET
    marketing_consent = false,
    marketing_consent_at = NULL,
    marketing_opt_out = true,
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN until;
END;
$$;

COMMENT ON FUNCTION public.request_account_deletion() IS
  'Marks a 30-day deletion grace period and opts the customer out of marketing. Does NOT anonymise: that happens in the account-hard-delete cron once the period elapses, so the request stays cancellable as the confirmation email promises.';

-- `cancel_account_deletion` is unchanged and still clears `deleted_at` only. It
-- deliberately does NOT restore marketing consent: opting back in is a separate,
-- affirmative act the customer makes in their profile, not something we infer
-- from them changing their mind about deletion.
