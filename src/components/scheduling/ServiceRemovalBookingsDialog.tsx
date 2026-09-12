'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import {
  affectedBookingDateLabel,
  type ServiceRemovalAffectedBooking,
  type ServiceRemovalConfirmation,
  type ServiceRemovalMove,
  type ServiceRemovalMoveFailure,
} from '@/lib/venue/service-removal-bookings';

export interface ServiceRemovalCalendarOption {
  id: string;
  name: string;
}

export interface ServiceRemovalBookingsDialogProps {
  open: boolean;
  confirmation: ServiceRemovalConfirmation | null;
  /**
   * Candidate destinations: ACTIVE calendars only. `/api/venue/bookings/[id]` refuses a move
   * onto a paused calendar ("Staff not available"), so offering one is offering a dead end.
   */
  calendars: ServiceRemovalCalendarOption[];
  /**
   * Does `calendarId` currently offer `serviceId`? This filters the destinations rather than
   * just labelling them: the same route refuses a move onto a calendar that does not offer
   * the service ("Service not available with this staff member").
   */
  calendarOffersService: (calendarId: string, serviceId: string) => boolean;
  saving: boolean;
  /** Bookings that could not be moved on the last attempt, with the reason given. */
  failures: ServiceRemovalMoveFailure[];
  /** Anything that went wrong saving the removal itself. */
  error: string | null;
  onCancel: () => void;
  onConfirm: (moves: ServiceRemovalMove[]) => void;
}

interface BookingGroup {
  key: string;
  serviceId: string;
  serviceName: string;
  calendarId: string;
  calendarName: string;
  bookings: ServiceRemovalAffectedBooking[];
}

function groupBookings(bookings: ServiceRemovalAffectedBooking[]): BookingGroup[] {
  const groups = new Map<string, BookingGroup>();
  for (const booking of bookings) {
    const key = `${booking.calendar_id}::${booking.service_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.bookings.push(booking);
      continue;
    }
    groups.set(key, {
      key,
      serviceId: booking.service_id,
      serviceName: booking.service_name,
      calendarId: booking.calendar_id,
      calendarName: booking.calendar_name,
      bookings: [booking],
    });
  }
  return [...groups.values()];
}

/**
 * Shown when a save would take a service off a calendar that still has upcoming bookings
 * for it. The save is never refused: this lists what is already booked and lets the
 * operator move each group to another calendar or leave it exactly where it is.
 */
export function ServiceRemovalBookingsDialog({
  open,
  confirmation,
  calendars,
  calendarOffersService,
  saving,
  failures,
  error,
  onCancel,
  onConfirm,
}: ServiceRemovalBookingsDialogProps) {
  const groups = useMemo(
    () => (confirmation ? groupBookings(confirmation.bookings) : []),
    [confirmation],
  );
  /**
   * Identity of the current list. When the parent drops bookings it has already moved,
   * the key changes and every choice resets, which beats resetting from an effect.
   */
  const listKey = useMemo(() => groups.map((g) => `${g.key}:${g.bookings.length}`).join('|'), [groups]);
  const [draft, setDraft] = useState<{ key: string; map: Record<string, string> }>({ key: '', map: {} });
  const targets = draft.key === listKey ? draft.map : {};

  function setTarget(groupKey: string, calendarId: string) {
    setDraft({ key: listKey, map: { ...targets, [groupKey]: calendarId } });
  }

  const moves: ServiceRemovalMove[] = groups.flatMap((group) => {
    const target = targets[group.key];
    if (!target) return [];
    return group.bookings.map((booking) => ({ bookingId: booking.id, targetCalendarId: target }));
  });

  const failureById = new Map(failures.map((f) => [f.bookingId, f]));
  const moveCount = moves.length;
  const primaryLabel =
    moveCount > 0
      ? `Move ${moveCount} booking${moveCount === 1 ? '' : 's'} and save`
      : 'Save and leave these bookings here';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
      title="These bookings are already in the diary"
      size="lg"
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onConfirm(moves)} loading={saving} disabled={saving}>
            {saving ? 'Saving...' : primaryLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{confirmation?.message}</p>
        <p className="text-sm text-slate-600">
          Nothing is cancelled or moved unless you choose to move it. Saving stops the calendar
          offering the service for new bookings from now on.
        </p>

        {error ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {failures.length > 0 ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p className="font-medium">
              {failures.length === 1 ? 'One booking could not be moved' : `${failures.length} bookings could not be moved`}
            </p>
            <ul className="mt-2 space-y-1">
              {failures.map((failure) => (
                <li key={failure.bookingId}>
                  {failure.label}: {failure.reason}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Pick a different calendar for them, or leave them where they are and save.
            </p>
          </div>
        ) : null}

        {confirmation?.truncated ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Showing the first {confirmation.bookings.length} of {confirmation.total} bookings. Only the
            ones listed here can be moved from this screen.
          </p>
        ) : null}

        {groups.map((group) => {
          const others = calendars.filter(
            (c) => c.id !== group.calendarId && calendarOffersService(c.id, group.serviceId),
          );
          const selectId = `service-removal-target-${group.key}`;
          return (
            <div key={group.key} className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-medium text-slate-900">
                  {group.serviceName} on {group.calendarName}
                </p>
                <p className="text-xs text-slate-600">
                  {group.bookings.length} upcoming booking{group.bookings.length === 1 ? '' : 's'}
                </p>
              </div>
              <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto">
                {group.bookings.map((booking) => {
                  const failure = failureById.get(booking.id);
                  return (
                    <li
                      key={booking.id}
                      className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2 text-sm ${
                        failure ? 'bg-red-50' : ''
                      }`}
                    >
                      <span className="font-medium text-slate-800">
                        {affectedBookingDateLabel(booking.booking_date)}, {booking.booking_time}
                        {booking.end_time ? ` to ${booking.end_time}` : ''}
                      </span>
                      <span className="text-slate-600">
                        {booking.guest_name}
                        {booking.party_size > 1 ? ` (${booking.party_size} people)` : ''}
                        <span className="ml-2 text-xs text-slate-500">{booking.status}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="border-t border-slate-200 px-4 py-3">
                <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-slate-700">
                  What should happen to these bookings?
                </label>
                <select
                  id={selectId}
                  value={targets[group.key] ?? ''}
                  onChange={(e) => setTarget(group.key, e.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Leave them on {group.calendarName}</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>
                      Move to {c.name}
                    </option>
                  ))}
                </select>
                {others.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">
                    No other calendar offers {group.serviceName}, so there is nowhere to move these
                    bookings to. Add the service to another calendar first if you want to move them.
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
