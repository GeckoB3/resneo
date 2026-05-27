'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Pill } from '@/components/ui/dashboard/Pill';
import { WAITLIST_ALERTS_REFRESH_EVENT } from '@/lib/booking/waitlist-alerts-events';
import { WAITLIST_ALERTS_POLL_MS } from '@/lib/realtime/dashboard-sync-constants';

interface WaitlistAlert {
  id: string;
  slot_date: string;
  slot_time_hm: string;
  service_name: string | null;
  calendar_name: string | null;
  matching_waitlist_count: number;
}

function formatAlertDate(dateIso: string): string {
  return new Date(`${dateIso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function alertMessage(alert: WaitlistAlert): string {
  const dateLabel = formatAlertDate(alert.slot_date);
  const timeLabel = alert.slot_time_hm;
  const service = alert.service_name ?? 'an appointment';
  const calendar = alert.calendar_name ? ` on ${alert.calendar_name}` : '';
  const guestCount = alert.matching_waitlist_count;
  const guestNote =
    guestCount === 1
      ? '1 guest on the waitlist matches.'
      : `${guestCount} guests on the waitlist match.`;

  return `Availability opened for ${service}${calendar} on ${dateLabel} at ${timeLabel}. ${guestNote}`;
}

/**
 * Dashboard banner for staff_choose waitlist mode when appointment slots open.
 */
export function WaitlistAvailabilityBanner() {
  const [alerts, setAlerts] = useState<WaitlistAlert[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/waitlist/alerts', { credentials: 'same-origin' });
      const data = (await res.json()) as { alerts?: WaitlistAlert[] };
      if (!res.ok) return;
      setAlerts(data.alerts ?? []);
    } catch {
      /* non-blocking */
    }
  }, []);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    refreshIfVisible();
    const interval = window.setInterval(refreshIfVisible, WAITLIST_ALERTS_POLL_MS);
    const onVisibility = () => refreshIfVisible();
    const onWaitlistRefresh = () => refreshIfVisible();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener(WAITLIST_ALERTS_REFRESH_EVENT, onWaitlistRefresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(WAITLIST_ALERTS_REFRESH_EVENT, onWaitlistRefresh);
    };
  }, [refresh]);

  async function runAction(alertId: string, action: 'offer' | 'dismiss') {
    setActingId(alertId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/venue/waitlist/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: alertId, action }),
      });
      const data = (await res.json()) as {
        error?: string;
        guest_name?: string;
        email_sent?: boolean;
        sms_sent?: boolean;
      };
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Action failed');
        return;
      }
      if (action === 'offer') {
        const guest = data.guest_name ?? 'the guest';
        const notified =
          data.email_sent || data.sms_sent
            ? ' They have been notified.'
            : ' Offer recorded — check contact details if notification failed.';
        setMessage(`Offer sent to ${guest}.${notified}`);
      }
      await refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setActingId(null);
    }
  }

  if (alerts.length === 0) return null;

  const primary = alerts[0];

  return (
    <div className="border-b border-brand-200/90 bg-gradient-to-r from-brand-50 via-white to-brand-50/40 px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Pill variant="brand" size="sm" className="mb-2 w-fit">
              Waitlist
            </Pill>
            <p className="text-sm font-medium text-slate-900">{alertMessage(primary)}</p>
            {alerts.length > 1 ? (
              <p className="mt-1 text-xs text-slate-500">
                +{alerts.length - 1} more open {alerts.length - 1 === 1 ? 'slot' : 'slots'} on the waitlist
              </p>
            ) : null}
            {message ? <p className="mt-2 text-xs text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href="/dashboard/waitlist?kind=appointment"
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 shadow-sm hover:bg-brand-50"
            >
              View waitlist
            </Link>
            <button
              type="button"
              disabled={actingId === primary.id}
              onClick={() => void runAction(primary.id, 'offer')}
              className="inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {actingId === primary.id ? 'Offering…' : 'Offer appointment'}
            </button>
            <button
              type="button"
              disabled={actingId === primary.id}
              onClick={() => void runAction(primary.id, 'dismiss')}
              className="inline-flex min-h-10 items-center justify-center rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
