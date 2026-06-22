import { Suspense } from 'react';
import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/** Shown while the credits section bundle streams in (replaces a blank `fallback={null}`). */
function CreditsFallback() {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Account" title="Class credits" subtitle="Loading your venue credit balances…" />
      <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/5 sm:p-6">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-3">
              <div className="h-3 w-48 max-w-full animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-12 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AccountCreditsPage() {
  return (
    <Suspense fallback={<CreditsFallback />}>
      <AccountCreditsSection />
    </Suspense>
  );
}
