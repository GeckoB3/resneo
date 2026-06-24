import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/** Skeleton while the upcoming-resources hub loads. Mirrors the list layout to avoid layout shift. */
export default function AccountResourcesLoading() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Account"
        title="Your resource bookings"
        subtitle="Loading your upcoming resource bookings…"
      />
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-slate-100" />
              <div className="h-3 w-28 animate-pulse rounded bg-slate-100" />
            </div>
            <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
          </li>
        ))}
      </ul>
    </div>
  );
}
