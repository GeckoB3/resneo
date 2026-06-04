'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import type { LinkNotificationView } from '@/lib/linked-accounts/notification-center';

// Realtime delivers new notifications instantly; the poll is a backstop for when
// the realtime channel can't connect (it falls back gracefully).
const POLL_MS = 60_000;

/** Compact "5m" / "3h" / "2d" / date relative-time label. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Today" / "Yesterday" / "12 Jun" grouping label, in the viewer's local day. */
function dayGroupLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = startOfDay(new Date());
  const that = startOfDay(d);
  const dayMs = 86_400_000;
  if (that === today) return 'Today';
  if (that === today - dayMs) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function groupByDay(items: LinkNotificationView[]): { label: string; items: LinkNotificationView[] }[] {
  const groups: { label: string; items: LinkNotificationView[] }[] = [];
  for (const item of items) {
    const label = dayGroupLabel(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/**
 * Linked Accounts notification bell (spec §17.2). Admin-only, mounted in the
 * dashboard shell. Shows an unread badge and a popover feed of cross-venue
 * activity; items deep-link to the affected day and mark themselves read.
 */
export function NotificationBell() {
  const [items, setItems] = useState<LinkNotificationView[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [venueId, setVenueId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/notifications', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as {
        notifications?: LinkNotificationView[];
        unreadCount?: number;
        venueId?: string;
      };
      setItems(data.notifications ?? []);
      setUnread(data.unreadCount ?? 0);
      if (data.venueId) setVenueId(data.venueId);
    } catch {
      // The bell must never break the dashboard; a failed poll just keeps stale data.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // §17 — realtime: refresh the moment a notification lands for this venue, so a
  // cross-venue action or lifecycle event surfaces without waiting for the poll.
  // RLS scopes the rows to this venue; the filter is a belt-and-braces narrowing.
  useEffect(() => {
    if (!venueId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`link-notifications-${venueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'account_link_notifications',
          filter: `venue_id=eq.${venueId}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [venueId, load]);

  // Refresh when the popover opens so the list is current.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markAllRead = useCallback(async () => {
    if (unread === 0) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnread(0);
    try {
      await fetch('/api/venue/notifications/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      void load();
    }
  }, [unread, load]);

  const openItem = useCallback(
    async (n: LinkNotificationView) => {
      setOpen(false);
      if (!n.read) {
        setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
        try {
          await fetch('/api/venue/notifications/read', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [n.id] }),
          });
        } catch {
          /* navigation still proceeds */
        }
      }
      window.location.href = n.href;
    },
    [],
  );

  const groups = groupByDay(items);
  const badge = unread > 9 ? '9+' : String(unread);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-rose-600 px-1 text-[0.65rem] font-semibold leading-[1.1rem] text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
            <button
              type="button"
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs font-medium text-brand-700 hover:text-brand-900 disabled:cursor-default disabled:text-slate-300"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[24rem] overflow-y-auto overscroll-contain">
            {!loaded ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Loading…</p>
            ) : groups.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-slate-700">You&rsquo;re all caught up</p>
                <p className="mt-1 text-xs text-slate-400">
                  Activity from your linked venues will appear here.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label}>
                  <p className="bg-slate-50/80 px-4 py-1.5 text-[0.7rem] font-semibold tracking-wide text-slate-400 uppercase">
                    {group.label}
                  </p>
                  <ul>
                    {group.items.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                            n.read ? '' : 'bg-brand-50/40'
                          }`}
                        >
                          <span
                            aria-hidden
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              n.read ? 'bg-transparent' : 'bg-brand-600'
                            }`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-medium text-slate-900">{n.title}</span>
                              <span className="shrink-0 text-[0.7rem] text-slate-400">
                                {relativeTime(n.createdAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-500">{n.body}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
