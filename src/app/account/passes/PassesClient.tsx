'use client';

import { Suspense, useCallback, useState } from 'react';
import { TabBar } from '@/components/ui/dashboard/TabBar';
import { Skeleton } from '@/components/ui/Skeleton';
import { AccountCreditsSection } from '@/components/account/AccountCreditsSection';
import { AccountCoursesSection } from '@/components/account/AccountCoursesSection';
import { AccountMembershipsSection } from '@/components/account/AccountMembershipsSection';
import { AccountRecurringSection } from '@/components/account/AccountRecurringSection';
import { PASSES_PATH, PASSES_TABS, type PassesTab } from './passes-tabs';

/** Header-shaped, so the section's own `PageHeader` lands where this line was. */
function PanelFallback() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading">
      <div className="space-y-2">
        <Skeleton.Line className="h-2.5 w-16" />
        <Skeleton.Line className="h-7 w-56 max-w-full" />
        <Skeleton.Line className="h-3 w-80 max-w-full" />
      </div>
      <Skeleton.Block className="h-40 rounded-2xl" />
    </div>
  );
}

/**
 * Keep `?tab=` current without a Next navigation.
 *
 * `history.replaceState` rather than `router.replace` for two reasons. The
 * server page would otherwise re-run on every tab click for a value only the
 * client cares about. More importantly the four sections read their deep-link
 * arguments from `useSearchParams()`, and a router navigation hands them a new
 * params object on every switch; leaving the params frozen at what the customer
 * arrived with keeps a tab click well away from anything that starts a payment.
 *
 * Read from `window.location.search` rather than from a prop so the rest of the
 * query survives intact however the customer got here.
 */
function syncTabInUrl(tab: PassesTab): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('tab', tab);
  window.history.replaceState(window.history.state, '', `${PASSES_PATH}?${params.toString()}`);
}

/**
 * Credits, courses, memberships and recurring reservations behind one set of
 * tabs (P1-5), replacing four nav items and the static `/account/classes` hub.
 *
 * Only the active section is mounted. Rendering all four and hiding three
 * would fire four API calls for one page, and would let the memberships and
 * courses sections run their `autostart=1` deep-link effects on a tab the
 * customer is not looking at: those effects start a real card payment. Hidden
 * does not mean inert.
 *
 * `TabBar` is fully controlled and does no URL syncing of its own
 * (`TabBar.tsx:9`), so the `?tab=` wiring below belongs to this task rather
 * than to the component.
 */
export function PassesClient({ initialTab }: { initialTab: PassesTab }) {
  const [tab, setTab] = useState<PassesTab>(initialTab);

  const onChange = useCallback((next: PassesTab) => {
    setTab(next);
    syncTabInUrl(next);
  }, []);

  const activeLabel = PASSES_TABS.find((t) => t.id === tab)?.label ?? '';

  return (
    <div className="space-y-8">
      <TabBar
        tabs={PASSES_TABS}
        value={tab}
        onChange={onChange}
        // The single-row layout, deliberately. `two-row-scroll` renders the tab
        // strip TWICE, once per breakpoint, so the page would carry two
        // tablists and two tabs named "Credits", one hidden by CSS alone.
        //
        // That row does overflow at 375px, by 55px, measured rather than
        // assumed: "Recurring" is clipped. So the note stays. `mobileNote={null}`
        // was the first version of this, on the guess that four short labels
        // would fit, and it would have left a tab the customer could not see
        // and had no reason to look for. Worded for the portal rather than
        // taking the component's default, which says "settings tabs".
        mobileNote="Scroll sideways to see all your passes and plans"
      />
      {/*
        Named for the tab it belongs to: a tab panel with no accessible name is
        announced as an unlabelled group. `TabBar` renders no ids on its tabs,
        so `aria-labelledby` back to the tab is not available without changing a
        component eight dashboard screens share.

        Keyed by tab so switching unmounts the previous section outright rather
        than reconciling one commerce form into another.
      */}
      <div role="tabpanel" aria-label={activeLabel} key={tab}>
        <Suspense fallback={<PanelFallback />}>
          {tab === 'credits' ? <AccountCreditsSection /> : null}
          {tab === 'courses' ? <AccountCoursesSection /> : null}
          {tab === 'memberships' ? <AccountMembershipsSection /> : null}
          {tab === 'recurring' ? <AccountRecurringSection /> : null}
        </Suspense>
      </div>
    </div>
  );
}
