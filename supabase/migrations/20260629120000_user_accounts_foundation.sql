-- Reserve NI: user accounts foundation (user_profiles, user_devices, guest/staff account fields,
-- safe account projection view, RLS, auth.users trigger, guest aggregates, staff backfill).

-- -----------------------------------------------------------------------------
-- user_profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  first_name text,
  last_name text,
  phone text,
  profile_image_url text,
  locale text NOT NULL DEFAULT 'en-GB',
  timezone text NOT NULL DEFAULT 'Europe/London',
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_login_destination text,
  stripe_customer_id text,
  account_claimed_at timestamptz,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_default_login_destination_chk
    CHECK (default_login_destination IS NULL OR default_login_destination IN ('account', 'dashboard', 'ask'))
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_last_active ON public.user_profiles (last_active_at DESC);

COMMENT ON TABLE public.user_profiles IS 'Application-level customer/staff profile; 1:1 with auth.users.';

-- -----------------------------------------------------------------------------
-- user_devices (forward-compatible; web may register with platform=web)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  platform text NOT NULL,
  push_token text,
  device_name text,
  app_version text,
  os_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_devices_platform_nonempty CHECK (length(trim(platform)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_devices_user_push_unique
  ON public.user_devices (user_id, push_token)
  WHERE push_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON public.user_devices (user_id);

-- -----------------------------------------------------------------------------
-- guests: account + lifecycle fields
-- -----------------------------------------------------------------------------
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS waiver_signed_at timestamptz;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS waiver_version text;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS first_booked_at timestamptz;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS last_booked_at timestamptz;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS total_bookings_count int NOT NULL DEFAULT 0;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS total_spent_minor bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_guests_user_venue ON public.guests (user_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_guests_venue_last_booked ON public.guests (venue_id, last_booked_at DESC NULLS LAST);

COMMENT ON COLUMN public.guests.user_id IS 'Linked Supabase auth user for account dashboard; nullable for walk-in/import.';
COMMENT ON COLUMN public.guests.marketing_consent IS 'Per-venue positive marketing consent (PECR/GDPR), distinct from marketing_opt_out.';

-- -----------------------------------------------------------------------------
-- staff: auth user link + lifecycle
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id) ON DELETE CASCADE;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS invited_at timestamptz;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Venue-level override: require a Resneo account session before public booking.
ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS require_account_login_for_bookings boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.venues.require_account_login_for_bookings IS
  'When true, public booking flows require an authenticated Resneo account session.';

CREATE UNIQUE INDEX IF NOT EXISTS staff_user_venue_role_active_key
  ON public.staff (user_id, venue_id, role)
  WHERE revoked_at IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_staff_user_id_active ON public.staff (user_id) WHERE revoked_at IS NULL;

COMMENT ON COLUMN public.staff.user_id IS 'Supabase auth user for this staff row; preferred over email for access checks.';

-- Backfill staff.user_id from auth.users email match (case-insensitive trim).
UPDATE public.staff s
SET user_id = u.id,
    accepted_at = COALESCE(s.accepted_at, s.created_at),
    updated_at = now()
FROM auth.users u
WHERE s.user_id IS NULL
  AND s.revoked_at IS NULL
  AND lower(trim(s.email)) = lower(trim(u.email));

-- Backfill guests.user_id where an auth user already exists for the guest email.
-- Missing auth users are created by application booking flows, not bulk-created here.
UPDATE public.guests g
SET user_id = u.id,
    updated_at = now()
FROM auth.users u
WHERE g.user_id IS NULL
  AND NULLIF(trim(g.email), '') IS NOT NULL
  AND lower(trim(g.email)) = lower(trim(u.email));

-- -----------------------------------------------------------------------------
-- Service-role helper: resolve auth user id by email (avoid paginating listUsers in app).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = auth, public
AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(trim(u.email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_auth_user_id_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_auth_user_id_by_email(text) TO service_role;

-- -----------------------------------------------------------------------------
-- user_profiles: backfill + trigger on new auth.users
-- -----------------------------------------------------------------------------
INSERT INTO public.user_profiles (id, display_name, last_active_at, created_at, updated_at)
SELECT
  u.id,
  NULLIF(
    trim(
      COALESCE(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        ''
      )
    ),
    ''
  ),
  COALESCE(u.last_sign_in_at, u.created_at),
  u.created_at,
  now()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    display_name,
    first_name,
    last_name,
    last_active_at,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NULLIF(
      trim(
        COALESCE(
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          ''
        )
      ),
      ''
    ),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), ''),
    NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), ''),
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Keep linked guest emails in sync with auth email changes, but block conflicts
-- with another guest row at the same venue.
CREATE OR REPLACE FUNCTION public.handle_auth_user_email_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  conflict_count int;
  new_email text;
BEGIN
  IF NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;

  new_email := lower(trim(COALESCE(NEW.email, '')));
  IF new_email = '' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO conflict_count
  FROM public.guests linked
  INNER JOIN public.guests existing
    ON existing.venue_id = linked.venue_id
   AND existing.id <> linked.id
   AND lower(trim(COALESCE(existing.email, ''))) = new_email
  WHERE linked.user_id = NEW.id;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Cannot change email: guest record conflict at one or more venues';
  END IF;

  UPDATE public.guests
  SET email = new_email,
      updated_at = now()
  WHERE user_id = NEW.id
    AND NULLIF(trim(COALESCE(email, '')), '') IS NOT NULL;

  UPDATE public.staff
  SET email = new_email,
      updated_at = now()
  WHERE user_id = NEW.id
    AND revoked_at IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_email_change();

