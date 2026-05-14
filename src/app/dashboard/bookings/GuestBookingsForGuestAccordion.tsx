'use client';

import { useEffect, useMemo, useState } from 'react';
import { calendarDateInTimeZone } from '@/lib/guests/guest-contacts-list';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionSummaryClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { readResponseJson } from '@/lib/http/read-response-json';

/** Max depth of BookingDetailPanel opened from nested “Detail” (guest history), including the root panel. */
export const BOOKING_DETAIL_MAX_STACK_DEPTH = 8;

export interface GuestBookingHistoryRow {
  id: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  status: string;
  estimated_end_time: string | null;
  booking_item_name: string | null;
  booking_model?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  service_id?: string | null;
}

export interface GuestHistoryRelatedBookingPayload {
  bookingId: string;
  snapshot: BookingDetailPanelSnapshot;
  row: GuestBookingHistoryRow;
}

function formatDateNice(value: string): string {
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** HH:mm from DB ISO timestamp; null if missing or unparseable (avoids Invalid Date / RangeError on toISOString). */
function estimatedEndToHHMM(iso: string | null | undefined): string | null {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(11, 16);
  }
  const afterT = iso.includes('T') ? iso.split('T')[1] : null;
  const hm = (afterT ?? iso).slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hm)) return hm;
  return null;
}

