'use client';

import { Button } from '@/components/ui/primitives';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';

/**
 * What a portal route shows when its server component throws (P0-5, G7).
 *
 * WHY ROUTE-LOCAL BOUNDARIES RATHER THAN THE ROOT ONE. Without an `error.tsx`
 * per route, a data error unwinds to `src/app/error.tsx`, which sits outside
 * the account layout: the customer loses the portal header, the account nav
 * and every route they might navigate to instead, and is left on a bare page
 * with a back button. A boundary here keeps the chrome and offers a retry
 * scoped to the one thing that failed.
 *
 * Next passes `reset()`, which re-renders the segment. That is a real retry
 * for a transient failure, and doing nothing worse than failing again for a
 * persistent one, which is why the second affordance is a link out.
 */
export function PortalErrorState({
  title,
  reset,
  error,
}: {
  /** The page's own title, so the customer can see which part failed. */
  title: string;
  reset: () => void;
  error: Error & { digest?: string };
}) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Account" title={title} />
      <div
        // Not aria-live: this replaces the page rather than updating part of
        // it, so a screen reader already announces the new content. `alert`
        // would announce it a second time.
        role="alert"
        className="rounded-2xl border border-amber-200/90 bg-amber-50/60 p-6 shadow-sm shadow-amber-900/5 sm:p-7"
      >
        <h2 className="text-base font-semibold text-amber-950">We could not load this page</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-slate-700">
          Something went wrong on our side, not yours. Your bookings and payments are unaffected.
          Try again, and if it keeps happening the venue can still help you directly.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Button type="button" variant="secondary" onClick={() => window.location.assign('/account')}>
            Go to my account
          </Button>
        </div>
        {error.digest ? (
          // Shown, not hidden: it is the only thing that lets support tie a
          // customer's report to a server log, and it identifies nothing else.
          <p className="mt-4 text-xs text-slate-500">
            Reference: <span className="font-mono">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
