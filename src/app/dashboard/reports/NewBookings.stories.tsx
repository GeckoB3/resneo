import { useState, type ReactNode } from 'react';
import type { Story } from '@ladle/react';
import * as recharts from 'recharts';
import { SWRConfig } from 'swr';
import { NewBookingsCard } from '../NewBookingsCard';
import { NewBookingsSection } from './NewBookingsSection';
import {
  NEW_BOOKINGS_PRESETS,
  aggregateNewBookings,
  countNewBookings,
  resolveNewBookingsPreset,
  type NewBookingChannel,
  type NewBookingUnit,
  type NewBookingsPreset,
  type NewBookingsSummary,
} from '@/lib/reports/new-bookings';
import { addDaysYmd, periodStartFor, type ReportGrain } from '@/lib/reports/report-periods';

/**
 * The New bookings card on the dashboard home and the New bookings tab on
 * Settings → Reports, over three months of made-up bookings (a busy salon:
 * mostly online, some by the team, the odd walk-in and linked-venue booking).
 * The report's requests are answered in the browser from the same data, so the
 * range and grain chips work.
 */

const TODAY = '2026-09-19';

/** Deterministic noise per date, so the story looks the same every time. */
function noise(ymd: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (const ch of ymd) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function makeUnits(): NewBookingUnit[] {
  const units: NewBookingUnit[] = [];
  for (let day = '2026-06-01'; day <= TODAY; day = addDaysYmd(day, 1)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const base = weekday === 0 ? 1 : weekday === 1 ? 4 : 7;
    const n = Math.round(base + noise(day, 1) * 5);
    for (let i = 0; i < n; i += 1) {
      const r = noise(`${day}#${i}`, 2);
      const channel: NewBookingChannel = r < 0.62 ? 'online' : r < 0.9 ? 'team' : r < 0.97 ? 'walk_in' : 'linked_venue';
      const s = noise(`${day}#${i}`, 3);
      units.push({
        key: `${day}-${i}`,
        day,
        channel,
        state: s < 0.08 ? 'cancelled' : s < 0.11 && day >= addDaysYmd(TODAY, -2) ? 'pending' : 'active',
        rows: [],
      });
    }
  }
  return units;
}

const UNITS = makeUnits();

function summaryFor(units: NewBookingUnit[]): NewBookingsSummary {
  const weekStart = periodStartFor(TODAY, 'week');
  const monthStart = periodStartFor(TODAY, 'month');
  return {
    today: countNewBookings(units, TODAY, TODAY),
    this_week: countNewBookings(units, weekStart, TODAY),
    this_month: countNewBookings(units, monthStart, TODAY),
    week_start: weekStart,
    month_start: monthStart,
  };
}

let fetchStubbed = false;

/** Answers the report's requests from `UNITS`, the way the route would. */
function stubReportFetch() {
  if (fetchStubbed || typeof window === 'undefined') return;
  fetchStubbed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), window.location.href);
    if (!url.pathname.endsWith('/api/venue/reports/new-bookings')) return realFetch(input, init);
    const preset = url.searchParams.get('preset');
    const grain = (url.searchParams.get('grain') ?? 'day') as ReportGrain;
    const range = NEW_BOOKINGS_PRESETS.includes(preset as NewBookingsPreset)
      ? resolveNewBookingsPreset(preset as NewBookingsPreset, TODAY)
      : { from: url.searchParams.get('from') ?? TODAY, to: url.searchParams.get('to') ?? TODAY };
    const to = range.to > TODAY ? TODAY : range.to;
    const body = aggregateNewBookings({ units: UNITS, from: range.from, to, grain, today: TODAY });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const frame = (children: ReactNode) => (
  <div className="min-h-screen bg-slate-50 p-4 sm:p-8">
    <div className="mx-auto max-w-5xl space-y-6">{children}</div>
  </div>
);

export const HomeCard: Story = () =>
  frame(<NewBookingsCard summary={summaryFor(UNITS)} showReportLink />);

export const HomeCardQuietDay: Story = () =>
  frame(
    <NewBookingsCard
      summary={summaryFor(UNITS.filter((u) => u.day !== TODAY))}
      showReportLink={false}
    />,
  );

export const HomeCardUnavailable: Story = () => frame(<NewBookingsCard summary={null} showReportLink />);

export const ReportsTab: Story = () => {
  useState(() => stubReportFetch());
  return frame(
    <SWRConfig value={{ provider: () => new Map() }}>
      <NewBookingsSection recharts={recharts} onExportNotice={() => {}} />
    </SWRConfig>,
  );
};
