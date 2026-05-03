import { Suspense } from 'react';
import { KpiCards } from './KpiCards';
import { VenuesTable } from './VenuesTable';

export const dynamic = 'force-dynamic';

export default function SuperDashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Platform Overview</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monitor all ReserveNI subscriptions and venues.
        </p>
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
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
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
