-- Resneo: guests + bookings + waitlist + import staging use first_name/last_name instead of single name fields.

-- =============================================================================
-- BOOKINGS: guest phone snapshot (used by pay flow / comms); ensure column exists
-- =============================================================================
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_phone text;

-- =============================================================================
-- BOOKINGS: guest_first_name / guest_last_name (replace guest_name when present)
-- =============================================================================
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS guest_first_name text,
  ADD COLUMN IF NOT EXISTS guest_last_name text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'guest_name'
  ) THEN
    UPDATE public.bookings
    SET
      guest_first_name = CASE
        WHEN guest_name IS NULL OR btrim(guest_name) = '' THEN NULL
        ELSE (regexp_match(btrim(guest_name), '^(\S+)'))[1]
      END,
      guest_last_name = CASE
        WHEN guest_name IS NULL OR btrim(guest_name) = '' THEN NULL
        ELSE nullif(trim(regexp_replace(btrim(guest_name), '^\S+\s*', '')), '')
      END;
    ALTER TABLE public.bookings DROP COLUMN guest_name;
  END IF;
END $$;

COMMENT ON COLUMN public.bookings.guest_first_name IS 'Guest given name snapshot for this booking.';
COMMENT ON COLUMN public.bookings.guest_last_name IS 'Guest surname snapshot for this booking.';

-- =============================================================================
-- WAITLIST
-- =============================================================================
ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS guest_first_name text,
  ADD COLUMN IF NOT EXISTS guest_last_name text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'waitlist_entries' AND column_name = 'guest_name'
  ) THEN
    UPDATE public.waitlist_entries
    SET
      guest_first_name = CASE
        WHEN guest_name IS NULL OR btrim(guest_name) = '' THEN NULL
        ELSE (regexp_match(btrim(guest_name), '^(\S+)'))[1]
      END,
      guest_last_name = CASE
        WHEN guest_name IS NULL OR btrim(guest_name) = '' THEN NULL
        ELSE nullif(trim(regexp_replace(btrim(guest_name), '^\S+\s*', '')), '')
      END;
    ALTER TABLE public.waitlist_entries DROP COLUMN guest_name;
  END IF;
END $$;

-- =============================================================================
-- IMPORT BOOKING ROWS: structured raw name parts
-- =============================================================================
ALTER TABLE public.import_booking_rows
  ADD COLUMN IF NOT EXISTS raw_guest_first_name text,
  ADD COLUMN IF NOT EXISTS raw_guest_last_name text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'import_booking_rows' AND column_name = 'raw_client_name'
  ) THEN
    UPDATE public.import_booking_rows
    SET
      raw_guest_first_name = CASE
        WHEN raw_client_name IS NULL OR btrim(raw_client_name) = '' THEN NULL
        ELSE (regexp_match(btrim(raw_client_name), '^(\S+)'))[1]
      END,
      raw_guest_last_name = CASE
        WHEN raw_client_name IS NULL OR btrim(raw_client_name) = '' THEN NULL
        ELSE nullif(trim(regexp_replace(btrim(raw_client_name), '^\S+\s*', '')), '')
      END;
    ALTER TABLE public.import_booking_rows DROP COLUMN raw_client_name;
  END IF;
END $$;

-- =============================================================================
-- GUESTS: replace name + identifiability_tier generated column
-- =============================================================================
-- guests_account_safe selects identifiability_tier; drop before altering that column.
DROP VIEW IF EXISTS public.guests_account_safe;

DROP INDEX IF EXISTS public.idx_guests_venue_identifiability;

ALTER TABLE public.guests DROP COLUMN IF EXISTS identifiability_tier;

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name text;

UPDATE public.guests
SET
  first_name = CASE
    WHEN name IS NULL OR btrim(name) = '' THEN NULL
    ELSE (regexp_match(btrim(name), '^(\S+)'))[1]
  END,
  last_name = CASE
    WHEN name IS NULL OR btrim(name) = '' THEN NULL
    ELSE nullif(trim(regexp_replace(btrim(name), '^\S+\s*', '')), '')
  END;

