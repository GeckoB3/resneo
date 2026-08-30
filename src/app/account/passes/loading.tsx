import { Skeleton } from '@/components/ui/Skeleton';
import { PASSES_TABS } from './passes-tabs';

/**
 * Loading shape for the passes page (P0-5).
 *
 * Deliberately NOT one of the `PortalSkeletons`: those open with a real
 * `PageHeader`, and this route's heading belongs to whichever section the tab
 * resolves to, which the server does not know until the client picks it. A
 * skeleton that printed one section's title would name the wrong tab whenever
 * the customer deep-linked into another.
 */
export default function AccountPassesLoading() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading passes and plans">
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-1">
        {PASSES_TABS.map((t) => (
          <Skeleton.Block key={t.id} className="h-9 w-24 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton.Line className="h-2.5 w-16" />
        <Skeleton.Line className="h-7 w-56 max-w-full" />
        <Skeleton.Line className="h-3 w-80 max-w-full" />
      </div>
      <Skeleton.Block className="h-40 rounded-2xl" />
    </div>
  );
}
