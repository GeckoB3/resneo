'use client';

import type { ReactNode } from 'react';
import type { DashboardStatColor } from '@/components/dashboard/dashboard-stat-types';
import { MiniSparkline } from '@/components/ui/dashboard/MiniSparkline';

const colorClasses: Record<DashboardStatColor, string> = {
  blue: 'bg-blue-50/90 text-blue-800 border-blue-100/80',
  brand: 'bg-brand-50/90 text-brand-800 border-brand-100/80',
  violet: 'bg-violet-50/90 text-violet-800 border-violet-100/80',
  emerald: 'bg-emerald-50/90 text-emerald-800 border-emerald-100/80',
  amber: 'bg-amber-50/90 text-amber-900 border-amber-100/80',
  slate: 'bg-slate-50 text-slate-800 border-slate-200/90',
};

export function StatTile({
  label,
  value,
  color,
  subValue,
  subValue2,
  trend,
  icon,
  sparklineValues,
}: {
  label?: string;
  value: string | number;
  color: DashboardStatColor;
  subValue?: string;
  subValue2?: string;
  /** Short trend label e.g. "+12%" */
  trend?: string;
  icon?: ReactNode;
  /** Optional series for micro sparkline */
  sparklineValues?: number[];
}) {
  return (
    <div
      className={`relative flex min-h-[4.5rem] flex-col justify-between rounded-xl border px-3 py-2.5 sm:min-h-0 sm:px-4 sm:py-3 ${colorClasses[color]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums leading-none tracking-tight sm:text-3xl">{value}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {sparklineValues && sparklineValues.length > 1 ? <MiniSparkline values={sparklineValues} /> : null}
          {icon ? <span className="opacity-70">{icon}</span> : null}
        </div>
      </div>
      {subValue ? (
        <p className="mt-1 text-xs font-medium tabular-nums opacity-85">{subValue}</p>
      ) : null}
      {subValue2 ? (
        <p className="mt-0.5 text-xs font-medium tabular-nums opacity-85">{subValue2}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
        {label ? (
          <p className="min-w-0 break-words text-xs font-semibold uppercase tracking-wide leading-snug opacity-80">
            {label}
          </p>
        ) : (
          <span />
        )}
        {trend ? (
          <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-xs font-bold tabular-nums text-emerald-700 ring-1 ring-emerald-100/80">
            {trend}
          </span>
        ) : null}
      </div>
    </div>
  );
}