ALTER TABLE public.guests DROP COLUMN IF EXISTS name;

ALTER TABLE public.guests
  ADD COLUMN identifiability_tier text GENERATED ALWAYS AS (
    CASE
      WHEN nullif(btrim(COALESCE(email, '')), '') IS NOT NULL
        OR nullif(btrim(COALESCE(phone, '')), '') IS NOT NULL THEN 'identified'
      WHEN (
        (
          (first_name IS NULL OR btrim(COALESCE(first_name, '')) = '')
          AND (last_name IS NULL OR btrim(COALESCE(last_name, '')) = '')
        )
        OR lower(btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) IN ('walk-in', 'walk in')
        OR lower(btrim(COALESCE(first_name, ''))) = 'walk-in'
        OR lower(btrim(COALESCE(last_name, ''))) = 'walk-in'
      )
        AND nullif(btrim(COALESCE(email, '')), '') IS NULL
        AND nullif(btrim(COALESCE(phone, '')), '') IS NULL THEN 'anonymous'
      ELSE 'named'
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_guests_venue_identifiability
  ON public.guests (venue_id, identifiability_tier);

COMMENT ON COLUMN public.guests.first_name IS 'Guest given name.';
COMMENT ON COLUMN public.guests.last_name IS 'Guest surname.';
COMMENT ON COLUMN public.guests.identifiability_tier IS
  'identified: has email or phone; named: real name without contact; anonymous: walk-in / no identity';

-- =============================================================================
-- Views: guests_account_safe
-- =============================================================================
CREATE OR REPLACE VIEW public.guests_account_safe
WITH (security_barrier = true) AS
SELECT
  g.id,
  g.venue_id,
  g.user_id,
  g.email,
  g.phone,
  g.first_name,
  g.last_name,
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

GRANT SELECT ON public.guests_account_safe TO authenticated;

-- =============================================================================
-- RPC: frequent visitors report
-- =============================================================================
-- Return columns changed from `name` to `first_name`/`last_name`; REPLACE cannot alter OUT row type.
DROP FUNCTION IF EXISTS public.report_frequent_visitors(uuid, date, date, integer);

CREATE OR REPLACE FUNCTION public.report_frequent_visitors(
  p_venue_id uuid,
  p_start date,
  p_end date,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  guest_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  visit_count int,
  last_visit_date date,
  bookings_in_period int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    g.id AS guest_id,
    g.first_name,
    g.last_name,
    g.email,
    g.phone,
    g.visit_count,
    g.last_visit_date,
    (
      SELECT COUNT(*)::int
      FROM bookings b
      WHERE b.guest_id = g.id
        AND b.venue_id = p_venue_id
        AND b.booking_date >= p_start
        AND b.booking_date <= p_end
        AND b.status <> 'Cancelled'::booking_status
    ) AS bookings_in_period
  FROM guests g
  WHERE g.venue_id = p_venue_id
    AND g.visit_count >= 1
    AND (
      (g.email IS NOT NULL AND btrim(g.email) <> '')
      OR (g.phone IS NOT NULL AND btrim(g.phone) <> '')
    )
    AND EXISTS (
      SELECT 1
      FROM bookings b2
      WHERE b2.guest_id = g.id
        AND b2.venue_id = p_venue_id
        AND b2.booking_date >= p_start
        AND b2.booking_date <= p_end
        AND b2.status <> 'Cancelled'::booking_status
    )
  ORDER BY g.visit_count DESC, g.last_visit_date DESC NULLS LAST,
    g.first_name ASC NULLS LAST, g.last_name ASC NULLS LAST
  LIMIT p_limit;
$$;

-- =============================================================================
-- RPC: account deletion anonymisation
-- =============================================================================
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
    first_name = 'Deleted',
    last_name = 'User',
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
