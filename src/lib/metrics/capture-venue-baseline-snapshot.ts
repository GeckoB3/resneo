import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeVenueBaselineMetrics,
  type ComputeVenueBaselineMetricsOptions,
} from '@/lib/metrics/compute-venue-baseline-metrics';
import type { BaselineSnapshotKind, VenueBaselineMetrics } from '@/lib/metrics/baseline-metrics-types';

export interface CaptureBaselineSnapshotResult {
  venue_id: string;
  period_start: string;
  period_end: string;
  snapshot_kind: BaselineSnapshotKind;
  metrics: VenueBaselineMetrics;
  created: boolean;
}

/**
 * Upserts a baseline metrics snapshot for the venue and period.
 */
export async function captureVenueBaselineSnapshot(
  admin: SupabaseClient,
  params: {
    venue_id: string;
    period_start: string;
    period_end: string;
    snapshot_kind?: BaselineSnapshotKind;
    computeOptions?: ComputeVenueBaselineMetricsOptions;
  },
): Promise<CaptureBaselineSnapshotResult> {
  const snapshot_kind = params.snapshot_kind ?? 'rolling_90d';
  const metrics = await computeVenueBaselineMetrics(
    admin,
    params.venue_id,
    params.period_start,
    params.period_end,
    params.computeOptions,
  );

  const { error } = await admin.from('venue_baseline_metrics_snapshots').upsert(
    {
      venue_id: params.venue_id,
      period_start: params.period_start,
      period_end: params.period_end,
      snapshot_kind,
      metrics,
    },
    { onConflict: 'venue_id,period_start,period_end,snapshot_kind' },
  );

  if (error) {
    console.error('[captureVenueBaselineSnapshot] upsert failed:', error.message, {
      venue_id: params.venue_id,
      period_start: params.period_start,
      period_end: params.period_end,
    });
    throw new Error('Failed to save baseline metrics snapshot');
  }

  return {
    venue_id: params.venue_id,
    period_start: params.period_start,
    period_end: params.period_end,
    snapshot_kind,
    metrics,
    created: true,
  };
}

/** Rolling 90-day window ending today (UTC dates). */
export function rolling90DayPeriod(reference = new Date()): { from: string; to: string } {
  const to = reference.toISOString().slice(0, 10);
  const fromDate = new Date(reference);
  fromDate.setUTCDate(fromDate.getUTCDate() - 89);
  return { from: fromDate.toISOString().slice(0, 10), to };
}
