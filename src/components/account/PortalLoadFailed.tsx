'use client';

import { Button } from '@/components/ui/primitives';

/**
 * What a portal section shows when its own fetch fails (P0-5, closes G24).
 *
 * THE DEFECT THIS REPLACES. Every section's `load()` parsed the response body
 * BEFORE checking `res.ok`, with no try/catch anywhere:
 *
 *     const res = await fetch(url);
 *     const data = await res.json();     // throws on a 500 HTML page
 *     if (!res.ok) { setError(...); }    // never reached
 *
 * So a dropped connection or an error page that is not JSON rejected the load
 * silently and the section rendered its EMPTY state. A customer with a network
 * problem was told they had no credits, no memberships, no saved cards.
 * `AccountPaymentMethodsSection` went furthest and told them to go and make a
 * purchase to fix it.
 *
 * The distinction this component exists to draw is the one G24 names: a failed
 * state has to look different from a genuine empty one. `EmptyState` is a
 * quiet dashed panel saying "nothing here yet"; this is amber, says the
 * failure is ours, and offers a retry, because those are three different
 * things to tell a customer.
 */
export function PortalLoadFailed({
  message,
  onRetry,
  retrying = false,
}: {
  /** What went wrong, from the server when it said so. */
  message?: string | null;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-amber-200/90 bg-amber-50/60 p-5 shadow-sm shadow-amber-900/5 sm:p-6"
    >
      <h3 className="text-sm font-semibold text-amber-950">We could not load this</h3>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-slate-700">
        {message?.trim()
          ? message
          : 'Something went wrong on our side, not yours. Nothing has been lost; try again in a moment.'}
      </p>
      <Button type="button" variant="secondary" loading={retrying} onClick={onRetry} className="mt-4">
        Try again
      </Button>
    </div>
  );
}
