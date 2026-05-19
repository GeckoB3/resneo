-- P0.6: Phase 1a baseline metric snapshots (rolling windows for before/after comparison)

CREATE TABLE IF NOT EXISTS public.venue_baseline_metrics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  snapshot_kind text NOT NULL DEFAULT 'rolling_90d',
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_baseline_metrics_snapshots_kind_check
    CHECK (snapshot_kind IN ('rolling_90d', 'weekly', 'manual')),
  CONSTRAINT venue_baseline_metrics_snapshots_period_check
    CHECK (period_end >= period_start),
  UNIQUE (venue_id, period_start, period_end, snapshot_kind)
);

CREATE INDEX IF NOT EXISTS idx_venue_baseline_metrics_snapshots_venue_created
  ON public.venue_baseline_metrics_snapshots (venue_id, created_at DESC);

ALTER TABLE public.venue_baseline_metrics_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff_select_venue_baseline_metrics_snapshots" ON public.venue_baseline_metrics_snapshots;
CREATE POLICY "staff_select_venue_baseline_metrics_snapshots"
  ON public.venue_baseline_metrics_snapshots FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

COMMENT ON TABLE public.venue_baseline_metrics_snapshots IS
  'Periodic baseline metrics per venue (P0.6) for Phase 1a success measurement. Writes via service role only.';
