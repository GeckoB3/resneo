'use client';

import type { ReactNode } from 'react';

export interface ClassTimetableStatsSnapshot {
  activeClassTypes: number;
  sessionsNext7Days: number;
  upcomingSessions: number;
  totalBookedSpots: number;
}

interface ClassTimetableStatsRowProps {
  loading: boolean;
  classTypesLength: number;
  stats: ClassTimetableStatsSnapshot;
}

function Sep() {
  return (
    <span className="hidden select-none text-slate-300 sm:inline" aria-hidden>
      ·
    </span>
  );
}

function Metric({ value, title, children }: { value: number; title: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 whitespace-nowrap" title={title}>
      <span className="font-semibold tabular-nums text-slate-900">{value}</span>
      <span className="font-normal text-slate-600">{children}</span>
    </span>
  );
}

/** Compact summary bar above the class timetable workflow card. */
export function ClassTimetableStatsRow({ loading, classTypesLength, stats }: ClassTimetableStatsRowProps) {
  if (loading || classTypesLength === 0) return null;

  const summary = `${stats.activeClassTypes} active class types, ${stats.sessionsNext7Days} sessions in the next 7 days, ${stats.upcomingSessions} upcoming sessions, ${stats.totalBookedSpots} booked spots across upcoming sessions.`;

  return (
    <div
      role="status"
      aria-label={summary}
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border border-slate-200/90 bg-slate-50/80 px-2.5 py-1 text-[11px] leading-tight text-slate-600 sm:gap-x-2 sm:px-3 sm:text-xs"
    >
      <Metric value={stats.activeClassTypes} title="Active class types">
        active types
      </Metric>
      <Sep />
      <Metric value={stats.sessionsNext7Days} title="Sessions scheduled in the next 7 days">
        sessions (7d)
      </Metric>
      <Sep />
      <Metric value={stats.upcomingSessions} title="Total upcoming sessions">
        upcoming
      </Metric>
      <Sep />
      <Metric value={stats.totalBookedSpots} title="Booked spots across all upcoming sessions">
        booked spots
      </Metric>
    </div>
  );
}
