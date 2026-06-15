import { Suspense } from 'react';
import { KpiCards } from './KpiCards';
import { VenuesTable } from './VenuesTable';

export const dynamic = 'force-dynamic';

export default function SuperDashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monitor all ResNeo subscriptions and venues. KPIs cover live venues only — test venues sit
            under the &quot;Test venues&quot; tab below.
          </p>
        </div>
        <a
          href="/api/platform/export?type=venues"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export venues CSV
        </a>
      </div>

      <Suspense fallback={<KpiSkeleton />}>
        <KpiCards />
      </Suspense>

      <div className="mt-8">
        <Suspense fallback={<TableSkeleton />}>
          <VenuesTable />
        </Suspense>
      </div>
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white">
      <div className="h-12 border-b border-slate-100 bg-slate-50 rounded-t-xl" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-14 border-b border-slate-100 last:border-0" />
      ))}
    </div>
  );
}
