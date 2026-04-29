-- Align guest anonymisation emails with uniqueness-safe pattern (runs after user_accounts_foundation):
-- deleted-{user_id}-{guest_id}@reserveni.deleted
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

  UPDATE public.guests
  SET
    name = 'Deleted User',
    email = 'deleted-' || auth.uid()::text || '-' || id::text || '@reserveni.deleted',
    phone = NULL,
    user_id = NULL,
    marketing_consent = false,
    marketing_consent_at = NULL,
    marketing_opt_out = true,
    updated_at = now()
  WHERE user_id = auth.uid();

  RETURN until;
END;
$$;
