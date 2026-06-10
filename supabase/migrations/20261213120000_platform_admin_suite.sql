-- Platform superuser admin suite:
--   1. platform_invoices            — collected subscription revenue (Stripe webhook ledger)
--   2. platform_audit_events       — append-only log of superuser platform actions
--   3. platform_announcements      — banners pushed to venue dashboards (+ per-user dismissals)
--   4. cron_runs                   — cron job run history for system health monitoring
--   5. platform_venue_health_stats — per-venue activity aggregates for health scoring
-- All tables are service-role only (RLS enabled, no policies).

-- ───────────────────────── 1. Platform invoice ledger ─────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_invoice_id  text NOT NULL UNIQUE,
  venue_id           uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  amount_paid_pence  integer NOT NULL,
  currency           text NOT NULL DEFAULT 'gbp',
  /** First day of the UTC month the invoice was paid in. */
  period_month       date NOT NULL,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invoices_period ON public.platform_invoices (period_month);
CREATE INDEX IF NOT EXISTS idx_platform_invoices_venue ON public.platform_invoices (venue_id);

ALTER TABLE public.platform_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_invoices IS
  'Subscription revenue collected via Stripe (recorded by the subscription webhook on invoice.payment_succeeded). Informational ledger for the platform revenue dashboard.';

-- ───────────────────────── 2. Platform audit events ─────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  superuser_id    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  superuser_email text NOT NULL,
  action          text NOT NULL,
  target_type     text,
  target_id       text,
  summary         text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON public.platform_audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON public.platform_audit_events (action, created_at DESC);

ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;

-- Append-only: block UPDATE / DELETE even for table owners running through triggers.
CREATE OR REPLACE FUNCTION public.platform_audit_events_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_platform_audit_block_update ON public.platform_audit_events;
CREATE TRIGGER trg_platform_audit_block_update
  BEFORE UPDATE OR DELETE ON public.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.platform_audit_events_block_mutation();

COMMENT ON TABLE public.platform_audit_events IS
  'Append-only audit log of superuser platform actions (venue flags, salespeople, announcements, comp grants, superuser management).';

-- ───────────────────────── 3. Announcements ─────────────────────────

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text NOT NULL,
  body             text NOT NULL,
  severity         text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  starts_at        timestamptz NOT NULL DEFAULT now(),
  ends_at          timestamptz,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_active
  ON public.platform_announcements (active, starts_at, ends_at);

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.platform_announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES public.platform_announcements (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

ALTER TABLE public.platform_announcement_dismissals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.platform_announcements IS
  'Dismissible banners shown on venue dashboards (maintenance windows, new features). Managed by platform superusers.';

-- ───────────────────────── 4. Cron run history ─────────────────────────

CREATE TABLE IF NOT EXISTS public.cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name    text NOT NULL,
  started_at  timestamptz NOT NULL,
  finished_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer NOT NULL DEFAULT 0,
  ok          boolean NOT NULL,
  status_code integer,
  detail      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON public.cron_runs (job_name, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_finished ON public.cron_runs (finished_at DESC);

ALTER TABLE public.cron_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.cron_runs IS
  'Run history for scheduled cron jobs (success, duration, response detail) powering the platform system health page.';

-- ───────────────────────── 5. Venue health aggregates ─────────────────────────

CREATE OR REPLACE FUNCTION public.platform_venue_health_stats()
RETURNS TABLE (
  venue_id uuid,
  bookings_last_30 bigint,
  bookings_prev_30 bigint,
  bookings_last_7 bigint,
  last_booking_at timestamptz,
  upcoming_bookings bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.id AS venue_id,
    COUNT(b.id) FILTER (
      WHERE b.created_at >= now() - interval '30 days'
    )::bigint AS bookings_last_30,
    COUNT(b.id) FILTER (
      WHERE b.created_at >= now() - interval '60 days'
        AND b.created_at < now() - interval '30 days'
    )::bigint AS bookings_prev_30,
    COUNT(b.id) FILTER (
      WHERE b.created_at >= now() - interval '7 days'
    )::bigint AS bookings_last_7,
    MAX(b.created_at) AS last_booking_at,
    COUNT(b.id) FILTER (
      WHERE b.booking_date >= CURRENT_DATE
        AND b.status NOT IN ('Cancelled', 'No-Show')
    )::bigint AS upcoming_bookings
  FROM public.venues v
  LEFT JOIN public.bookings b ON b.venue_id = v.id
  GROUP BY v.id;
$$;

REVOKE ALL ON FUNCTION public.platform_venue_health_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_venue_health_stats() TO service_role;

COMMENT ON FUNCTION public.platform_venue_health_stats() IS
  'Per-venue booking activity aggregates (30d, prior 30d, 7d, last booking, upcoming) for the platform health dashboard.';
