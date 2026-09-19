'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  NEW_BOOKING_CHANNELS,
  NEW_BOOKING_CHANNEL_LABELS,
  type NewBookingChannel,
  type NewBookingCounts,
  type NewBookingsPreset,
  type NewBookingsReport,
} from '@/lib/reports/new-bookings';
import type { ReportGrain } from '@/lib/reports/report-periods';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardChartSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { chipClass, downloadCsv, periodLabel, shortChartLabel } from './report-format';

type RechartsModule = typeof import('recharts');

const PRESETS: Array<{ id: NewBookingsPreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
];

const GRAINS: Array<{ id: ReportGrain; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/** One colour per channel, on the brand navy and teal like the Revenue chart. */
const CHANNEL_COLOURS: Record<NewBookingChannel, string> = {
  online: '#00B4BA',
  team: '#003B6F',
  walk_in: '#E9B44C',
  linked_venue: '#9B7BB8',
};

type RangeChoice = { kind: 'preset'; preset: NewBookingsPreset } | { kind: 'custom'; from: string; to: string };

async function fetchReport(url: string): Promise<NewBookingsReport> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not load new bookings');
  }
  return res.json() as Promise<NewBookingsReport>;
}

function share(part: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((part / total) * 100)}% of new bookings`;
}

export function NewBookingsSection({
  recharts,
  onExportNotice,
}: {
  recharts: RechartsModule | null;
  onExportNotice: (variant: 'success' | 'notice', message: string) => void;
}) {
  const [choice, setChoice] = useState<RangeChoice>({ kind: 'preset', preset: 'this_week' });
  const [customDraft, setCustomDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [customOpen, setCustomOpen] = useState(false);
  const [grain, setGrain] = useState<ReportGrain>('day');

  const url = useMemo(() => {
    const p = new URLSearchParams({ grain });
    if (choice.kind === 'preset') p.set('preset', choice.preset);
    else {
      p.set('from', choice.from);
      p.set('to', choice.to);
    }
    return `/api/venue/reports/new-bookings?${p.toString()}`;
  }, [choice, grain]);

  const { data, error, isLoading, isValidating } = useSWR(url, fetchReport, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  });

  // The three main channels always get a column; a linked venue only once it has booked.
  const channels = useMemo<NewBookingChannel[]>(
    () => NEW_BOOKING_CHANNELS.filter((c) => c !== 'linked_venue' || (data?.totals.by_channel.linked_venue ?? 0) > 0),
    [data],
  );
  const chartChannels = useMemo(
    () => channels.filter((c) => (data?.totals.by_channel[c] ?? 0) > 0),
    [channels, data],
  );

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.periods.map((p) => {
      const point: Record<string, string | number> = {
        label: shortChartLabel(p.period_start, data.grain),
        full: periodLabel(p.period_start, p.period_end, data.grain),
      };
      for (const c of NEW_BOOKING_CHANNELS) point[c] = p.by_channel[c];
      return point;
    });
  }, [data]);

  const totals: NewBookingCounts | null = data?.totals ?? null;
  const rangeLabel = data ? periodLabel(data.from, data.to, 'week') : '';

  const applyCustom = () => {
    if (!customDraft.from || !customDraft.to) return;
    if (customDraft.to < customDraft.from) {
      onExportNotice('notice', 'The end date must not be before the start date.');
      return;
    }
    setChoice({ kind: 'custom', from: customDraft.from, to: customDraft.to });
  };

  const exportCsv = () => {
    if (!data || data.periods.length === 0) {
      onExportNotice('notice', 'There are no new bookings to export for this range.');
      return;
    }
    const header = [
      'Period',
      ...NEW_BOOKING_CHANNELS.map((c) => NEW_BOOKING_CHANNEL_LABELS[c]),
      'New bookings',
      'Since cancelled',
      'Waiting for payment',
    ];
    const line = (label: string, c: NewBookingCounts) => [
      label,
      ...NEW_BOOKING_CHANNELS.map((ch) => String(c.by_channel[ch])),
      String(c.total),
      String(c.cancelled),
      String(c.awaiting_payment),
    ];
    const rows = data.periods.map((p) => line(periodLabel(p.period_start, p.period_end, data.grain), p));
    rows.push(line('Total', data.totals));
    downloadCsv(`new-bookings-${data.from}-${data.to}-${data.grain}.csv`, [header, ...rows]);
    onExportNotice('success', 'New bookings CSV download started - check your downloads folder.');
  };

  const tileGridClass = channels.length > 3 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-4';

  return (
    <>
      <SectionCard elevated>
        <SectionCard.Header eyebrow="New bookings" title="Bookings made" />
        <SectionCard.Body className="space-y-4">
          <p className="text-sm text-slate-500">
            How many bookings were made in the dates you pick. Each one counts on the day it was made, whatever date it
            is for, so a booking made today for next month counts today. A visit with several services counts once.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Range</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={chipClass(choice.kind === 'preset' && choice.preset === preset.id)}
                onClick={() => {
                  setCustomOpen(false);
                  setChoice({ kind: 'preset', preset: preset.id });
                }}
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              className={chipClass(choice.kind === 'custom' || customOpen)}
              onClick={() => {
                setCustomOpen(true);
                if (data && !customDraft.from) setCustomDraft({ from: data.from, to: data.to });
              }}
            >
              Custom range
            </button>
          </div>
          {customOpen || choice.kind === 'custom' ? (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">From</span>
                <input
                  type="date"
                  value={customDraft.from}
                  max={data?.today}
                  onChange={(e) => setCustomDraft((r) => ({ ...r, from: e.target.value }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={customDraft.to}
                  max={data?.today}
                  onChange={(e) => setCustomDraft((r) => ({ ...r, to: e.target.value }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
                />
              </label>
              <button
                type="button"
                onClick={applyCustom}
                disabled={!customDraft.from || !customDraft.to || isValidating}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {isValidating ? 'Loading...' : 'Apply'}
              </button>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Show by</span>
            {GRAINS.map((g) => (
              <button key={g.id} type="button" className={chipClass(grain === g.id)} onClick={() => setGrain(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Report"
          title={data ? `New bookings, ${rangeLabel}` : 'New bookings'}
          right={
            <button
              type="button"
              onClick={exportCsv}
              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              Export CSV
            </button>
          }
        />
        <SectionCard.Body>
          {error ? (
            <p className="mb-4 text-sm text-red-600">
              {error instanceof Error ? error.message : 'Could not load new bookings'}
            </p>
          ) : null}
          {!data && isLoading ? (
            <div className="h-64">
              <DashboardChartSkeleton kpiCount={4} />
            </div>
          ) : null}
          {data && totals ? (
            <div className={isValidating ? 'opacity-70 transition-opacity' : 'transition-opacity'} aria-busy={isValidating}>
              <div className={`mb-5 grid grid-cols-2 gap-3 ${tileGridClass}`}>
                <StatTile
                  label="New bookings"
                  value={String(totals.total)}
                  color="brand"
                  subValue={totals.cancelled > 0 ? `${totals.cancelled} since cancelled` : undefined}
                />
                {channels.map((c) => (
                  <StatTile
                    key={c}
                    label={NEW_BOOKING_CHANNEL_LABELS[c]}
                    value={String(totals.by_channel[c])}
                    color="slate"
                    subValue={share(totals.by_channel[c], totals.total)}
                  />
                ))}
              </div>
              {totals.awaiting_payment > 0 ? (
                <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {totals.awaiting_payment} more {totals.awaiting_payment === 1 ? 'booking was' : 'bookings were'} made in
                  these dates and {totals.awaiting_payment === 1 ? 'is' : 'are'} still waiting for a deposit or card.{' '}
                  {totals.awaiting_payment === 1 ? 'It counts' : 'They count'} once paid.
                </p>
              ) : null}

              <div className="mb-6 h-72">
                {!recharts ? (
                  <DashboardChartSkeleton kpiCount={0} />
                ) : totals.total === 0 ? (
                  <p className="text-sm text-slate-400">No new bookings in this range.</p>
                ) : (
                  <recharts.ResponsiveContainer width="100%" height="100%">
                    <recharts.BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <recharts.CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <recharts.XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <recharts.YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={40} />
                      <recharts.Tooltip
                        labelFormatter={(_label, payload) =>
                          (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? String(_label)
                        }
                      />
                      {chartChannels.length > 1 ? <recharts.Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                      {chartChannels.map((c, index) => (
                        <recharts.Bar
                          key={c}
                          dataKey={c}
                          name={NEW_BOOKING_CHANNEL_LABELS[c]}
                          stackId="new-bookings"
                          fill={CHANNEL_COLOURS[c]}
                          radius={index === chartChannels.length - 1 ? [6, 6, 0, 0] : undefined}
                        />
                      ))}
                    </recharts.BarChart>
                  </recharts.ResponsiveContainer>
                )}
              </div>

              {data.periods.length > 0 ? (
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
                  <table className="min-w-full text-sm">
                    <caption className="sr-only">New bookings by period and by how they were booked</caption>
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Period</th>
                        {channels.map((c) => (
                          <th key={c} className="whitespace-nowrap px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: CHANNEL_COLOURS[c] }}
                                aria-hidden
                              />
                              {NEW_BOOKING_CHANNEL_LABELS[c]}
                            </span>
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-3 py-2 text-right">New bookings</th>
                        <th className="whitespace-nowrap px-3 py-2 text-right text-amber-700">Since cancelled</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.periods.map((p) => {
                        const isToday = p.period_start <= data.today && data.today <= p.period_end;
                        return (
                          <tr key={p.period_start} className={isToday ? 'bg-brand-50/40' : undefined}>
                            <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2 font-medium text-slate-800">
                              <span className="flex items-center gap-2">
                                {periodLabel(p.period_start, p.period_end, data.grain)}
                                {isToday && data.grain === 'day' ? (
                                  <Pill variant="info" size="sm">
                                    Today
                                  </Pill>
                                ) : null}
                              </span>
                            </td>
                            {channels.map((c) => (
                              <td
                                key={c}
                                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${p.by_channel[c] === 0 ? 'text-slate-300' : 'text-slate-700'}`}
                              >
                                {p.by_channel[c]}
                              </td>
                            ))}
                            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                              {p.total}
                            </td>
                            <td
                              className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${p.cancelled === 0 ? 'text-slate-300' : 'text-amber-700'}`}
                            >
                              {p.cancelled}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                      <tr>
                        <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Total</td>
                        {channels.map((c) => (
                          <td key={c} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {totals.by_channel[c]}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{totals.total}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">
                          {totals.cancelled}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}
              <p className="mt-4 text-xs text-slate-500">
                Online means your client booked themselves, on your booking page or your website. By your team means
                someone on your team added it, by phone, in person or from a message. Imported bookings, bookings moved
                here from another venue in your collective, and bookings cancelled automatically because a deposit or
                card never came through are not counted.
              </p>
            </div>
          ) : null}
        </SectionCard.Body>
      </SectionCard>
    </>
  );
}
