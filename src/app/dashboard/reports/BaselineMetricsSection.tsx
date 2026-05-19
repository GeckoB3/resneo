'use client';

import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import type { VenueBaselineMetrics } from '@/lib/metrics/baseline-metrics-types';

function formatHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 24) return `${h}h`;
  const days = Math.round((h / 24) * 10) / 10;
  return `${days}d`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

interface BaselineMetricsSectionProps {
  metrics: VenueBaselineMetrics | null | undefined;
  snapshot?: {
    period_start: string;
    period_end: string;
    created_at: string;
    metrics: VenueBaselineMetrics;
  } | null;
}

export function BaselineMetricsSection({ metrics, snapshot }: BaselineMetricsSectionProps) {
  if (!metrics) {
    return (
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Phase 1"
          title="Baseline metrics"
          description="Appointment scheduling only — used to measure Phase 1a improvements."
        />
        <SectionCard.Body>
          <p className="text-sm text-slate-500">Baseline metrics are not available for this period yet.</p>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  const snap = snapshot?.metrics;

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Phase 1"
        title="Baseline metrics"
        description={`Appointment scheduling · ${metrics.period.from} to ${metrics.period.to}. Targets in the appointments plan (§10.2) compare against these figures.`}
      />
      <SectionCard.Body className="space-y-6">
        {snapshot ? (
          <p className="text-xs text-slate-500">
            Last stored 90-day snapshot: {snapshot.period_start} → {snapshot.period_end} (saved{' '}
            {new Date(snapshot.created_at).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            ). Current range below updates when you change dates.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatTile
            label="No-show rate"
            value={`${metrics.no_show.rate_pct}%`}
            color="amber"
            subValue={`${metrics.no_show.no_show_count} of ${metrics.no_show.eligible_count} eligible`}
            subValue2={snap ? `Stored baseline: ${snap.no_show.rate_pct}%` : undefined}
          />
          <StatTile
            label="Reschedule via email"
            value={`${metrics.reschedule.reschedule_via_email_rate_pct}%`}
            color="brand"
            subValue={`${metrics.reschedule.modification_notifications_count} of ${metrics.reschedule.modifications_count} changes`}
            subValue2={
              snap ? `Stored baseline: ${snap.reschedule.reschedule_via_email_rate_pct}%` : undefined
            }
          />
          <StatTile
            label="Guest self-reschedule"
            value={`${metrics.reschedule.guest_self_reschedule_rate_pct}%`}
            color="emerald"
            subValue={`${metrics.reschedule.guest_self_reschedule_count} guest · ${metrics.reschedule.staff_reschedule_count} staff`}
            subValue2={
              snap
                ? `Stored: ${snap.reschedule.guest_self_reschedule_rate_pct}%`
                : `${metrics.reschedule.unknown_actor_reschedule_count} legacy (no actor tag)`
            }
          />
          <StatTile
            label="Rebook within 7 days"
            value={`${metrics.cancellation_rebook.rebook_rate_7d_pct}%`}
            color="violet"
            subValue={`${metrics.cancellation_rebook.rebooked_within_7d} of ${metrics.cancellation_rebook.cancellations_with_guest} cancels`}
            subValue2={snap ? `Stored baseline: ${snap.cancellation_rebook.rebook_rate_7d_pct}%` : undefined}
          />
          <StatTile
            label="Median cancel → rebook"
            value={formatHours(metrics.cancellation_rebook.median_rebook_gap_hours)}
            color="slate"
            subValue={`P75 ${formatHours(metrics.cancellation_rebook.p75_rebook_gap_hours)}`}
            subValue2={
              snap
                ? `Stored: ${formatHours(snap.cancellation_rebook.median_rebook_gap_hours)}`
                : undefined
            }
          />
          <StatTile
            label="Staff time-to-book"
            value={formatMs(metrics.staff_time_to_book.median_duration_ms)}
            color="blue"
            subValue={`${metrics.staff_time_to_book.sample_count} samples`}
            subValue2={
              snap
                ? `Returning ${formatMs(metrics.staff_time_to_book.returning_guest.median_duration_ms)} · stored ${formatMs(snap.staff_time_to_book.median_duration_ms)}`
                : `Returning ${formatMs(metrics.staff_time_to_book.returning_guest.median_duration_ms)} (${metrics.staff_time_to_book.returning_guest.sample_count})`
            }
          />
        </div>

        <p className="text-xs text-slate-500">
          Phase 1a targets: guest self-reschedule ≥15%, no-show ↓ vs baseline, staff book median &lt;45s for returning
          clients. Schedule changes before actor tagging count as legacy in the guest vs staff split.
        </p>
      </SectionCard.Body>
    </SectionCard>
  );
}
