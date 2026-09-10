'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import type {
  BookedRevenueCell,
  BookedRevenueGrain,
  BookedRevenuePreset,
  BookedRevenueReport,
} from '@/lib/reports/booked-revenue';
import { formatPence } from '@/lib/booking/payment-display';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { Pill } from '@/components/ui/dashboard/Pill';
import { DashboardChartSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

type RechartsModule = typeof import('recharts');

const PRESETS: Array<{ id: BookedRevenuePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'this_week', label: 'This week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_30', label: 'Last 30 days' },
  { id: 'next_30', label: 'Next 30 days' },
];

const GRAINS: Array<{ id: BookedRevenueGrain; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

/**
 * One bar colour per calendar, by position. Calendars' own colours are not
 * used here: most keep the default blue, so stacked bars in those colours were
 * impossible to tell apart. The set is built around the brand navy and teal,
 * with muted tones of similar weight so neighbouring bars read as one chart
 * while each calendar stays distinct.
 */
const BAR_COLOURS = [
  '#003B6F', // brand navy
  '#00B4BA', // brand teal
  '#5B8DEF', // soft blue
  '#7FB069', // sage
  '#E9B44C', // warm gold
  '#E07A5F', // coral
  '#9B7BB8', // lavender
  '#3D8B8B', // pine
  '#C9A27E', // sand
  '#6C7A89', // slate
];

type RangeChoice = { kind: 'preset'; preset: BookedRevenuePreset } | { kind: 'custom'; from: string; to: string };

async function fetchReport(url: string): Promise<BookedRevenueReport> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Could not load booked revenue');
  }
  return res.json() as Promise<BookedRevenueReport>;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function formatDayLabel(ymd: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(parseYmd(ymd));
  } catch {
    return ymd;
  }
}

