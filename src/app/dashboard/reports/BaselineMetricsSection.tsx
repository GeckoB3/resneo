'use client';

import type { ReactNode } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import type { VenueBaselineMetrics } from '@/lib/metrics/baseline-metrics-types';

function formatPeriodRange(from: string, to: string): string {
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return `${from} – ${to}`;
  return `${start.toLocaleDateString('en-GB', opts)} – ${end.toLocaleDateString('en-GB', opts)}`;
}

function formatHours(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) {
    const mins = Math.round(h * 60);
    return mins <= 1 ? 'under 1 minute' : `${mins} minutes`;
  }
  if (h < 24) return `${Math.round(h * 10) / 10} hours`;
  const days = Math.round((h / 24) * 10) / 10;
  return `${days} day${days === 1 ? '' : 's'}`;
}

function formatDurationFriendly(ms: number | null): string {
  if (ms == null) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? '' : 's'}`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (rem === 0) return `${min} minute${min === 1 ? '' : 's'}`;
  return `${min} min ${rem} sec`;
}

function formatPct(rate: number): string {
  return `${rate}%`;
}

function snapshotComparison(
  current: string,
  reference: string | undefined,
  prefix: string,
): string | undefined {
  if (!reference || reference === current) return undefined;
  return `${prefix} ${reference} (your saved reference period)`;
}

type MetricTone = 'amber' | 'emerald' | 'brand' | 'violet' | 'blue' | 'slate';

const toneSurface: Record<MetricTone, string> = {
  amber: 'border-amber-200/80 bg-amber-50/50',
  emerald: 'border-emerald-200/80 bg-emerald-50/40',
  brand: 'border-brand-200/80 bg-brand-50/40',
  violet: 'border-violet-200/80 bg-violet-50/40',
  blue: 'border-blue-200/80 bg-blue-50/40',
  slate: 'border-slate-200 bg-slate-50/80',
};

function InsightMetricCard({
  title,
  value,
  detail,
  comparison,
  tone = 'slate',
}: {
  title: string;
  value: string;
  detail: string;
  comparison?: string;
  tone?: MetricTone;
}) {
  return (
    <div className={`rounded-xl border p-4 ${toneSurface[tone]}`}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{detail}</p>
      {comparison ? <p className="mt-2 text-xs text-slate-500">{comparison}</p> : null}
    </div>
  );
}

function MetricGroup({
  heading,
  intro,
  children,
}: {
  heading: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{heading}</h3>
        {intro ? <p className="mt-0.5 text-sm text-slate-600">{intro}</p> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
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
          title="Appointment performance"
          description="Attendance, reschedules, cancellations, and how quickly your team adds bookings — for the date range selected above."
        />
        <SectionCard.Body>
          <p className="text-sm text-slate-600">
            Not enough appointment activity in this date range yet. Widen the range at the top of Reports or check
            back after more bookings are created.
          </p>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  const snap = snapshot?.metrics;
  const periodLabel = formatPeriodRange(metrics.period.from, metrics.period.to);

  const noShowValue =
    metrics.no_show.eligible_count === 0
      ? '—'
      : formatPct(metrics.no_show.rate_pct);

  const noShowDetail =
    metrics.no_show.eligible_count === 0
      ? 'No appointments reached Started or Completed in this period yet, so a no-show rate cannot be calculated.'
      : metrics.no_show.no_show_count === 0
        ? `No no-shows among ${metrics.no_show.eligible_count} appointment${metrics.no_show.eligible_count === 1 ? '' : 's'} that were due to take place (walk-ins are excluded).`
        : `${metrics.no_show.no_show_count} guest${metrics.no_show.no_show_count === 1 ? '' : 's'} did not arrive out of ${metrics.no_show.eligible_count} appointments that were due to take place (walk-ins excluded).`;

  const modifications = metrics.reschedule.modifications_count;
  const guestMoves = metrics.reschedule.guest_self_reschedule_count;
  const staffMoves = metrics.reschedule.staff_reschedule_count;
  const otherMoves = metrics.reschedule.unknown_actor_reschedule_count;

  const selfServeValue =
    modifications === 0 ? '—' : formatPct(metrics.reschedule.guest_self_reschedule_rate_pct);

  const knownMoves = guestMoves + staffMoves;
  const selfServeDetail =
    modifications === 0
      ? 'No appointment date or time changes were recorded in this period.'
      : knownMoves === 0
        ? `${modifications} time change${modifications === 1 ? '' : 's'} in this period; none were recorded as guest or staff (older system data).`
        : [
            `${modifications} time change${modifications === 1 ? '' : 's'} in this period.`,
            `Among ${knownMoves} where we know who moved it: ${guestMoves} by the guest online, ${staffMoves} by your team.`,
            otherMoves > 0
              ? `${otherMoves} older change${otherMoves === 1 ? '' : 's'} not attributed to guest or staff.`
              : null,
          ]
            .filter(Boolean)
            .join(' ');

  const messagingValue =
    modifications === 0 ? '—' : formatPct(metrics.reschedule.reschedule_via_email_rate_pct);

  const messagingDetail =
    modifications === 0
      ? 'No appointment moves to measure.'
      : metrics.reschedule.modification_notifications_count === 0
        ? `None of the ${modifications} move${modifications === 1 ? '' : 's'} triggered an automatic email or text to the guest. Staff moves often send an update when configured in Settings.`
        : `${metrics.reschedule.modification_notifications_count} of ${modifications} move${modifications === 1 ? '' : 's'} had an email or text sent to the guest (usually after your team changed the time).`;

  const rebookValue =
    metrics.cancellation_rebook.cancellations_with_guest === 0
      ? '—'
      : formatPct(metrics.cancellation_rebook.rebook_rate_7d_pct);

  const rebookDetail =
    metrics.cancellation_rebook.cancellations_with_guest === 0
      ? 'No cancelled appointments with a guest profile in this period.'
      : metrics.cancellation_rebook.rebooked_within_7d === 0
        ? `None of ${metrics.cancellation_rebook.cancellations_with_guest} cancellation${metrics.cancellation_rebook.cancellations_with_guest === 1 ? '' : 's'} led to another appointment within 7 days.`
        : `${metrics.cancellation_rebook.rebooked_within_7d} of ${metrics.cancellation_rebook.cancellations_with_guest} cancellation${metrics.cancellation_rebook.cancellations_with_guest === 1 ? '' : 's'} were followed by a new appointment within 7 days.`;

  const gapValue =
    metrics.cancellation_rebook.median_rebook_gap_hours == null
      ? '—'
      : formatHours(metrics.cancellation_rebook.median_rebook_gap_hours);

  const gapDetail =
    metrics.cancellation_rebook.rebooked_within_7d === 0
      ? 'When a guest books again after cancelling, the typical wait will appear here.'
      : `Median time from cancellation to the guest’s next appointment. Three quarters rebook within ${formatHours(metrics.cancellation_rebook.p75_rebook_gap_hours)}.`;

  const staffSamples = metrics.staff_time_to_book.sample_count;
  const staffValue =
    staffSamples === 0 ? '—' : formatDurationFriendly(metrics.staff_time_to_book.median_duration_ms);

  const returningMedian = metrics.staff_time_to_book.returning_guest.median_duration_ms;
  const returningCount = metrics.staff_time_to_book.returning_guest.sample_count;

  const staffDetail =
    staffSamples === 0
      ? 'Recorded when your team creates an appointment in the dashboard (from opening the form to saving). More samples appear as staff use that flow.'
      : returningCount > 0
        ? `Median across ${staffSamples} staff-created appointment${staffSamples === 1 ? '' : 's'}. Returning guests: typical ${formatDurationFriendly(returningMedian)} (${returningCount} booking${returningCount === 1 ? '' : 's'}).`
        : `Median across ${staffSamples} appointment${staffSamples === 1 ? '' : 's'} created by staff in this period.`;

  return (
    <SectionCard elevated>
      <SectionCard.Header
        title="Appointment performance"
        description={`${periodLabel} · appointment bookings only · same dates as the range above`}
      />
      <SectionCard.Body className="space-y-8">
        {snapshot ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
            <span className="font-medium text-slate-800">Reference period saved: </span>
            {formatPeriodRange(snapshot.period_start, snapshot.period_end)}
            <span className="text-slate-500">
              {' '}
              (saved{' '}
              {new Date(snapshot.created_at).toLocaleDateString('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
              ). Figures below follow the date range you selected at the top of Reports.
            </span>
          </div>
        ) : null}

        <MetricGroup
          heading="Attendance"
          intro="Online and staff-booked appointments (not walk-ins) that reached Started, Completed, or were marked no-show."
        >
          <InsightMetricCard
            title="No-show rate"
            value={noShowValue}
            detail={noShowDetail}
            tone="amber"
            comparison={snapshotComparison(
              noShowValue,
              snap?.no_show.eligible_count ? formatPct(snap.no_show.rate_pct) : undefined,
              'Reference no-show rate was',
            )}
          />
        </MetricGroup>

        <MetricGroup
          heading="Reschedules"
          intro="Appointments moved to another date or time. Percentages below use only moves where the system recorded guest vs staff (older moves may be listed separately)."
        >
          <InsightMetricCard
            title="Guest moved online (share of known moves)"
            value={selfServeValue}
            detail={selfServeDetail}
            tone="emerald"
            comparison={snapshotComparison(
              selfServeValue,
              snap && snap.reschedule.modifications_count > 0
                ? formatPct(snap.reschedule.guest_self_reschedule_rate_pct)
                : undefined,
              'Reference share was',
            )}
          />
          <InsightMetricCard
            title="Guest notified after a move"
            value={messagingValue}
            detail={messagingDetail}
            tone="brand"
            comparison={snapshotComparison(
              messagingValue,
              snap && snap.reschedule.modifications_count > 0
                ? formatPct(snap.reschedule.reschedule_via_email_rate_pct)
                : undefined,
              'Reference share was',
            )}
          />
        </MetricGroup>

        <MetricGroup
          heading="After a cancellation"
          intro="Cancelled appointments with a guest on file — whether the same guest booked again within seven days."
        >
          <InsightMetricCard
            title="Rebooked within 7 days"
            value={rebookValue}
            detail={rebookDetail}
            tone="violet"
            comparison={snapshotComparison(
              rebookValue,
              snap && snap.cancellation_rebook.cancellations_with_guest > 0
                ? formatPct(snap.cancellation_rebook.rebook_rate_7d_pct)
                : undefined,
              'Reference rate was',
            )}
          />
          <InsightMetricCard
            title="Typical wait to rebook"
            value={gapValue}
            detail={gapDetail}
            tone="slate"
            comparison={snapshotComparison(
              gapValue,
              snap?.cancellation_rebook.median_rebook_gap_hours != null
                ? formatHours(snap.cancellation_rebook.median_rebook_gap_hours)
                : undefined,
              'Reference typical wait was',
            )}
          />
        </MetricGroup>

        <MetricGroup
          heading="Team efficiency"
          intro="How long it takes staff to create an appointment in the dashboard (form open to save)."
        >
          <InsightMetricCard
            title="Median time to create an appointment"
            value={staffValue}
            detail={staffDetail}
            tone="blue"
            comparison={snapshotComparison(
              staffValue,
              snap && snap.staff_time_to_book.sample_count > 0
                ? formatDurationFriendly(snap.staff_time_to_book.median_duration_ms)
                : undefined,
              'Reference typical time was',
            )}
          />
        </MetricGroup>

        <p className="text-xs leading-relaxed text-slate-500">
          Figures follow the report dates at the top of this page. A saved reference snapshot (updated weekly) lets you
          compare against an earlier period. Guest self-reschedule and deposit rules in Settings can improve attendance
          and cut manual rescheduling.
        </p>
      </SectionCard.Body>
    </SectionCard>
  );
}
