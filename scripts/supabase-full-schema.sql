-- Reserve NI: Full schema - paste this entire file into Supabase SQL Editor and run once.
-- Order: enums → tables → RLS → triggers → storage → staff policies → stripe/webhook
--        → reminder columns → reconciliation & reporting → staff RLS fix → schema gaps

-- ========== 20260301000001_create_enums.sql ==========
-- Reserve NI: custom enums for venues, staff, and bookings

CREATE TYPE staff_role AS ENUM ('admin', 'staff');

CREATE TYPE booking_status AS ENUM (
  'Pending',
  'Confirmed',
  'Cancelled',
  'No-Show',
  'Completed',
  'Seated'
);

CREATE TYPE booking_source AS ENUM ('online', 'phone', 'walk-in');

CREATE TYPE deposit_status AS ENUM (
  'Not Required',
  'Pending',
  'Paid',
  'Refunded',
  'Forfeited'
);

-- ========== 20260301000002_create_venues.sql ==========
-- Reserve NI: venues table (core venue profile)

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  address text,
  phone text,
  email text,
  cover_photo_url text,
  opening_hours jsonb,
  booking_rules jsonb,
  deposit_config jsonb,
  availability_config jsonb,
  timezone text NOT NULL DEFAULT 'Europe/London',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_venues_slug ON venues (slug);

-- ========== 20260301000003_create_staff.sql ==========
-- Reserve NI: staff table (venue staff, linked to Supabase Auth by email)

CREATE TABLE staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  email text NOT NULL,
  name text,
  phone text,
  role staff_role NOT NULL DEFAULT 'staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_venue_id ON staff (venue_id);
CREATE INDEX idx_staff_email ON staff (email);

-- One email can be staff at multiple venues; no unique on email alone

-- ========== 20260301000004_create_guests.sql ==========
-- Reserve NI: guests table (one record per guest per venue, matched by email/phone)

CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  global_guest_hash text,
  visit_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guests_venue_email_unique UNIQUE (venue_id, email)
);

CREATE INDEX idx_guests_venue_id ON guests (venue_id);
CREATE INDEX idx_guests_venue_phone ON guests (venue_id, phone);

-- ========== 20260301000005_create_bookings.sql ==========
-- Reserve NI: bookings table

CREATE TABLE bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guests (id) ON DELETE RESTRICT,
  booking_date date NOT NULL,
  booking_time time NOT NULL,
  party_size int NOT NULL,
  status booking_status NOT NULL DEFAULT 'Pending',
  source booking_source NOT NULL,
  dietary_notes text,
  occasion text,
  special_requests text,
  deposit_amount_pence int,
  deposit_status deposit_status NOT NULL DEFAULT 'Pending',
  stripe_payment_intent_id text,
  cancellation_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_venue_id ON bookings (venue_id);
CREATE INDEX idx_bookings_venue_date ON bookings (venue_id, booking_date);
CREATE INDEX idx_bookings_guest_id ON bookings (guest_id);
CREATE INDEX idx_bookings_status ON bookings (venue_id, status);

-- ========== 20260301000006_create_events.sql ==========
-- Reserve NI: events table (immutable append-only audit log)
-- No UPDATE or DELETE; only INSERT allowed.

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_venue_id ON events (venue_id);
CREATE INDEX idx_events_booking_id ON events (booking_id);
CREATE INDEX idx_events_venue_created ON events (venue_id, created_at);

-- Prevent UPDATE and DELETE on events (append-only)
CREATE OR REPLACE FUNCTION events_deny_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'events table is append-only: % not allowed', TG_OP;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER events_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE PROCEDURE events_deny_update_delete();

-- ========== 20260301000007_rls_policies.sql ==========
-- Reserve NI: Row-Level Security - staff can only read/write data for their venue(s)
-- Staff are identified by email from Supabase Auth JWT (auth.jwt() ->> 'email').

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Helper: venue_ids the current user (staff email) is associated with
-- Returns empty set if not authenticated or not in staff table.