/** The row label for a period, sized to the grain. */
function periodLabel(start: string, end: string, grain: BookedRevenueGrain): string {
  if (grain === 'day') return formatDayLabel(start, { weekday: 'short', day: 'numeric', month: 'short' });
  if (grain === 'month' && start.slice(0, 7) === end.slice(0, 7) && start.endsWith('-01')) {
    const monthEnd = parseYmd(start);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    monthEnd.setUTCDate(0);
    if (monthEnd.toISOString().slice(0, 10) === end) {
      return formatDayLabel(start, { month: 'long', year: 'numeric' });
    }
  }
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const from = formatDayLabel(start, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  const to = formatDayLabel(end, { day: 'numeric', month: 'short', year: 'numeric' });
  return start === end ? to : `${from} to ${to}`;
}

function shortChartLabel(start: string, grain: BookedRevenueGrain): string {
  if (grain === 'month') return formatDayLabel(start, { month: 'short', year: '2-digit' });
  return formatDayLabel(start, { day: 'numeric', month: 'short' });
}

function money(pence: number): string {
  return formatPence(pence) ?? `£${(pence / 100).toFixed(2)}`;
}

function netPence(cell: BookedRevenueCell | undefined, includeNoShows: boolean): number {
  if (!cell) return 0;
  return cell.booked_pence + (includeNoShows ? cell.no_show_pence : 0);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const chipClass = (active: boolean) =>
  `rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
    active ? 'bg-brand-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
  }`;

export function BookedRevenueSection({
  recharts,
  bookingWord,
  onExportNotice,
}: {
  recharts: RechartsModule | null;
  /** The venue's word for an appointment (terminology.booking). */
  bookingWord: string;
  onExportNotice: (variant: 'success' | 'notice', message: string) => void;
}) {
  const [choice, setChoice] = useState<RangeChoice>({ kind: 'preset', preset: 'this_week' });
  const [customDraft, setCustomDraft] = useState<{ from: string; to: string }>({ from: '', to: '' });
  const [customOpen, setCustomOpen] = useState(false);
  const [grain, setGrain] = useState<BookedRevenueGrain>('day');
  const [includeNoShows, setIncludeNoShows] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams({ grain });
    if (choice.kind === 'preset') p.set('preset', choice.preset);
    else {
      p.set('from', choice.from);
      p.set('to', choice.to);
    }
    return `/api/venue/reports/booked-revenue?${p.toString()}`;
  }, [choice, grain]);

  const { data, error, isLoading, isValidating } = useSWR(url, fetchReport, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  });

  const columns = data?.columns ?? [];
  const ownColumns = columns.filter((c) => !c.linked);
  const linkedColumns = columns.filter((c) => c.linked);
  const colourFor = useCallback((index: number) => BAR_COLOURS[index % BAR_COLOURS.length]!, []);

  const chartData = useMemo(() => {
    if (!data) return [];
    return data.periods.map((p) => {
      const row: Record<string, string | number> = {
        label: shortChartLabel(p.period_start, data.grain),
        full: periodLabel(p.period_start, p.period_end, data.grain),
        total: netPence(p, includeNoShows) / 100,
      };
      for (const col of data.columns) row[col.key] = netPence(p.by_calendar[col.key], includeNoShows) / 100;
      return row;
    });
  }, [data, includeNoShows]);

  const totalNet = data ? netPence(data.totals, includeNoShows) : 0;
  const totalCount = data ? data.totals.booked_count + (includeNoShows ? data.totals.no_show_count : 0) : 0;
  const unpriced = data ? data.totals.unpriced_count : 0;
  const rangeLabel = data ? periodLabel(data.from, data.to, 'week') : '';
  const hasFuture = data ? data.to > data.today : false;
  const hasPast = data ? data.from < data.today : false;

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
      onExportNotice('notice', 'There is no booked revenue to export for this range.');
      return;
    }
    const header = [
      'Period',
      ...data.columns.map((c) => (c.linked ? `${c.name} (${c.venue_name})` : c.name)),
      'Total',
      'No-shows',
    ];
    const rows = data.periods.map((p) => [
      periodLabel(p.period_start, p.period_end, data.grain),
      ...data.columns.map((c) => (netPence(p.by_calendar[c.key], includeNoShows) / 100).toFixed(2)),
      (netPence(p, includeNoShows) / 100).toFixed(2),
      (p.no_show_pence / 100).toFixed(2),
    ]);
    rows.push([
      'Total',
      ...data.columns.map((c) => (netPence(data.totals.by_calendar[c.key], includeNoShows) / 100).toFixed(2)),
      (totalNet / 100).toFixed(2),
      (data.totals.no_show_pence / 100).toFixed(2),
    ]);
    downloadCsv(`booked-revenue-${data.from}-${data.to}-${data.grain}.csv`, [header, ...rows]);
    onExportNotice('success', 'Booked revenue CSV download started - check your downloads folder.');
  };

  return (
    <>
      <SectionCard elevated>
        <SectionCard.Header eyebrow="Revenue" title="Booked revenue" />
        <SectionCard.Body className="space-y-4">
          <p className="text-sm text-slate-500">
            The value of every {bookingWord.toLowerCase()} on the diary that has not been cancelled, by day and by
            calendar. Future dates show everything booked. Past dates leave out services marked as a no-show unless
            you tick <strong>Include no-shows</strong>.
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
                  onChange={(e) => setCustomDraft((r) => ({ ...r, from: e.target.value }))}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">To</span>
                <input
                  type="date"
                  value={customDraft.to}
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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Show by</span>
              {GRAINS.map((g) => (
                <button key={g.id} type="button" className={chipClass(grain === g.id)} onClick={() => setGrain(g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={includeNoShows}
                onChange={(e) => setIncludeNoShows(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Include no-shows
            </label>
          </div>
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Report"
          title={data ? `Booked revenue, ${rangeLabel}` : 'Booked revenue'}
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
            <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Could not load booked revenue'}</p>
          ) : null}
          {!data && isLoading ? (
            <div className="h-64">
              <DashboardChartSkeleton kpiCount={3} />
            </div>
          ) : null}
          {data ? (
            <div className={isValidating ? 'opacity-70 transition-opacity' : 'transition-opacity'} aria-busy={isValidating}>
              <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile
                  label={includeNoShows ? 'Booked revenue (incl. no-shows)' : 'Booked revenue'}
                  value={money(totalNet)}
                  color="brand"
                  subValue={
                    hasFuture && hasPast
                      ? 'Past and upcoming dates'
                      : hasFuture
                        ? 'Upcoming dates'
                        : 'Past dates'
                  }
                />
                <StatTile
                  label={includeNoShows ? 'No-shows included' : 'No-shows deducted'}
                  value={money(data.totals.no_show_pence)}
                  color="amber"
                  subValue={`${data.totals.no_show_count} ${data.totals.no_show_count === 1 ? 'service' : 'services'}`}
                />
                <StatTile
                  label={`${bookingWord}s counted`}
                  value={String(totalCount)}
                  color="slate"
                  subValue={unpriced > 0 ? `${unpriced} without a price` : undefined}
                />
              </div>
              {unpriced > 0 ? (
                <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {unpriced} {unpriced === 1 ? 'service has' : 'services have'} no price on the booking or in your
                  service list, so {unpriced === 1 ? 'it adds' : 'they add'} nothing to these totals.
                </p>
              ) : null}
              {linkedColumns.length > 0 ? (
                <p className="mb-4 text-sm text-slate-500">
                  Includes calendars from {[...new Set(linkedColumns.map((c) => c.venue_name))].join(', ')}, shared
                  with you through a linked account.
                </p>
              ) : null}

              <div className="mb-6 h-72">
                {!recharts ? (
                  <DashboardChartSkeleton kpiCount={0} />
                ) : data.periods.length === 0 || columns.length === 0 ? (
                  <p className="text-sm text-slate-400">No {bookingWord.toLowerCase()}s in this range.</p>
                ) : (
                  <recharts.ResponsiveContainer width="100%" height="100%">
                    <recharts.BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <recharts.CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <recharts.XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <recharts.YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `£${v}`} width={56} />
                      <recharts.Tooltip
                        formatter={(value: number, name: string) => [money(Math.round(value * 100)), name]}
                        labelFormatter={(_label, payload) =>
                          (payload?.[0]?.payload as { full?: string } | undefined)?.full ?? String(_label)
                        }
                      />
                      {columns.length > 1 ? <recharts.Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                      {columns.map((col, index) => (
                        <recharts.Bar
                          key={col.key}
                          dataKey={col.key}
                          name={col.linked ? `${col.name} (${col.venue_name})` : col.name}
                          stackId="revenue"
                          fill={colourFor(index)}
                          radius={index === columns.length - 1 ? [6, 6, 0, 0] : undefined}
                        />
                      ))}
                    </recharts.BarChart>
                  </recharts.ResponsiveContainer>
                )}
              </div>

              {data.periods.length > 0 && columns.length > 0 ? (
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Period</th>
                        {ownColumns.map((col, index) => (
                          <th key={col.key} className="whitespace-nowrap px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: colourFor(index) }}
                                aria-hidden
                              />
                              {col.name}
                            </span>
                          </th>
                        ))}
                        {linkedColumns.map((col, index) => (
                          <th key={col.key} className="whitespace-nowrap px-3 py-2 text-right">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                                style={{ backgroundColor: colourFor(ownColumns.length + index) }}
                                aria-hidden
                              />
                              {col.name}
                            </span>
                            <span className="block text-[10px] font-medium normal-case tracking-normal text-slate-400">
                              {col.venue_name}
                            </span>
                          </th>
                        ))}
                        <th className="whitespace-nowrap px-3 py-2 text-right">Total</th>
                        {!includeNoShows ? (
                          <th className="whitespace-nowrap px-3 py-2 text-right text-amber-700">No-shows</th>
                        ) : null}
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
                            {columns.map((col) => {
                              const v = netPence(p.by_calendar[col.key], includeNoShows);
                              return (
                                <td
                                  key={col.key}
                                  className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${v === 0 ? 'text-slate-300' : 'text-slate-700'}`}
                                >
                                  {v === 0 ? '£0' : money(v)}
                                </td>
                              );
                            })}
                            <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                              {money(netPence(p, includeNoShows))}
                            </td>
                            {!includeNoShows ? (
                              <td
                                className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${p.no_show_pence === 0 ? 'text-slate-300' : 'text-amber-700'}`}
                              >
                                {p.no_show_pence === 0 ? '£0' : money(p.no_show_pence)}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-900">
                      <tr>
                        <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Total</td>
                        {columns.map((col) => (
                          <td key={col.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                            {money(netPence(data.totals.by_calendar[col.key], includeNoShows))}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{money(totalNet)}</td>
                        {!includeNoShows ? (
                          <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700">
                            {money(data.totals.no_show_pence)}
                          </td>
                        ) : null}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </SectionCard.Body>
      </SectionCard>
    </>
  );
}