function wallClockHHMMInVenue(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hh = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const mm = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hh}:${mm}`;
}

function isBookingUpcomingInVenue(
  bookingDate: string,
  bookingTimeHm: string,
  now: Date,
  venueTimeZone: string,
): boolean {
  const today = calendarDateInTimeZone(now, venueTimeZone);
  if (bookingDate > today) return true;
  if (bookingDate < today) return false;
  const nowHm = wallClockHHMMInVenue(now, venueTimeZone);
  return bookingTimeHm >= nowHm;
}

export function rowToBookingDetailSnapshot(row: GuestBookingHistoryRow, guestDisplayName: string): BookingDetailPanelSnapshot {
  const st = row.booking_time.slice(0, 5);
  const parsedEnd = estimatedEndToHHMM(row.estimated_end_time);
  const endTime = parsedEnd ?? st;
  const serviceLabel =
    typeof row.booking_item_name === 'string' && row.booking_item_name.trim() !== ''
      ? row.booking_item_name.trim()
      : null;
  return {
    bookingDate: row.booking_date,
    guestName: guestDisplayName,
    partySize: row.party_size,
    status: row.status,
    startTime: st,
    endTime,
    serviceName: serviceLabel,
  };
}

export function GuestBookingsForGuestAccordion({
  guestId,
  currentBookingId,
  guestDisplayNameForSnapshots,
  venueTimeZone,
  canOpenNested,
  onOpenBookingDetail,
  listRefreshKey,
}: {
  guestId: string | null | undefined;
  currentBookingId: string;
  /** Used when opening a related booking (placeholder snapshot). */
  guestDisplayNameForSnapshots: string;
  venueTimeZone: string;
  canOpenNested: boolean;
  onOpenBookingDetail: (payload: GuestHistoryRelatedBookingPayload) => void;
  /** Bumped when this panel reloads booking detail so the list stays in sync after edits. */
  listRefreshKey: number;
}) {
  const [rows, setRows] = useState<GuestBookingHistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!guestId) {
      setRows(null);
      setFetchError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    void (async () => {
      try {
        const qs = new URLSearchParams({
          guest: guestId,
          guest_history: '1',
        });
        const res = await fetch(`/api/venue/bookings/list?${qs.toString()}`);
        const payload = await readResponseJson<{ error?: string; bookings?: GuestBookingHistoryRow[] }>(res);
        if (!res.ok) {
          if (!cancelled) {
            setFetchError(typeof payload.error === 'string' ? payload.error : 'Could not load bookings');
            setRows([]);
          }
          return;
        }
        const list = (payload.bookings ?? []).filter((b) => b && typeof b.id === 'string');
        if (!cancelled) {
          setRows(list);
          setFetchError(null);
        }
      } catch {
        if (!cancelled) {
          setFetchError('Could not load bookings');
          setRows([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [guestId, listRefreshKey]);

  const { upcomingRows, previousRows } = useMemo(() => {
    if (!rows?.length) {
      return { upcomingRows: [] as GuestBookingHistoryRow[], previousRows: [] as GuestBookingHistoryRow[] };
    }
    const others = rows.filter((r) => r.id !== currentBookingId);
    const now = new Date();
    const upcoming = others.filter((r) => {
      const hm = typeof r.booking_time === 'string' ? r.booking_time.slice(0, 5) : '00:00';
      return isBookingUpcomingInVenue(r.booking_date, hm, now, venueTimeZone);
    });
    const previous = others.filter((r) => {
      const hm = typeof r.booking_time === 'string' ? r.booking_time.slice(0, 5) : '00:00';
      return !isBookingUpcomingInVenue(r.booking_date, hm, now, venueTimeZone);
    });
    upcoming.sort((a, b) => {
      const dc = a.booking_date.localeCompare(b.booking_date);
      if (dc !== 0) return dc;
      return a.booking_time.localeCompare(b.booking_time);
    });
    previous.sort((a, b) => {
      const dc = b.booking_date.localeCompare(a.booking_date);
      if (dc !== 0) return dc;
      return b.booking_time.localeCompare(a.booking_time);
    });
    return { upcomingRows: upcoming, previousRows: previous };
  }, [rows, currentBookingId, venueTimeZone]);

  if (!guestId) return null;

  const summaryHint = (() => {
    if (loading && !rows?.length) return 'Loading bookings…';
    if (fetchError) return 'Could not load';
    if (!rows) return 'Other visits for this guest';
    return `${upcomingRows.length} upcoming · ${previousRows.length} previous`;
  })();

  const rowListItemClass =
    'flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-900/[0.03]';

  return (
    <details className={bookingExpandAccordionDetailsClass}>
      <summary className={bookingExpandAccordionSummaryClass}>
        <span>Guest bookings</span>
        <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{summaryHint}</span>
        <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </summary>
      <div className={`${bookingExpandAccordionBodyClass} space-y-3`}>
        {loading && !rows?.length ? (
          <p className="text-[11px] text-slate-500">Loading…</p>
        ) : fetchError ? (
          <p className="text-[11px] font-medium text-red-700">{fetchError}</p>
        ) : (
          <>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Upcoming</p>
              {upcomingRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">None</p>
              ) : (
                <ul className="grid gap-2">
                  {upcomingRows.map((r) => (
                    <li key={r.id} className={rowListItemClass}>
                      <span className="min-w-0 flex-1 truncate tabular-nums text-slate-800">
                        {formatDateNice(r.booking_date)} · {r.booking_time.slice(0, 5)} ·{' '}
                        {r.booking_item_name?.trim() ? r.booking_item_name.trim() : '—'}
                      </span>
                      <button
                        type="button"
                        disabled={!canOpenNested}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenBookingDetail({
                            bookingId: r.id,
                            snapshot: rowToBookingDetailSnapshot(r, guestDisplayNameForSnapshots),
                            row: r,
                          });
                        }}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/[0.03] hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                      >
                        Detail
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Previous</p>
              {previousRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">None</p>
              ) : (
                <ul className="grid gap-2">
                  {previousRows.map((r) => (
                    <li key={r.id} className={rowListItemClass}>
                      <span className="min-w-0 flex-1 truncate tabular-nums text-slate-800">
                        {formatDateNice(r.booking_date)} · {r.booking_time.slice(0, 5)} ·{' '}
                        {r.booking_item_name?.trim() ? r.booking_item_name.trim() : '—'}
                      </span>
                      <button
                        type="button"
                        disabled={!canOpenNested}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onOpenBookingDetail({
                            bookingId: r.id,
                            snapshot: rowToBookingDetailSnapshot(r, guestDisplayNameForSnapshots),
                            row: r,
                          });
                        }}
                        className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-900/[0.03] hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40"
                      >
                        Detail
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </details>
  );
}