-- venues: staff can view and update their venue(s)
CREATE POLICY "staff_select_own_venue"
  ON venues FOR SELECT
  USING (
    id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "staff_update_own_venue"
  ON venues FOR UPDATE
  USING (
    id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- staff: staff can view their own row(s) (one per venue)
CREATE POLICY "staff_select_own"
  ON staff FOR SELECT
  USING (email = (auth.jwt() ->> 'email'));

-- guests: staff can manage guests for their venue(s)
CREATE POLICY "staff_manage_guests"
  ON guests FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- bookings: staff can manage bookings for their venue(s)
CREATE POLICY "staff_manage_bookings"
  ON bookings FOR ALL
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  )
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- events: staff can view and insert events for their venue(s); no update/delete
CREATE POLICY "staff_select_events"
  ON events FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "staff_insert_events"
  ON events FOR INSERT
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- ========== 20260301000008_booking_events_trigger.sql ==========
-- Reserve NI: on booking insert or status change, append an event row

CREATE OR REPLACE FUNCTION log_booking_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  evt_type text;
  evt_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    evt_type := 'booking_created';
    evt_payload := jsonb_build_object(
      'booking_id', NEW.id,
      'guest_id', NEW.guest_id,
      'booking_date', NEW.booking_date,
      'booking_time', NEW.booking_time,
      'party_size', NEW.party_size,
      'status', NEW.status,
      'source', NEW.source
    );
    INSERT INTO events (venue_id, booking_id, event_type, payload)
    VALUES (NEW.venue_id, NEW.id, evt_type, evt_payload);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    evt_type := 'booking_status_changed';
    evt_payload := jsonb_build_object(
      'booking_id', NEW.id,
      'old_status', OLD.status,
      'new_status', NEW.status
    );
    INSERT INTO events (venue_id, booking_id, event_type, payload)
    VALUES (NEW.venue_id, NEW.id, evt_type, evt_payload);
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER booking_events_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE PROCEDURE log_booking_event();

-- ========== 20260302000001_venue_cover_storage.sql ==========
-- Reserve NI: Storage bucket for venue cover photos
-- Uploads are done server-side via API (admin client). Public read for display.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'venue-covers',
  'venue-covers',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "venue_cover_public_read" ON storage.objects;

CREATE POLICY "venue_cover_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'venue-covers');

-- ========== 20260302000002_staff_policies.sql ==========
-- Reserve NI: Staff table - allow staff to see all staff for their venue(s); allow admins to insert.

-- Drop the restrictive select so we can allow venue-scoped select
DROP POLICY IF EXISTS "staff_select_own" ON staff;

-- Staff can see all staff rows for venues they belong to
CREATE POLICY "staff_select_venue_staff"
  ON staff FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- Only admins can add new staff to their venue
CREATE POLICY "staff_admin_insert"
  ON staff FOR INSERT
  WITH CHECK (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
      AND role = 'admin'
    )
  );

-- ========== 20260302000003_venue_stripe_and_webhook_events.sql ==========
-- Reserve NI: Venue Stripe Connect + webhook idempotency

-- Venues: store connected Stripe account for direct charges
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS stripe_connected_account_id text;

CREATE INDEX IF NOT EXISTS idx_venues_stripe_account ON venues (stripe_connected_account_id) WHERE stripe_connected_account_id IS NOT NULL;

-- Webhook events: idempotency for Stripe webhooks (process each event once)
CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_id ON webhook_events (stripe_event_id);

-- ========== 20260324100000_webhook_events_enable_rls.sql ==========
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- ========== 20260303000001_booking_reminder_and_confirm_token.sql ==========
-- Reserve NI: 24h reminder tracking and confirm-or-cancel token

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirm_token_hash text,
  ADD COLUMN IF NOT EXISTS confirm_token_used_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_sent ON bookings (reminder_sent_at) WHERE reminder_sent_at IS NULL;

-- ========== 20260304000001_reconciliation_and_reporting.sql ==========
-- Reserve NI: reconciliation_alerts table + reporting functions (events as source of truth)

-- Table for daily Stripe reconciliation discrepancies
CREATE TABLE reconciliation_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings (id) ON DELETE CASCADE,
  expected_status text NOT NULL,
  actual_stripe_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reconciliation_alerts_created ON reconciliation_alerts (created_at);

-- RLS: staff can read alerts for their venue
ALTER TABLE reconciliation_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY reconciliation_alerts_select ON reconciliation_alerts
  FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE venue_id IN (
        SELECT venue_id FROM staff WHERE email = (auth.jwt() ->> 'email')
      )
    )
  );

-- Insert only via service role (cron); no INSERT policy so authenticated users cannot insert.

