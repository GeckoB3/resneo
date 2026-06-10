'use client';

import { useState } from 'react';
import type { ActiveAnnouncement } from '@/lib/platform/announcements';

const SEVERITY_STYLES: Record<
  ActiveAnnouncement['severity'],
  { wrap: string; pill: string; pillLabel: string; text: string }
> = {
  info: {
    wrap: 'border-blue-200/80 bg-gradient-to-r from-blue-50 via-white to-blue-50/30',
    pill: 'bg-blue-100 text-blue-800',
    pillLabel: 'Announcement',
    text: 'text-slate-800',
  },
  warning: {
    wrap: 'border-amber-200/80 bg-gradient-to-r from-amber-50 via-white to-amber-50/30',
    pill: 'bg-amber-100 text-amber-800',
    pillLabel: 'Important',
    text: 'text-amber-950',
  },
  critical: {
    wrap: 'border-rose-200/80 bg-gradient-to-r from-rose-50 via-white to-rose-50/30',
    pill: 'bg-rose-100 text-rose-800',
    pillLabel: 'Critical',
    text: 'text-rose-950',
  },
};

export function PlatformAnnouncementBanners({
  announcements,
}: {
  announcements: ActiveAnnouncement[];
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  async function dismiss(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await fetch('/api/announcements/dismiss', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement_id: id }),
      });
    } catch (e) {
      // Banner is already hidden locally; the dismissal will retry on next page load.
      console.error('Failed to persist announcement dismissal:', e);
    }
  }

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((a) => {
        const s = SEVERITY_STYLES[a.severity];
        return (
          <div key={a.id} className={`border-b px-4 py-3 sm:px-6 ${s.wrap}`}>
            <div className="mx-auto flex max-w-[1400px] items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
                <span
                  className={`inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.pill}`}
                >
                  {s.pillLabel}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${s.text}`}>{a.title}</p>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{a.body}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void dismiss(a.id)}
                aria-label="Dismiss announcement"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/70 hover:text-slate-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}
