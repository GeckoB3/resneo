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
          description="How reliably guests attend, rebook, and use self-service — for appointment bookings only."
        />
        <SectionCard.Body>
          <p className="text-sm text-slate-600">
            There is not enough appointment activity in the selected date range yet. Widen the range above or check
            back once you have more bookings.
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
      ? 'No completed or seated appointments in this period yet, so a no-show rate cannot be calculated.'
      : metrics.no_show.no_show_count === 0
        ? `None of your ${metrics.no_show.eligible_count} attended appointments were marked as no-shows.`
        : `${metrics.no_show.no_show_count} guest${metrics.no_show.no_show_count === 1 ? '' : 's'} did not arrive out of ${metrics.no_show.eligible_count} appointments that were expected to take place.`;

  const modifications = metrics.reschedule.modifications_count;
  const guestMoves = metrics.reschedule.guest_self_reschedule_count;
  const staffMoves = metrics.reschedule.staff_reschedule_count;
  const otherMoves = metrics.reschedule.unknown_actor_reschedule_count;

  const selfServeValue =
    modifications === 0 ? '—' : formatPct(metrics.reschedule.guest_self_reschedule_rate_pct);

  const selfServeDetail =
    modifications === 0
      ? 'No appointment time changes were recorded in this period.'
      : [
          `${guestMoves} change${guestMoves === 1 ? '' : 's'} made by the guest online`,
          `${staffMoves} change${staffMoves === 1 ? '' : 's'} made by your team`,
          otherMoves > 0
            ? `${otherMoves} earlier change${otherMoves === 1 ? '' : 's'} (before guest vs staff was recorded)`
            : null,
        ]
          .filter(Boolean)
          .join(' · ');

  const messagingValue =
    modifications === 0 ? '—' : formatPct(metrics.reschedule.reschedule_via_email_rate_pct);

  const messagingDetail =
    modifications === 0
      ? 'No schedule changes to measure.'
      : metrics.reschedule.modification_notifications_count === 0
        ? 'When appointments were moved, guests were not sent an automatic update message for those changes.'
        : `${metrics.reschedule.modification_notifications_count} of ${modifications} schedule change${modifications === 1 ? '' : 's'} had an email or text update sent to the guest — often when staff moved the booking.`;

  const rebookValue =
    metrics.cancellation_rebook.cancellations_with_guest === 0
      ? '—'
      : formatPct(metrics.cancellation_rebook.rebook_rate_7d_pct);

  const rebookDetail =
    metrics.cancellation_rebook.cancellations_with_guest === 0
      ? 'No cancelled appointments with a guest on file in this period.'
      : metrics.cancellation_rebook.rebooked_within_7d === 0
        ? `None of ${metrics.cancellation_rebook.cancellations_with_guest} cancelled appointment${metrics.cancellation_rebook.cancellations_with_guest === 1 ? '' : 's'} were followed by another booking within a week.`
        : `${metrics.cancellation_rebook.rebooked_within_7d} of ${metrics.cancellation_rebook.cancellations_with_guest} cancelled appointment${metrics.cancellation_rebook.cancellations_with_guest === 1 ? '' : 's'} were followed by another booking within 7 days.`;

  const gapValue =
    metrics.cancellation_rebook.median_rebook_gap_hours == null
      ? '—'
      : formatHours(metrics.cancellation_rebook.median_rebook_gap_hours);

  const gapDetail =
    metrics.cancellation_rebook.rebooked_within_7d === 0
      ? 'When guests rebook after cancelling, the typical wait will appear here.'
      : `Typical wait before the same guest books again. Most rebook within ${formatHours(metrics.cancellation_rebook.p75_rebook_gap_hours)} (75% of cases).`;

  const staffSamples = metrics.staff_time_to_book.sample_count;
  const staffValue =
    staffSamples === 0 ? '—' : formatDurationFriendly(metrics.staff_time_to_book.median_duration_ms);

  const returningMedian = metrics.staff_time_to_book.returning_guest.median_duration_ms;
  const returningCount = metrics.staff_time_to_book.returning_guest.sample_count;

  const staffDetail =
    staffSamples === 0
      ? 'Timing is recorded when staff create bookings in the dashboard. More samples will appear as your team uses the booking flow.'
      : returningCount > 0
        ? `Based on ${staffSamples} booking${staffSamples === 1 ? '' : 's'} created by staff. For guests who have visited before, the typical time was ${formatDurationFriendly(returningMedian)} (${returningCount} booking${returningCount === 1 ? '' : 's'}).`
        : `Based on ${staffSamples} booking${staffSamples === 1 ? '' : 's'} created by staff in this period.`;

  return (
    <SectionCard elevated>
      <SectionCard.Header
        title="Appointment performance"
        description={`How guests attend, change, and rebook — ${periodLabel}. Appointments only (not table dining, classes, or events).`}
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

        <MetricGroup heading="Attendance" intro="Guests who were expected but did not arrive.">
          <InsightMetricCard
            title="No-shows"
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
          heading="Changing appointment times"
          intro="When a booking was moved to a different time — by the guest online or by your team."
        >
          <InsightMetricCard
            title="Moved by the guest online"
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
            title="Guest notified after a change"
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

        <MetricGroup heading="After a cancellation" intro="Whether guests come back and how quickly.">
          <InsightMetricCard
            title="Rebooked within a week"
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
            title="Time until they rebook"
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

        <MetricGroup heading="Team efficiency" intro="How long staff take to add a booking at reception.">
          <InsightMetricCard
            title="Typical time to create a booking"
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
          These figures update when you change the report dates. A saved reference snapshot (updated weekly) helps you
          spot trends over time — enable guest self-reschedule and online deposits in Settings to improve attendance
          and reduce phone calls.
        </p>
      </SectionCard.Body>
    </SectionCard>
  );
}
