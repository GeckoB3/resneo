import { Skeleton } from '@/components/ui/Skeleton';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/**
 * Loading shapes for the portal routes (P0-5).
 *
 * Built from the `Skeleton` primitives rather than `DashboardPageSkeleton`,
 * which wraps itself in `PageFrame` and would nest a second max-width and
 * padding inside the account layout's `<main>`. The primitives are the shared
 * part that matters; the frame is the dashboard's, not the portal's.
 *
 * Each mirrors the real layout closely enough to avoid a shift when the
 * content arrives. A skeleton that does not match the thing it stands in for
 * is worse than a spinner: it promises a shape and then moves everything.
 */

/** A page header plus N list rows: bookings, events, resources. */
export function PortalListSkeleton({
  title,
  subtitle,
  rows = 3,
  tabs = 0,
}: {
  title: string;
  subtitle?: string;
  rows?: number;
  tabs?: number;
}) {
  return (
    <div className="space-y-8" role="status" aria-label={`Loading ${title.toLowerCase()}`}>
      <PageHeader eyebrow="Account" title={title} subtitle={subtitle} />
      {tabs > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: tabs }).map((_, i) => (
            <Skeleton.Block key={i} className="h-10 w-24 rounded-full" />
          ))}
        </div>
      ) : null}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center justify-between gap-4 px-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton.Line className="w-40" />
              <Skeleton.Line className="h-3 w-64 max-w-full" />
              <Skeleton.Line className="h-3 w-28" />
            </div>
            <Skeleton.Line className="h-4 w-16" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A page header plus N stacked cards: the hub, profile, a booking detail. */
export function PortalCardsSkeleton({
  title,
  subtitle,
  cards = 3,
}: {
  title: string;
  subtitle?: string;
  cards?: number;
}) {
  return (
    <div className="space-y-8" role="status" aria-label={`Loading ${title.toLowerCase()}`}>
      <PageHeader eyebrow="Account" title={title} subtitle={subtitle} />
      <div className="space-y-6">
        {Array.from({ length: cards }).map((_, i) => (
          <div
            key={i}
            className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7"
          >
            <Skeleton.Line className="w-1/3" />
            <Skeleton.Line className="h-3 w-full max-w-xl" />
            <Skeleton.Block className="h-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
