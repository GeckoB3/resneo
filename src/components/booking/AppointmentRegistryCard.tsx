'use client';

import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { bookingStatusDisplayLabel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';

export interface RegistryAppointment {
  id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  guest_visit_count: number | null;
  guest_id?: string;
  practitioner_id: string | null;
  calendar_id?: string | null;
  appointment_service_id: string | null;
  service_item_id?: string | null;
  special_requests: string | null;
  internal_notes: string | null;
  client_arrived_at: string | null;
  /** Guest tapped "I'll be there" on the reminder link */
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  /** For inferring booking model (list API includes these when present). */
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  booking_model?: string | null;
  /** Server-resolved service / event / class / resource / dining-service name for the booking bar. */
  booking_item_name?: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  Pending: 'bg-orange-100 text-orange-950 ring-1 ring-orange-300',
  Booked: 'bg-sky-100 text-sky-950 ring-1 ring-sky-500',
  Confirmed: 'bg-indigo-100 text-indigo-950 ring-1 ring-indigo-500',
  Seated: 'bg-emerald-100 text-emerald-950 ring-1 ring-emerald-400',
  Completed: 'bg-slate-200 text-slate-800 ring-1 ring-slate-400',
  'No-Show': 'bg-red-100 text-red-950 ring-1 ring-red-400',
  Cancelled: 'bg-slate-200 text-slate-600 ring-1 ring-slate-400',
};

function rowTint(status: string, arrived: boolean): string {
  if (status === 'Cancelled') return 'bg-slate-200 border-slate-400';
  if (status === 'Completed') return 'bg-slate-200 border-slate-400';
  if (status === 'Seated') return 'bg-emerald-100 border-emerald-400';
  if (arrived && (status === 'Pending' || status === 'Booked' || status === 'Confirmed')) {
    return 'bg-amber-100 border-amber-400';
  }
  if (status === 'Pending') return 'bg-orange-100 border-orange-400';
  if (status === 'Booked') return 'bg-sky-100 border-sky-500';
  if (status === 'Confirmed') return 'bg-indigo-100 border-indigo-500';
  if (status === 'No-Show') return 'bg-red-100 border-red-400';
  return 'bg-white border-slate-300';
}

function sourceLabel(source: string): string {
  if (source === 'booking_page' || source === 'online') return 'Online';
  if (source === 'walk-in') return 'Walk-in';
  if (source === 'phone') return 'Phone';
  return source.replace(/_/g, ' ');
}

function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    online: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200/70',
    booking_page: 'bg-violet-50 text-violet-800 ring-1 ring-violet-200/70',
    phone: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200/70',
    'walk-in': 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/70',
  };
  return map[source] ?? 'bg-slate-50 text-slate-600 ring-1 ring-slate-200/70';
}

interface Props {
  booking: RegistryAppointment;
  expanded: boolean;
  onToggle: () => void;
  practitionerName: string | null;
  serviceName: string | null;
  servicePriceFormatted: string | null;
  endTimeLabel: string;
  sym: string;
}

export function AppointmentRegistryCard({
  booking,
  expanded,
  onToggle,
  practitionerName,
  serviceName,
  servicePriceFormatted,
  endTimeLabel,
  sym,
}: Props) {
  const arrived = Boolean(booking.client_arrived_at);
  const shortRef = booking.id.slice(0, 8).toUpperCase();
  const statusLabel = bookingStatusDisplayLabel(booking.status, isTableReservationBooking(booking));
  const panelId = `appointment-registry-panel-${booking.id}`;

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-sm transition-[background-color,border-color] duration-200 ${rowTint(booking.status, arrived)}`}
    >
      <button
        type="button"
        id={`appointment-registry-trigger-${booking.id}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-[3rem] w-full items-start gap-3 px-3 py-3 text-left sm:min-h-[3.25rem] sm:px-4 sm:py-3.5"
      >
        <span
          className={`mt-1 flex-shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{booking.guest_name}</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[booking.status] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/80'}`}
            >
              {statusLabel}
            </span>
            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(booking.source)}`}>
              {sourceLabel(booking.source)}
            </span>
            {arrived && booking.status !== 'Seated' && (
              <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-950 ring-1 ring-amber-300/60">
                Arrived
              </span>
            )}
            {showDepositPendingPill(booking) && (
              <span
                className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-950 ring-1 ring-orange-200/80"
                title="Deposit not yet paid"
              >
                Deposit pending
              </span>
            )}
            {showAttendanceConfirmedSupplementPill(booking) && (
              <span
                className="inline-flex rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-900 ring-1 ring-teal-200/80"
                title="Confirmed"
              >
                Confirmed
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-600">
            <span className="font-medium tabular-nums text-slate-800">
              {booking.booking_date} · {booking.booking_time.slice(0, 5)} – {endTimeLabel}
            </span>
            {practitionerName && <span className="text-slate-500">with {practitionerName}</span>}
            {serviceName && <span className="truncate text-slate-500">{serviceName}</span>}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">Ref {shortRef}</p>
        </div>
      </button>

      <div
        id={panelId}
        role="region"
        aria-labelledby={`appointment-registry-trigger-${booking.id}`}
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden" aria-hidden={!expanded}>
          <div className="border-t border-slate-200/70 bg-white/60 px-3 pb-4 pt-2 sm:px-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Booking reference</dt>
                <dd className="mt-0.5 break-all font-mono text-xs text-slate-800">{booking.id}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Client</dt>
                <dd className="mt-0.5 text-slate-900">{booking.guest_name}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
                <dd className="mt-0.5 text-slate-800">{statusLabel}</dd>
              </div>
              {booking.guest_attendance_confirmed_at && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Guest attendance confirmation</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {new Date(booking.guest_attendance_confirmed_at).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
              )}
              {booking.staff_attendance_confirmed_at && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Staff attendance confirmation</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {new Date(booking.staff_attendance_confirmed_at).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Email</dt>
                <dd className="mt-0.5 break-all text-slate-700">{booking.guest_email ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Phone</dt>
                <dd className="mt-0.5 text-slate-700">{booking.guest_phone ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Service</dt>
                <dd className="mt-0.5 text-slate-900">{serviceName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Service price</dt>
                <dd className="mt-0.5 text-slate-800">{servicePriceFormatted ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Staff member</dt>
                <dd className="mt-0.5 text-slate-900">{practitionerName ?? '-'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">How booked</dt>
                <dd className="mt-0.5 text-slate-800">{sourceLabel(booking.source)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Deposit</dt>
                <dd className="mt-0.5 text-slate-800">
                  {booking.deposit_status}
                  {booking.deposit_amount_pence != null && booking.deposit_amount_pence > 0
                    ? ` · ${sym}${(booking.deposit_amount_pence / 100).toFixed(2)}`
                    : ''}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Customer comments</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                  {booking.special_requests?.trim() || '-'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Staff notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-slate-700">
                  {booking.internal_notes?.trim() || '-'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