-- Helper: latest status per booking from events (for venue + date range of event created_at)
CREATE OR REPLACE FUNCTION report_booking_final_statuses(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS TABLE (
  booking_id uuid,
  source text,
  party_size int,
  booking_date date,
  booking_time time,
  final_status text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH created_in_range AS (
    SELECT e.booking_id, e.created_at,
           (e.payload->>'source')::text AS source,
           (e.payload->>'party_size')::int AS party_size,
           (e.payload->>'booking_date')::date AS booking_date,
           (e.payload->>'booking_time')::text AS booking_time,
           (e.payload->>'status')::text AS initial_status
    FROM events e
    WHERE e.venue_id = p_venue_id
      AND e.event_type = 'booking_created'
      AND e.created_at >= p_start AND e.created_at < p_end
  ),
  status_events AS (
    SELECT e.booking_id, e.created_at,
           CASE WHEN e.event_type = 'booking_status_changed' THEN e.payload->>'new_status'
                ELSE e.payload->>'status' END AS status
    FROM events e
    JOIN created_in_range c ON c.booking_id = e.booking_id
    WHERE e.event_type IN ('booking_created', 'booking_status_changed')
  ),
  last_status AS (
    SELECT DISTINCT ON (booking_id) booking_id, status AS final_status
    FROM status_events
    ORDER BY booking_id, created_at DESC
  )
  SELECT c.booking_id, c.source, c.party_size, c.booking_date,
         (c.booking_time::time) AS booking_time,
         COALESCE(l.final_status, c.initial_status) AS final_status,
         c.created_at
  FROM created_in_range c
  LEFT JOIN last_status l ON l.booking_id = c.booking_id;
$$;

-- Report 1: Booking summary (from events)
CREATE OR REPLACE FUNCTION report_booking_summary(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
  total_created int := 0;
  by_source jsonb := '{}';
  by_status jsonb := '{}';
  covers_booked bigint := 0;
  covers_seated bigint := 0;
BEGIN
  WITH final AS (
    SELECT * FROM report_booking_final_statuses(p_venue_id, p_start, p_end)
  )
  SELECT
    COUNT(*)::int AS total_created,
    SUM(party_size)::bigint AS covers_booked,
    SUM(CASE WHEN final_status IN ('Seated', 'Completed') THEN party_size ELSE 0 END)::bigint AS seated
  INTO total_created, covers_booked, covers_seated
  FROM final;

  SELECT jsonb_object_agg(source, cnt) INTO by_source
  FROM (
    SELECT (payload->>'source')::text AS source, COUNT(*)::int AS cnt
    FROM events
    WHERE venue_id = p_venue_id AND event_type = 'booking_created'
      AND created_at >= p_start AND created_at < p_end
    GROUP BY payload->>'source'
  ) t;

  SELECT jsonb_object_agg(final_status, cnt) INTO by_status
  FROM (
    SELECT final_status, COUNT(*)::int AS cnt
    FROM report_booking_final_statuses(p_venue_id, p_start, p_end)
    GROUP BY final_status
  ) t;

  RETURN jsonb_build_object(
    'total_bookings_created', COALESCE(total_created, 0),
    'by_source', COALESCE(by_source, '{}'),
    'by_status', COALESCE(by_status, '{}'),
    'covers_booked', COALESCE(covers_booked, 0),
    'covers_seated', COALESCE(covers_seated, 0)
  );
END;
$$;

-- Report 2: No-show rate (bookings that reached reservation time in Confirmed, then No-Show; exclude walk-ins)
CREATE OR REPLACE FUNCTION report_no_show_series(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_granularity text DEFAULT 'day'
)
RETURNS TABLE (period_start date, no_show_count bigint, confirmed_at_time_count bigint, rate_pct numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH final AS (
    SELECT * FROM report_booking_final_statuses(p_venue_id, p_start, p_end)
    WHERE source != 'walk-in'
  ),
  by_period AS (
    SELECT
      CASE WHEN p_granularity = 'week' THEN date_trunc('week', created_at)::date ELSE created_at::date END AS period_start,
      COUNT(*) FILTER (WHERE final_status = 'No-Show') AS no_show_count,
      COUNT(*) FILTER (WHERE final_status IN ('No-Show', 'Seated', 'Completed')) AS confirmed_at_time_count
    FROM final
    GROUP BY 1
  )
  SELECT period_start,
         no_show_count,
         confirmed_at_time_count,
         CASE WHEN confirmed_at_time_count > 0
              THEN round(100.0 * no_show_count / NULLIF(confirmed_at_time_count, 0), 2)
              ELSE 0 END AS rate_pct
  FROM by_period
  ORDER BY period_start;
$$;

-- Report 3: Cancellation (guest-initiated = Confirmed -> Cancelled; auto = Pending -> Cancelled)
CREATE OR REPLACE FUNCTION report_cancellation(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH created AS (
    SELECT COUNT(*)::int AS total
    FROM events
    WHERE venue_id = p_venue_id AND event_type = 'booking_created'
      AND created_at >= p_start AND created_at < p_end
  ),
  guest_cancel AS (
    SELECT COUNT(DISTINCT booking_id)::int AS cnt
    FROM events
    WHERE venue_id = p_venue_id AND event_type = 'booking_status_changed'
      AND payload->>'new_status' = 'Cancelled'
      AND payload->>'old_status' = 'Confirmed'
      AND created_at >= p_start AND created_at < p_end
  ),
  auto_cancel AS (
    SELECT COUNT(DISTINCT booking_id)::int AS cnt
    FROM events
    WHERE venue_id = p_venue_id AND event_type = 'booking_status_changed'
      AND payload->>'new_status' = 'Cancelled'
      AND payload->>'old_status' = 'Pending'
      AND created_at >= p_start AND created_at < p_end
  )
  SELECT jsonb_build_object(
    'total_bookings_created', (SELECT total FROM created),
    'cancelled_guest_initiated', (SELECT cnt FROM guest_cancel),
    'cancelled_auto', (SELECT cnt FROM auto_cancel),
    'cancellation_rate_pct', CASE WHEN (SELECT total FROM created) > 0
      THEN round(100.0 * ((SELECT cnt FROM guest_cancel) + (SELECT cnt FROM auto_cancel)) / (SELECT total FROM created), 2)
      ELSE 0 END
  );
$$;

-- Report 4: Deposit summary (from bookings - deposit state not in events)
-- We use bookings table filtered by created_at in range for consistency with "period"
CREATE OR REPLACE FUNCTION report_deposit_summary(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_collected_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status IN ('Paid', 'Forfeited')), 0),
    'total_refunded_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status = 'Refunded'), 0),
    'total_forfeited_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status = 'Forfeited'), 0)
  )
  FROM bookings
  WHERE venue_id = p_venue_id
    AND created_at >= p_start AND created_at < p_end;
$$;

-- ========== 20260325100000_report_frequent_visitors.sql ==========
CREATE OR REPLACE FUNCTION report_frequent_visitors(
  p_venue_id uuid,
  p_start date,
  p_end date,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  guest_id uuid,
  name text,
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
    g.name,
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
  ORDER BY g.visit_count DESC, g.last_visit_date DESC NULLS LAST, g.name ASC NULLS LAST
  LIMIT p_limit;
$$;

-- ========== 20260305000001_staff_select_own_again.sql ==========
-- Reserve NI: Fix staff RLS so users can see their own staff row(s) again.
-- The policy "staff_select_venue_staff" alone is circular: it allows SELECT where
-- venue_id IN (SELECT venue_id FROM staff WHERE email = JWT). The subquery is
-- RLS-filtered, so no rows are visible until the subquery returns venue_ids,
-- so staff get "No venue linked". Restore the ability to select own row by email.

CREATE POLICY "staff_select_own"
  ON staff FOR SELECT
  USING (email = (auth.jwt() ->> 'email'));

-- ========== 20260306000001_schema_gaps.sql ==========
-- Reserve NI: Fill schema gaps identified in PRD audit.

-- 1. Venue fields
ALTER TABLE venues ADD COLUMN IF NOT EXISTS cuisine_type text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS price_band text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS no_show_grace_minutes int NOT NULL DEFAULT 15;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS kitchen_email text;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS communication_templates jsonb;

-- 2. Guest fields
ALTER TABLE guests ADD COLUMN IF NOT EXISTS no_show_count int NOT NULL DEFAULT 0;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_visit_date date;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS dietary_preferences text;

-- 3. Booking field - snapshot of cancellation policy at booking time
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_policy_snapshot jsonb;

-- 4. Communications log table (every message sent)
CREATE TABLE IF NOT EXISTS communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings (id) ON DELETE SET NULL,
  guest_id uuid REFERENCES guests (id) ON DELETE SET NULL,
  message_type text NOT NULL,
  channel text NOT NULL,
  recipient_email text,
  recipient_phone text,
  status text NOT NULL DEFAULT 'sent',
  template_version text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communications_booking ON communications (booking_id);
CREATE INDEX IF NOT EXISTS idx_communications_venue ON communications (venue_id);
CREATE INDEX IF NOT EXISTS idx_communications_guest ON communications (guest_id);

-- RLS on communications: staff can read comms for their venue
ALTER TABLE communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_communications"
  ON communications FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- 5. Update booking_source enum to distinguish widget vs booking_page
ALTER TYPE booking_source ADD VALUE IF NOT EXISTS 'widget';
ALTER TYPE booking_source ADD VALUE IF NOT EXISTS 'booking_page';
