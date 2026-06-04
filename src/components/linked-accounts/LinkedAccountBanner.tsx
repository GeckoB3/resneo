'use client';

import { useCallback, useEffect, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { LINKED_ACCOUNT_INCOMING_CHANGED_EVENT } from '@/lib/linked-accounts/incoming-banner-events';

interface IncomingItem {
  id: string;
  otherVenueName: string;
}

const DISMISS_KEY = 'reserveni.linkedAccountBannerDismissals';
const DISMISS_MS = 24 * 60 * 60 * 1000;

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
function filterVisible(
  items: IncomingItem[],
  dismissed: Record<string, number>,
): IncomingItem[] {
  const now = Date.now();
  return items.filter((i) => {
    const at = dismissed[i.id];
    return !at || now - at > DISMISS_MS;
  });
}

/**
 * Persistent dashboard banner for Admins (§8.3): incoming link requests and
 * pending permission changes awaiting this venue's response.
 */
export function LinkedAccountBanner() {
  const [items, setItems] = useState<IncomingItem[]>([]);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [visible, setVisible] = useState<IncomingItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/account-links/incoming');
      if (!res.ok) return;
      const json = await res.json();
      const merged: IncomingItem[] = [
        ...(json.incomingRequests ?? []).map((r: { id: string; otherVenueName: string }) => ({
          id: `request:${r.id}`,
          otherVenueName: r.otherVenueName,
        })),
        ...(json.pendingChanges ?? []).map((c: { id: string; otherVenueName: string }) => ({
          id: `change:${c.id}`,
          otherVenueName: c.otherVenueName,
        })),
      ];
      setItems(merged);
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
        {visible.map((item) => {
          const isChange = item.id.startsWith('change:');
          return (
            <div
              key={item.id}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-start gap-2">
                <Pill variant="brand" size="sm" className="shrink-0">
                  Linked accounts
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
                  <span className="font-semibold">{item.otherVenueName}</span>{' '}
                  {isChange
                    ? 'proposed a permission change to your link.'
                    : 'wants to link with your venue.'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a
                  href="/dashboard/settings?tab=linked-accounts"
                  className="inline-flex min-h-9 items-center justify-center rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
                >
                  {isChange ? 'Review change' : 'Review request'}
                </a>
                <button
                  type="button"
                  onClick={() => dismiss(item.id)}
                  className="inline-flex min-h-9 items-center justify-center rounded-xl px-3 py-1.5 text-xs font-semibold text-brand-800 hover:bg-brand-100"
                >
                  Dismiss for 24h
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
