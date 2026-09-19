'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import {
  NEW_BOOKING_CHANNELS,
  NEW_BOOKING_CHANNEL_LABELS,
  type NewBookingsSummary,
} from '@/lib/reports/new-bookings';

type Span = 'today' | 'this_week' | 'this_month';

const SPAN_TABS: ReadonlyArray<{ id: Span; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
];

const SPAN_WORDS: Record<Span, string> = {
  today: 'today',
  this_week: 'this week',
  this_month: 'this month',
};

export const NEW_BOOKINGS_REPORT_HREF = '/dashboard/settings?tab=reports&reportsTab=new-bookings';

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Dashboard home: how many bookings were MADE today, this week and this month,
 * whatever date each is for. The tiles above count the diary instead.
 */
export function NewBookingsCard({
  summary,
  showReportLink,
}: {
  /** `undefined` when the server predates the figure; `null` when it could not be loaded. */
  summary: NewBookingsSummary | null | undefined;
  /** Reports are admin only, so only admins get the link through to them. */
  showReportLink: boolean;
}) {
  const [span, setSpan] = useState<Span>('today');
  if (summary === undefined) return null;

  const counts = summary ? summary[span] : null;
  const when = SPAN_WORDS[span];
  const channels = counts ? NEW_BOOKING_CHANNELS.filter((c) => counts.by_channel[c] > 0) : [];

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Bookings made"
        title="New bookings"
        description="Counted on the day each booking was made, whatever date it is for."
        rightClassName="sm:shrink-0"
        right={
          <TabBar
            tabs={SPAN_TABS}
            value={span}
            onChange={setSpan}
            density="compact"
          />
        }
      />
      <SectionCard.Body className="space-y-4">
        {!counts ? (
          <p className="text-sm text-slate-500">
            We could not count your new bookings just now. Refresh the page to try again.
          </p>
        ) : (
          <>
            <p className="text-lg text-slate-800 sm:text-xl" aria-live="polite">
              {counts.total === 0 ? (
                <>No new bookings {span === 'today' ? 'yet today' : `${when} yet`}.</>
              ) : (
                <>
                  You have had{' '}
                  <strong className="font-bold tabular-nums text-brand-700">
                    {counts.total} new {plural(counts.total, 'booking', 'bookings')}
                  </strong>{' '}
                  {when}.
                </>
              )}
            </p>
            {channels.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="How they were booked">
                {channels.map((channel) => (
                  <li
                    key={channel}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-1.5 text-sm text-slate-800"
                  >
                    <span className="font-medium">{NEW_BOOKING_CHANNEL_LABELS[channel]}</span>
                    <span className="tabular-nums text-slate-600">{counts.by_channel[channel]}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {counts.cancelled > 0 || counts.awaiting_payment > 0 ? (
              <p className="text-sm text-slate-500">
                {counts.cancelled > 0
                  ? `${counts.cancelled} of these ${plural(counts.cancelled, 'has', 'have')} since been cancelled. `
                  : ''}
                {counts.awaiting_payment > 0
                  ? `${counts.awaiting_payment} more ${plural(counts.awaiting_payment, 'is', 'are')} waiting for a deposit or card, and will count once paid.`
                  : ''}
              </p>
            ) : null}
          </>
        )}
      </SectionCard.Body>
      {showReportLink ? (
        <SectionCard.Footer className="text-right">
          <Link href={NEW_BOOKINGS_REPORT_HREF} className="text-xs font-semibold text-brand-600 hover:text-brand-800">
            See new bookings by day, week or month in Reports &rarr;
          </Link>
        </SectionCard.Footer>
      ) : null}
    </SectionCard>
  );
}
