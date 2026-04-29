-- Service-role helper: true when any guests row already uses this email for a different auth user (or unlinked).
CREATE OR REPLACE FUNCTION public.guest_email_collides_for_user_change(p_email text, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.guests g
    WHERE lower(trim(g.email)) = lower(trim(p_email))
      AND g.user_id IS DISTINCT FROM p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.guest_email_collides_for_user_change(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_email_collides_for_user_change(text, uuid) TO service_role;

-- After auth email is updated, keep linked venue guest rows in sync.
CREATE OR REPLACE FUNCTION public.sync_guests_email_after_auth_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND new.email IS DISTINCT FROM old.email AND new.email IS NOT NULL THEN
    UPDATE public.guests
    SET
      email = new.email::text,
      updated_at = now()
    WHERE user_id = new.id;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guests_email_on_auth_users ON auth.users;
CREATE TRIGGER trg_sync_guests_email_on_auth_users
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_guests_email_after_auth_email_change();
