'use client';

import type { CSSProperties } from 'react';
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_REVERT_ACTIONS,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { bookingStatusVisualForKey } from '@/lib/table-management/booking-status-visual';

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
}

export interface BookingActionMenuBooking {
  id: string;
  guest_name: string;
  party_size: number;
  status: string;
  start_time: string;
  end_time: string | null;
  table_id: string | null;
  table_ids: string[];
}

export interface BookingActionMenuProps {
  booking: BookingActionMenuBooking;
  menuStyle: CSSProperties;
  onDismiss: () => void;
  /** Status row: parent runs validation, confirm dialogs, and API. */
  onStatusChange: (bookingId: string, currentStatus: string, nextStatus: string) => void | Promise<void>;
  onResizeBooking: (bookingId: string, newEndTimeHHmm: string) => void;
  onEditBooking: (bookingId: string) => void;
  onSendMessage: (bookingId: string) => void;
  onMoveBooking: (bookingId: string) => void;
  onRescheduleBooking: (bookingId: string) => void;
  onBlockAfterBooking: (tableId: string, endTimeHHmm: string) => void;
  onUnassign: (bookingId: string) => void;
}

/**
 * Floating booking actions (status, duration, table ops) shared by table-grid and floor-plan.
 */
export function BookingActionMenu({
  booking,
  menuStyle,
  onDismiss,
  onStatusChange,
  onResizeBooking,
  onEditBooking,
  onSendMessage,
  onMoveBooking,
  onRescheduleBooking,
  onBlockAfterBooking,
  onUnassign,
}: BookingActionMenuProps) {
  const statuses = (BOOKING_STATUS_TRANSITIONS[booking.status as BookingStatus] ?? BOOKING_STATUSES) as BookingStatus[];

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onDismiss} aria-hidden />
      <div
        className="fixed z-50 rounded-2xl border border-slate-200/80 bg-white py-1 shadow-xl shadow-slate-900/15 ring-1 ring-slate-100"
        style={menuStyle}
        role="menu"
        aria-label="Booking actions"
      >
        <div className="border-b border-slate-100 px-3 py-2">
          <p className="text-xs font-semibold text-slate-900">{booking.guest_name}</p>
          <p className="text-[10px] text-slate-500">
            Party of {booking.party_size} · {booking.start_time.slice(0, 5)}
            {booking.table_ids.length > 1 ? <span className="ml-1 text-purple-600">· Combination</span> : null}
          </p>
        </div>
        <div className="py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</p>
          {statuses.map((status) => {
            const revert = isRevertTransition(booking.status, status);
            const revertLabel = revert ? BOOKING_REVERT_ACTIONS[booking.status as BookingStatus]?.label : null;
            return (
              <button
                key={status}
                type="button"
                role="menuitem"
                onClick={() => {
                  void onStatusChange(booking.id, booking.status, status);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40 ${revert ? 'font-semibold text-amber-800' : 'text-slate-700'}`}
                disabled={booking.status === status}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${bookingStatusVisualForKey(status).dot}`} />
                {revertLabel ?? status}
              </button>
            );
          })}
        </div>
        <div className="border-t border-slate-100 py-1">
          <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Duration</p>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const currentEnd = booking.end_time
                ? timeToMinutes(booking.end_time.slice(0, 5))
                : timeToMinutes(booking.start_time.slice(0, 5)) + 90;
              onResizeBooking(booking.id, minutesToTime(currentEnd + 15));
              onDismiss();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Extend +15m
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const start = timeToMinutes(booking.start_time.slice(0, 5));
              const currentEnd = booking.end_time
                ? timeToMinutes(booking.end_time.slice(0, 5))
                : start + 90;
              const nextEnd = Math.max(start + 15, currentEnd - 15);
              onResizeBooking(booking.id, minutesToTime(nextEnd));
              onDismiss();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Shorten -15m
          </button>
        </div>
        {booking.table_id ? (
          <div className="border-t border-slate-100 py-1">
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Table</p>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onEditBooking(booking.id);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Edit Booking
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onSendMessage(booking.id);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Send Message to Guest
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onMoveBooking(booking.id);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Move to Table
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRescheduleBooking(booking.id);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Reschedule
            </button>
            {booking.status !== 'Cancelled' ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void onStatusChange(booking.id, booking.status, 'Cancelled');
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
              >
                Cancel Booking
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const endTime = booking.end_time ? booking.end_time.slice(0, 5) : booking.start_time.slice(0, 5);
                onBlockAfterBooking(booking.table_id!, endTime);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              Block Table After Booking
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onUnassign(booking.id);
                onDismiss();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Unassign from table
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