-- -----------------------------------------------------------------------------
-- Account claim + touch activity (called from app after successful login)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_user_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
END;
$$;

REVOKE ALL ON FUNCTION public.claim_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_user_account() TO authenticated;

CREATE OR REPLACE FUNCTION public.touch_user_last_active()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_profiles
  SET
    last_active_at = now(),
    updated_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.touch_user_last_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_user_last_active() TO authenticated;

-- -----------------------------------------------------------------------------
-- Guest booking aggregates (maintained from bookings)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_guest_booking_aggregates(p_guest_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt int;
  spent bigint;
  first_ts timestamp without time zone;
  last_ts timestamp without time zone;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE b.status <> 'Cancelled')::int,
    COALESCE(SUM(b.deposit_amount_pence) FILTER (WHERE b.deposit_status = 'Paid'), 0)::bigint,
    MIN(b.booking_date + b.booking_time),
    MAX(b.booking_date + b.booking_time)
  INTO cnt, spent, first_ts, last_ts
  FROM public.bookings b
  WHERE b.guest_id = p_guest_id;

  UPDATE public.guests g
  SET
    total_bookings_count = COALESCE(cnt, 0),
    total_spent_minor = COALESCE(spent, 0),
    first_booked_at = first_ts,
    last_booked_at = last_ts,
    updated_at = now()
  WHERE g.id = p_guest_id;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_guest_booking_aggregates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_guest_booking_aggregates(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_guest_aggregates_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gid uuid;
  old_gid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    gid := OLD.guest_id;
    PERFORM public.refresh_guest_booking_aggregates(gid);
    RETURN OLD;
  END IF;

  gid := NEW.guest_id;
  PERFORM public.refresh_guest_booking_aggregates(gid);

  IF TG_OP = 'UPDATE' AND OLD.guest_id IS DISTINCT FROM NEW.guest_id THEN
    PERFORM public.refresh_guest_booking_aggregates(OLD.guest_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_refresh_guest_aggregates ON public.bookings;
CREATE TRIGGER bookings_refresh_guest_aggregates
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_guest_aggregates_from_booking();

-- Initial backfill (best-effort; trigger maintains going forward)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.guests LOOP
    PERFORM public.refresh_guest_booking_aggregates(r.id);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- Soft-delete request (30-day grace; app completes anonymisation)
-- -----------------------------------------------------------------------------
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

REVOKE ALL ON FUNCTION public.request_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_profiles
  SET deleted_at = NULL,
      updated_at = now()
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated;

-- -----------------------------------------------------------------------------
-- Safe projection for /account (excludes venue-private CRM fields)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.guests_account_safe
WITH (security_barrier = true) AS
SELECT
  g.id,
  g.venue_id,
  g.user_id,
  g.email,
  g.phone,
  g.name,
  g.visit_count,
  g.identifiability_tier,
  g.marketing_consent,
  g.marketing_consent_at,
  g.marketing_opt_out,
  g.waiver_signed_at,
  g.waiver_version,
  g.source,
  g.first_booked_at,
  g.last_booked_at,
  g.total_bookings_count,
  g.total_spent_minor,
  g.created_at,
  g.updated_at
FROM public.guests g
WHERE g.user_id = auth.uid();

COMMENT ON VIEW public.guests_account_safe IS
  'Customer-safe guest projection; excludes venue-private notes/tags/custom_fields/no_show_count.';

-- -----------------------------------------------------------------------------
-- RLS: user_profiles, user_devices, guests account read, staff user_id
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles_select_own" ON public.user_profiles;
CREATE POLICY "user_profiles_select_own"
  ON public.user_profiles FOR SELECT
  USING (id = auth.uid());

DROP POLICY IF EXISTS "user_profiles_update_own" ON public.user_profiles;
CREATE POLICY "user_profiles_update_own"
  ON public.user_profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_devices_all_own" ON public.user_devices;
CREATE POLICY "user_devices_all_own"
  ON public.user_devices FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Account owners must use `guests_account_safe`/server APIs, not raw venue-private guest rows.
DROP POLICY IF EXISTS "guests_select_account_owner" ON public.guests;

-- Extend staff SELECT policies for user_id-based session (keep email fallback).
DROP POLICY IF EXISTS "staff_select_own" ON public.staff;
CREATE POLICY "staff_select_own"
  ON public.staff FOR SELECT
  USING (
    email = (auth.jwt() ->> 'email')
    OR (user_id IS NOT NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "staff_select_venue_staff" ON public.staff;
CREATE POLICY "staff_select_venue_staff"
  ON public.staff FOR SELECT
  USING (
    venue_id IN (
      SELECT s.venue_id
      FROM public.staff s
      WHERE s.email = (auth.jwt() ->> 'email')
         OR (s.user_id IS NOT NULL AND s.user_id = auth.uid())
    )
  );

-- Grants (authenticated users hit PostgREST for account UI where used)
GRANT SELECT, UPDATE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_devices TO authenticated;
GRANT SELECT ON public.guests_account_safe TO authenticated;
