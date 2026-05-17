'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import type { LinkedBooking, LinkedVenueCalendar } from '@/lib/linked-accounts/calendar';

const BOOKING_STATUSES = [
  'Pending',
  'Booked',
  'Confirmed',
  'Seated',
  'Completed',
  'No-Show',
  'Cancelled',
] as const;

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

export function LinkedCalendarView() {
  const [date, setDate] = useState(todayIso());
  const [venues, setVenues] = useState<LinkedVenueCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ venue: LinkedVenueCalendar; booking: LinkedBooking } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/linked-calendar?date=${date}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to load linked calendars.');
      setVenues(json.venues ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load linked calendars.');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVenue = (venueId: string) => {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(venueId)) next.delete(venueId);
      else next.add(venueId);
      return next;
    });
  };

  const visibleVenues = useMemo(
    () => venues.filter((v) => !hidden.has(v.venueId)),
    [venues, hidden],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <span className="font-medium">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <button
          type="button"
          className={btnSecondary}
          onClick={() => setDate(todayIso())}
        >
          Today
        </button>
      </div>

      {/* Legend ------------------------------------------------------- */}
      {venues.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {venues.map((v) => (
            <button
              key={v.venueId}
              type="button"
              onClick={() => toggleVenue(v.venueId)}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition ${
                hidden.has(v.venueId)
                  ? 'border-slate-200 bg-slate-50 text-slate-400'
                  : 'border-brand-200 bg-brand-50 text-brand-800'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  hidden.has(v.venueId) ? 'bg-slate-300' : 'bg-brand-500'
                }`}
              />
              {v.venueName}
              <span className="text-[10px] uppercase tracking-wide text-slate-400">
                {v.visibility === 'time_only' ? 'time only' : 'full'}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500">Loading linked calendars…</p>
      ) : venues.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No linked venues share calendar visibility with you yet. Set up a link under Settings →
          Linked Accounts.
        </p>
      ) : visibleVenues.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">
          All linked calendars are hidden. Use the legend above to show them.
        </p>
      ) : (
        <div className="space-y-5">
          {visibleVenues.map((venue) => (
            <VenueCalendarBlock
              key={venue.venueId}
              venue={venue}
              onEdit={(booking) => setEditing({ venue, booking })}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EditLinkedBookingModal
          venueName={editing.venue.venueName}
          booking={editing.booking}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function VenueCalendarBlock({
  venue,
  onEdit,
}: {
  venue: LinkedVenueCalendar;
  onEdit: (booking: LinkedBooking) => void;
}) {
  const timeOnly = venue.visibility === 'time_only';
  const byPractitioner = new Map<string, LinkedBooking[]>();
  for (const b of venue.bookings) {
    const key = b.practitionerId ?? 'unassigned';
    const list = byPractitioner.get(key) ?? [];
    list.push(b);
    byPractitioner.set(key, list);
  }
  for (const list of byPractitioner.values()) {
    list.sort((a, b) => a.bookingTime.localeCompare(b.bookingTime));
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900">{venue.venueName}</h3>
        <Pill variant="neutral" size="sm">
          Linked
        </Pill>
        {timeOnly ? (
          <Pill variant="neutral" size="sm">
            Time blocks only
          </Pill>
        ) : null}
      </div>

      {venue.practitioners.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">This venue has no calendars.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {venue.practitioners.map((p) => {
            const bookings = byPractitioner.get(p.id) ?? [];
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-700">
                  {p.name}
                  {!p.isActive ? (
                    <span className="ml-1 font-normal text-slate-400">(inactive)</span>
                  ) : null}
                </p>
                {bookings.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">No bookings</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {bookings.map((b) => (
                      <li key={b.id}>
                        <LinkedBookingChip
                          booking={b}
                          timeOnly={timeOnly}
                          venueName={venue.venueName}
                          onEdit={() => onEdit(b)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkedBookingChip({
  booking,
  timeOnly,
  venueName,
  onEdit,
}: {
  booking: LinkedBooking;
  timeOnly: boolean;
  venueName: string;
  onEdit: () => void;
}) {
  const canEdit = booking.editable && !timeOnly && booking.status !== 'Cancelled';
  const timeLabel = booking.bookingEndTime
    ? `${fmtTime(booking.bookingTime)}–${fmtTime(booking.bookingEndTime)}`
    : fmtTime(booking.bookingTime);

  const body = (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs ${
        timeOnly
          ? 'border-slate-200 bg-slate-100/80 text-slate-500'
          : 'border-slate-200 bg-white text-slate-700'
      }`}
    >
      <div className="min-w-0">
        <span className="font-medium text-slate-800">{timeLabel}</span>
        {timeOnly ? (
          <span className="ml-1 text-slate-500">— {venueName} busy</span>
        ) : (
          <span className="ml-1 truncate">
            {booking.guestName ?? booking.serviceName ?? 'Booking'}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Pill variant={statusVariant(booking.status)} size="sm">
          {booking.status}
        </Pill>
        {!canEdit ? (
          <span title="You cannot edit this booking" aria-label="Read-only" className="text-slate-400">
            🔒
          </span>
        ) : null}
      </div>
    </div>
  );

  if (!canEdit) return body;
  return (
    <button type="button" onClick={onEdit} className="block w-full text-left hover:opacity-80">
      {body}
    </button>
  );
}

function EditLinkedBookingModal({
  venueName,
  booking,
  onClose,
  onSaved,
}: {
  venueName: string;
  booking: LinkedBooking;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(booking.bookingDate);
  const [time, setTime] = useState(fmtTime(booking.bookingTime));
  const [status, setStatus] = useState(booking.status);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (overrideStatus?: string) => {
    setBusy(true);
    setError(null);
    try {
      const changes: Record<string, unknown> = {};
      if (date !== booking.bookingDate) changes.booking_date = date;
      if (time !== fmtTime(booking.bookingTime)) changes.booking_time = time;
      const finalStatus = overrideStatus ?? status;
      if (finalStatus !== booking.status) changes.status = finalStatus;
      if (notes.trim()) changes.special_requests = notes.trim();
      if (Object.keys(changes).length === 0) {
        setError('Make a change before saving.');
        setBusy(false);
        return;
      }
      const res = await fetch('/api/venue/linked-calendar/booking', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, changes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save changes.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Edit booking in ${venueName}`}
      description="Changes are recorded in the cross-venue audit log visible to both venues."
    >
      <div className="space-y-3">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Date</span>
          <input
            type="date"
            className={`mt-1 ${inputCls}`}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Time</span>
          <input
            type="time"
            className={`mt-1 ${inputCls}`}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Status</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Add a note (optional)</span>
          <textarea
            className={`mt-1 ${inputCls}`}
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <button
            type="button"
            className={btnDanger}
            disabled={busy || booking.status === 'Cancelled'}
            onClick={() => save('Cancelled')}
          >
            Cancel booking
          </button>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
              Close
            </button>
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => save()}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
