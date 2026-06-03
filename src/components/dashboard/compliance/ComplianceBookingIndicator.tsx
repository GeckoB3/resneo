'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import type { BookingComplianceFlag } from '@/lib/compliance/booking-flags';

export type { BookingComplianceFlag };

/**
 * Per-booking compliance indicators for the calendar bars and the bookings list
 * (improvement plan — "staff see at a glance which appointments have outstanding
 * compliance"). One shared fetch hook + two presentational variants.
 */

/** Fired after a compliance record is captured/voided so live indicators re-resolve. */
export const COMPLIANCE_CHANGED_EVENT = 'reserveni:compliance-changed';

export function notifyComplianceChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(COMPLIANCE_CHANGED_EVENT));
}

/** Fetch compliance flags for a set of booking ids. Returns a map keyed by id. */
export function useComplianceBookingFlags(
  bookingIds: string[],
  enabled: boolean,
): Record<string, BookingComplianceFlag> {
  const [flags, setFlags] = useState<Record<string, BookingComplianceFlag>>({});
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Stable key so the effect only re-runs when the actual id set changes.
  const key = useMemo(
    () => (enabled ? [...new Set(bookingIds.filter(Boolean))].sort().join(',') : ''),
    [bookingIds, enabled],
  );

  // Re-resolve when a record is captured/voided anywhere in the app.
  useEffect(() => {
    const handler = () => setRefreshNonce((n) => n + 1);
    window.addEventListener(COMPLIANCE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(COMPLIANCE_CHANGED_EVENT, handler);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const ids = key ? key.split(',') : [];
      if (ids.length === 0) {
        if (!cancelled) setFlags({});
        return;
      }
      try {
        const res = await fetch('/api/venue/compliance/booking-flags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ booking_ids: ids }),
          signal: controller.signal,
        });
        if (!res.ok) {
          if (!cancelled) setFlags({});
          return;
        }
        const data = (await res.json()) as { flags?: Record<string, BookingComplianceFlag> };
        if (!cancelled) setFlags(data.flags ?? {});
      } catch {
        if (!cancelled) setFlags({});
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, refreshNonce]);

  return flags;
}

function tone(flag: BookingComplianceFlag): { ring: string; bg: string; fg: string } {
  if (flag.state === 'satisfied') return { ring: 'ring-emerald-300', bg: 'bg-emerald-500', fg: 'text-white' };
  if (flag.blocking) return { ring: 'ring-rose-300', bg: 'bg-rose-500', fg: 'text-white' };
  return { ring: 'ring-amber-300', bg: 'bg-amber-500', fg: 'text-white' };
}

export function complianceFlagTooltip(flag: BookingComplianceFlag): string {
  const list = flag.labels.join(', ');
  if (flag.state === 'satisfied') {
    return `Compliance complete${list ? `: ${list}` : ''}`;
  }
  if (flag.blocking) {
    return `${list || 'A compliance record'} required before this appointment`;
  }
  return `${list || 'A compliance form'} still outstanding`;
}

const ShieldCheck = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-2.5 w-2.5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12.5 2.5 2.5 4.5-5" />
  </svg>
);
const Bang = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className="h-2.5 w-2.5" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v5m0 3.5h.01" />
  </svg>
);

/**
 * Compact icon for a calendar booking bar — sits next to the guest name. A single
 * coloured chip: emerald check (satisfied), amber/rose "!" (outstanding/blocking).
 */
export function ComplianceBarIcon({ flag }: { flag: BookingComplianceFlag }) {
  const t = tone(flag);
  return (
    <span
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-white/80 ${t.bg} ${t.fg}`}
      title={complianceFlagTooltip(flag)}
      aria-label={complianceFlagTooltip(flag)}
      role="img"
    >
      {flag.state === 'satisfied' ? ShieldCheck : Bang}
    </span>
  );
}

/** Pill for the bookings-list row. */
export function ComplianceRowPill({ flag }: { flag: BookingComplianceFlag }) {
  if (flag.state === 'satisfied') {
    return (
      <Pill variant="compliance-current" size="sm" dot>
        <span title={complianceFlagTooltip(flag)}>Compliant</span>
      </Pill>
    );
  }
  const label =
    flag.labels.length === 1 ? `${flag.labels[0]} due` : `${flag.labels.length} forms due`;
  return (
    <Pill variant={flag.blocking ? 'compliance-expired' : 'compliance-expiring'} size="sm" dot>
      <span title={complianceFlagTooltip(flag)}>{label}</span>
    </Pill>
  );
}
