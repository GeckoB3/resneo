'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { LINKED_ACCOUNT_INCOMING_CHANGED_EVENT } from '@/lib/linked-accounts/incoming-banner-events';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';

interface BannerItem {
  id: string;
  text: string;
  cta: string;
  href: string;
}

const DISMISS_KEY = 'reserveni.linkedAccountBannerDismissals';
const DISMISS_MS = 24 * 60 * 60 * 1000;
const TAB = '/dashboard/settings?tab=linked-accounts';

function loadDismissals(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

/** Persist a dismissal and return the updated map. */
function recordDismissal(id: string): Record<string, number> {
  const next = { ...loadDismissals(), [id]: Date.now() };
  try {
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
  return next;
}

/** Items not dismissed within the last 24h. */
function filterVisible(items: BannerItem[], dismissed: Record<string, number>): BannerItem[] {
  const now = Date.now();
  return items.filter((i) => {
    const at = dismissed[i.id];
    return !at || now - at > DISMISS_MS;
  });
}

interface IncomingFeed {
  incomingRequests?: { id: string; otherVenueName: string; collective?: { id: string; name: string } | null }[];
  outgoingRequests?: { id: string; otherVenueName: string; collective?: { id: string; name: string } | null }[];
  pendingChanges?: { id: string; otherVenueName: string }[];
  collectiveSetup?: { collectiveId: string; name: string; memberNames: string[] }[];
  memberWaiting?: { collectiveId: string; name: string; hostName: string }[];
}

/** The banner rows a feed becomes; exported for the test. */
export function bannerItemsFromFeed(feed: IncomingFeed): BannerItem[] {
  return [
    ...(feed.incomingRequests ?? []).map((r) => ({
      id: `request:${r.id}`,
      text: r.collective
        ? collectiveCopy('banner.requestWithCollective', { venue: r.otherVenueName, collective: r.collective.name })
        : collectiveCopy('banner.request', { venue: r.otherVenueName }),
      cta: collectiveCopy('banner.review.cta'),
      href: `${TAB}&review=${encodeURIComponent(r.id)}`,
    })),
    ...(feed.outgoingRequests ?? []).map((r) => ({
      id: `waiting:${r.id}`,
      text: r.collective
        ? collectiveCopy('banner.waitingWithCollective', { venue: r.otherVenueName, collective: r.collective.name })
        : collectiveCopy('banner.waiting', { venue: r.otherVenueName }),
      cta: collectiveCopy('banner.waiting.cta'),
      href: TAB,
    })),
    ...(feed.pendingChanges ?? []).map((c) => ({
      id: `change:${c.id}`,
      text: collectiveCopy('banner.change', { venue: c.otherVenueName }),
      cta: collectiveCopy('banner.change.cta'),
      href: TAB,
    })),
    ...(feed.collectiveSetup ?? []).map((s) => ({
      id: `setup:${s.collectiveId}`,
      text: collectiveCopy('banner.setup', { venueList: formatVenueList(s.memberNames, 2) || 'Your partner venue', collective: s.name }),
      cta: collectiveCopy('banner.setup.cta'),
      href: `${TAB}&setup=${encodeURIComponent(s.collectiveId)}`,
    })),
    ...(feed.memberWaiting ?? []).map((m) => ({
      id: `member-waiting:${m.collectiveId}`,
      text: collectiveCopy('banner.memberWaiting', { collective: m.name, host: m.hostName }),
      cta: collectiveCopy('banner.memberWaiting.cta'),
      href: TAB,
    })),
  ];
}

/**
 * Persistent dashboard banner for Admins (spec §8.3; Docs/link-and-collective-setup-wizard-plan.md
 * §4): incoming link requests, naming the collective proposed with them; pending permission changes
 * awaiting this venue's response; and, for a host, a collective whose page is not live yet.
 */
export function LinkedAccountBanner() {
  const [items, setItems] = useState<BannerItem[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<BannerItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/account-links/incoming');
      if (!res.ok) return;
      const json = (await res.json()) as IncomingFeed;
      setItems(bannerItemsFromFeed(json));
    } catch {
      // The banner is best-effort; stay silent on failure.
    }
  }, []);

  useEffect(() => {
    setDismissed(loadDismissals());

    void refresh();

    const onIncomingChanged = () => {
      void refresh();
    };

    // Re-check when the tab regains focus so a request that arrives while the
    // dashboard is open surfaces without a manual reload (§8.3).
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(LINKED_ACCOUNT_INCOMING_CHANGED_EVENT, onIncomingChanged);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(LINKED_ACCOUNT_INCOMING_CHANGED_EVENT, onIncomingChanged);
    };
  }, [refresh]);

  useEffect(() => {
    setVisible(filterVisible(items, dismissed));
  }, [items, dismissed]);

  if (visible.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissed(recordDismissal(id));
  };

  return (
    <div className="space-y-2 border-b border-brand-200/80 bg-gradient-to-r from-brand-50 via-white to-brand-50/30 px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-[1400px] space-y-2">
        {visible.map((item) => (
          <div key={item.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Pill variant="brand" size="sm" className="shrink-0">
                {item.id.startsWith('setup:') || item.id.startsWith('member-waiting:') ? 'Collective' : 'Linked accounts'}
              </Pill>
              <p className="min-w-0 text-sm text-brand-950">
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mr-1 inline-block h-4 w-4 -translate-y-px text-brand-600"
                >
                  <path d="M9 17H7A5 5 0 0 1 7 7h2" />
                  <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
                  <path d="M8 12h8" />
                </svg>
                {item.text}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <a
                href={item.href}
                className="inline-flex min-h-9 items-center justify-center rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                {item.cta}
              </a>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="inline-flex min-h-9 items-center justify-center rounded-xl px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
              >
                {collectiveCopy('banner.dismiss')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
