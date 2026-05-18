'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { EditLinkedBookingModal } from './LinkedCalendarView';
import type { LinkedBooking, LinkedVenueCalendar } from '@/lib/linked-accounts/calendar';

/**
 * Linked-in bookings for the dashboard bookings list (§8.2). Fetches every
 * venue linked to the caller's venue over the active date range and renders
 * their bookings flat, each tagged with its source venue. Bookings the viewer
 * cannot edit (time_only links, or act = none) show a lock affordance.
 *
 * Renders nothing when the venue has no linked calendars, so venues without
 * linked accounts see no change to the bookings page.
 */

interface FlatLinkedBooking extends LinkedBooking {
  venueId: string;
  venueName: string;
  visibility: LinkedVenueCalendar['visibility'];
  action: LinkedVenueCalendar['action'];
}

function fmtTime(t: string): string {
  return (t ?? '').slice(0, 5);
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'Cancelled' || status === 'No-Show') return 'danger';
  if (status === 'Confirmed' || status === 'Completed' || status === 'Seated') return 'success';
  if (status === 'Pending' || status === 'Booked') return 'warning';
  return 'neutral';
}

function formatDayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
  return `${weekdays[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

export function LinkedBookingsPanel({
  from,
  to,
  onAvailabilityChange,
}: {
  from: string;
  to: string;
  /** Reports whether the venue has any linked calendars (for owning-page chrome). */
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [venues, setVenues] = useState<LinkedVenueCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FlatLinkedBooking | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/linked-calendar?from=${from}&to=${to}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load linked-in bookings.');
      const loaded = (json.venues ?? []) as LinkedVenueCalendar[];
      setVenues(loaded);
      onAvailabilityChange?.(loaded.length > 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load linked-in bookings.');
    } finally {
      setLoading(false);
    }
  }, [from, to, onAvailabilityChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const flat: FlatLinkedBooking[] = [];
    for (const v of venues) {
      for (const b of v.bookings) {
        flat.push({
          ...b,
          venueId: v.venueId,
          venueName: v.venueName,
          visibility: v.visibility,
          action: v.action,
        });
      }
    }
    flat.sort((a, b) => {
      const d = a.bookingDate.localeCompare(b.bookingDate);
      return d !== 0 ? d : a.bookingTime.localeCompare(b.bookingTime);
    });
    return flat;
  }, [venues]);

  // No linked calendars at all — render nothing so unlinked venues are untouched.
  if (!loading && venues.length === 0 && !error) return null;

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5"
      aria-label="Linked-in bookings"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/90 bg-slate-50 px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Linked-in bookings</h3>
          <Pill variant="neutral" size="sm">
            From linked venues
          </Pill>
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-500 sm:text-xs">
          {rows.length} {rows.length === 1 ? 'booking' : 'bookings'}
        </span>
      </div>

      {error ? (
        <p className="px-4 py-3 text-sm text-rose-700">{error}</p>
      ) : loading ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Loading linked-in bookings…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">
          No bookings in linked venues for this date range.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {rows.map((b) => {
            const timeOnly = b.visibility === 'time_only';
            const canEdit = b.editable && !timeOnly && b.status !== 'Cancelled';
            const timeLabel = b.bookingEndTime
              ? `${fmtTime(b.bookingTime)}–${fmtTime(b.bookingEndTime)}`
              : fmtTime(b.bookingTime);
            const detail = timeOnly
              ? `${b.venueName} — busy`
              : b.guestName ?? b.serviceName ?? 'Booking';
            return (
              <li
                key={b.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
              >
                <div className="flex min-w-0 items-center gap-2 text-xs sm:text-sm">
                  <span className="shrink-0 font-medium text-slate-500">
                    {formatDayLabel(b.bookingDate)}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-slate-800">
                    {timeLabel}
                  </span>
                  <span className="truncate text-slate-700">{detail}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Pill variant="neutral" size="sm">
                    Source: {b.venueName}
                  </Pill>
                  <Pill variant={statusVariant(b.status)} size="sm">
                    {b.status}
                  </Pill>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditing(b)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                  ) : (
                    <span
                      title="You cannot edit this booking"
                      aria-label="Read-only"
                      className="text-slate-400"
                    >
                      🔒
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <EditLinkedBookingModal
          venueName={editing.venueName}
          booking={editing}
          canCancel={editing.action === 'create_edit_cancel'}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}
