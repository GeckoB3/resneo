'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Modal, btnDanger, btnPrimary, btnSecondary } from './linked-accounts-ui';
import type { LinkedBooking, LinkedVenueCalendar } from '@/lib/linked-accounts/calendar';
import { linkedBookingBarDetailLabel } from '@/lib/linked-accounts/calendar';

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

/**
 * Best-effort ping recording that a linked-venue booking's detail was opened
 * (§4.2 `viewed_booking`). The server debounces to a 5-minute window, so the
 * modals can fire this freely on every open. Failures are swallowed — an audit
 * ping must never disrupt the detail the user already opened.
 */
function pingLinkedBookingView(bookingId: string): void {
  void fetch('/api/venue/linked-calendar/booking/view', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId }),
  }).catch(() => {});
}

export function LinkedCalendarView({
  hideWhenEmpty = false,
  title,
  /** When set, the date picker is hidden and this date drives fetches (e.g. day-sheet sync). */
  date: controlledDate,
  onDateChange,
  hideDatePicker = false,
}: {
  hideWhenEmpty?: boolean;
  title?: string;
  date?: string;
  onDateChange?: (isoDate: string) => void;
  hideDatePicker?: boolean;
} = {}) {
  const [internalDate, setInternalDate] = useState(todayIso());
  const date = controlledDate ?? internalDate;
  const setDate = onDateChange ?? setInternalDate;
  const [venues, setVenues] = useState<LinkedVenueCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ venue: LinkedVenueCalendar; booking: LinkedBooking } | null>(
    null,
  );
  const [creating, setCreating] = useState<LinkedVenueCalendar | null>(null);

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

  // When embedded in a calendar page, stay invisible unless the venue actually
  // has linked calendars, so venues without linked accounts see no change.
  if (hideWhenEmpty && venues.length === 0 && !error) return null;

  return (
    <div className="space-y-4">
      {title ? (
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {!hideDatePicker && controlledDate === undefined ? (
          <>
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
          </>
        ) : controlledDate ? (
          <p className="text-xs text-slate-500">
            Linked calendars for{' '}
            <span className="font-semibold text-slate-700">{date}</span> (same date as this page).
          </p>
        ) : null}
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
              onCreate={() => setCreating(venue)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EditLinkedBookingModal
          venueName={editing.venue.venueName}
          booking={editing.booking}
          canCancel={editing.venue.action === 'create_edit_cancel'}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}

      {creating ? (
        <CreateLinkedBookingModal
          venue={creating}
          date={date}
          onClose={() => setCreating(null)}
          onSaved={async () => {
            setCreating(null);
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
  onCreate,
}: {
  venue: LinkedVenueCalendar;
  onEdit: (booking: LinkedBooking) => void;
  onCreate: () => void;
}) {
  const timeOnly = venue.visibility === 'time_only';
  const canCreate = venue.action === 'create_edit_cancel';
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
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900">{venue.venueName}</h3>
        <Pill variant="warning" size="sm">
          Linked
        </Pill>
        {timeOnly ? (
          <Pill variant="neutral" size="sm">
            Time blocks only
          </Pill>
        ) : null}
        {canCreate ? (
          <button
            type="button"
            onClick={onCreate}
            className="ml-auto rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100"
          >
            + New booking
          </button>
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
            {linkedBookingBarDetailLabel(booking, timeOnly ? 'time_only' : 'full_details', venueName)}
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

export function EditLinkedBookingModal({
  venueName,
  booking,
  canCancel,
  onClose,
  onSaved,
}: {
  venueName: string;
  booking: LinkedBooking;
  /** True only when the link grants `create_edit_cancel` (§5.3). */
  canCancel: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(booking.bookingDate);
  const [time, setTime] = useState(fmtTime(booking.bookingTime));
  const [status, setStatus] = useState(booking.status);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pingLinkedBookingView(booking.id);
  }, [booking.id]);

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
            {BOOKING_STATUSES.filter(
              (s) => canCancel || s !== 'Cancelled' || s === booking.status,
            ).map((s) => (
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
          {canCancel ? (
            <button
              type="button"
              className={btnDanger}
              disabled={busy || booking.status === 'Cancelled'}
              onClick={() => save('Cancelled')}
            >
              Cancel booking
            </button>
          ) : (
            <span />
          )}
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

/**
 * Read-only detail for a linked-venue booking the viewer cannot edit — a
 * `time_only` link, or a `full_details` link granting `act = none` (§4.3).
 * Carries no edit controls; it exists so a click on the calendar grid always
 * does something rather than silently nothing.
 */
export function LinkedBookingDetailModal({
  venueName,
  visibility,
  booking,
  onClose,
}: {
  venueName: string;
  visibility: LinkedVenueCalendar['visibility'];
  booking: LinkedBooking;
  onClose: () => void;
}) {
  const timeOnly = visibility === 'time_only';
  const timeLabel = booking.bookingEndTime
    ? `${fmtTime(booking.bookingTime)}–${fmtTime(booking.bookingEndTime)}`
    : fmtTime(booking.bookingTime);

  useEffect(() => {
    pingLinkedBookingView(booking.id);
  }, [booking.id]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Booking in ${venueName}`}
      description="Read-only — this link does not grant you permission to edit this booking."
    >
      <div className="space-y-3">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-slate-500">Date</dt>
            <dd className="text-slate-800">{booking.bookingDate}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="font-medium text-slate-500">Time</dt>
            <dd className="tabular-nums text-slate-800">{timeLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="font-medium text-slate-500">Status</dt>
            <dd>
              <Pill variant={statusVariant(booking.status)} size="sm">
                {booking.status}
              </Pill>
            </dd>
          </div>
          {!timeOnly ? (
            <>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-slate-500">Client</dt>
                <dd className="text-slate-800">{booking.guestName ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-medium text-slate-500">Service</dt>
                <dd className="text-slate-800">{booking.serviceName ?? '—'}</dd>
              </div>
            </>
          ) : null}
        </dl>
        {timeOnly ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            {venueName} shares time blocks only. Client and service detail are not visible on
            this link.
          </p>
        ) : null}
        <div className="flex justify-end">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface GuestOption {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Create a booking in a linked venue. Available only on links granting
 * `create_edit_cancel` (§5.3). The client is chosen from the linked venue's
 * own guests — no guest row is ever copied between venues.
 */
export function CreateLinkedBookingModal({
  venue,
  date,
  practitionerId: prefillPractitionerId,
  time: prefillTime,
  onClose,
  onSaved,
}: {
  venue: LinkedVenueCalendar;
  date: string;
  /** Pre-select this calendar — e.g. the linked column the user clicked. */
  practitionerId?: string;
  /** Pre-fill the start time — e.g. the empty slot the user clicked (§4.3). */
  time?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [practitionerId, setPractitionerId] = useState(
    (prefillPractitionerId &&
    venue.practitioners.some((p) => p.id === prefillPractitionerId)
      ? prefillPractitionerId
      : venue.practitioners.find((p) => p.isActive)?.id) ?? '',
  );
  const [serviceId, setServiceId] = useState('');
  const [bookingDate, setBookingDate] = useState(date);
  const [time, setTime] = useState(prefillTime ?? '09:00');
  const [endTime, setEndTime] = useState('');
  const [notes, setNotes] = useState('');
  const [guestQuery, setGuestQuery] = useState('');
  const [guestResults, setGuestResults] = useState<GuestOption[]>([]);
  const [guest, setGuest] = useState<GuestOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (guest) return;
    let cancelled = false;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/venue/linked-calendar/guests?venueId=${venue.venueId}&q=${encodeURIComponent(
            guestQuery,
          )}`,
        );
        const json = await res.json();
        if (!cancelled) setGuestResults(res.ok ? json.guests ?? [] : []);
      } catch {
        if (!cancelled) setGuestResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [guestQuery, guest, venue.venueId]);

  const save = async () => {
    if (!guest) {
      setError('Choose a client for the booking.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/linked-calendar/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerVenueId: venue.venueId,
          guestId: guest.id,
          practitionerId: practitionerId || null,
          appointmentServiceId: serviceId || null,
          bookingDate,
          bookingTime: time,
          bookingEndTime: endTime || undefined,
          specialRequests: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create the booking.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the booking.');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`New booking in ${venue.venueName}`}
      description="The booking is created in the linked venue and recorded in the cross-venue audit log visible to both venues."
    >
      <div className="space-y-3">
        <div>
          <span className="block text-sm font-medium text-slate-700">Client</span>
          {guest ? (
            <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <span>
                {guest.name}
                {guest.email ? (
                  <span className="ml-1 text-slate-400">{guest.email}</span>
                ) : null}
              </span>
              <button
                type="button"
                className="text-xs font-medium text-brand-700 hover:underline"
                onClick={() => {
                  setGuest(null);
                  setGuestQuery('');
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="search"
                className={`mt-1 ${inputCls}`}
                placeholder="Search the venue’s clients by name or email"
                value={guestQuery}
                onChange={(e) => setGuestQuery(e.target.value)}
              />
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-slate-200">
                {searching ? (
                  <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>
                ) : guestResults.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-400">No clients found.</p>
                ) : (
                  guestResults.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                      onClick={() => setGuest(g)}
                    >
                      {g.name}
                      {g.email ? (
                        <span className="ml-1 text-xs text-slate-400">{g.email}</span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Calendar</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={practitionerId}
            onChange={(e) => setPractitionerId(e.target.value)}
          >
            <option value="">Unassigned</option>
            {venue.practitioners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-slate-700">Service (optional)</span>
          <select
            className={`mt-1 ${inputCls}`}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">No service</option>
            {venue.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Date</span>
            <input
              type="date"
              className={`mt-1 ${inputCls}`}
              value={bookingDate}
              onChange={(e) => setBookingDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Start</span>
            <input
              type="time"
              className={`mt-1 ${inputCls}`}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-slate-700">End</span>
            <input
              type="time"
              className={`mt-1 ${inputCls}`}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </label>
        </div>
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
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} disabled={busy} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={save}>
            {busy ? 'Creating…' : 'Create booking'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
