'use client';

import { UnifiedBookingForm, type UnifiedBookingEditSnapshot } from '@/components/booking/UnifiedBookingForm';
import { staffSurfaceBookingWidthClass } from '@/components/booking/StaffSurfaceBookingStack';
import { getStaffBookingSurfaceTabs } from '@/lib/booking/staff-booking-modal-options';

export type { UnifiedBookingEditSnapshot };

/** Build a frozen snapshot for `UnifiedBookingForm` edit mode from GET /api/venue/bookings/[id]. */
export function bookingDetailToEditSnapshot(d: {
  booking_date: string;
  booking_time: string;
  party_size: number;
  area_id?: string | null;
  guest: { first_name?: string | null; last_name?: string | null; phone?: string | null; email?: string | null } | null;
  dietary_notes?: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  occasion?: string | null;
  table_assignments?: Array<{ id: string; name: string }>;
  estimated_end_time?: string | null;
  deposit_status?: string | null;
}): UnifiedBookingEditSnapshot {
  return {
    booking_date: d.booking_date,
    booking_time: d.booking_time,
    party_size: d.party_size,
    area_id: d.area_id ?? null,
    guest_first_name: d.guest?.first_name ?? '',
    guest_last_name: d.guest?.last_name ?? '',
    guest_phone: d.guest?.phone ?? null,
    guest_email: d.guest?.email ?? null,
    dietary_notes: d.dietary_notes ?? null,
    special_requests: d.special_requests ?? null,
    internal_notes: d.internal_notes ?? null,
    occasion: d.occasion ?? null,
    table_ids: (d.table_assignments ?? [])
      .map((t) => t.id)
      .filter((id) => !id.startsWith('snapshot-table-')),
    estimated_end_time: d.estimated_end_time ?? null,
    deposit_status: d.deposit_status ?? null,
  };
}

/** Snapshot for dashboard row expand / list (GET detail optional). */
export function expandedRowToEditSnapshot(
  booking: {
    booking_date: string;
    booking_time: string;
    party_size: number;
    area_id?: string | null;
    guest_name: string;
    guest_first_name?: string | null;
    guest_last_name?: string | null;
    guest_phone: string | null;
    guest_email: string | null;
    dietary_notes: string | null;
    occasion: string | null;
    estimated_end_time: string | null;
    deposit_status: string;
    table_assignments?: Array<{ id: string; name: string }>;
  },
  detail?: {
    special_requests: string | null;
    internal_notes: string | null;
    table_assignments?: Array<{ id: string; name: string }>;
    guest: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
  } | null,
): UnifiedBookingEditSnapshot {
  return bookingDetailToEditSnapshot({
    booking_date: booking.booking_date,
    booking_time: booking.booking_time,
    party_size: booking.party_size,
    area_id: booking.area_id,
    guest: detail?.guest
      ? {
          first_name: detail.guest.first_name,
          last_name: detail.guest.last_name,
          phone: detail.guest.phone,
          email: detail.guest.email,
        }
      : {
          first_name: booking.guest_first_name ?? null,
          last_name: booking.guest_last_name ?? null,
          phone: booking.guest_phone,
          email: booking.guest_email,
        },
    dietary_notes: booking.dietary_notes,
    special_requests: detail?.special_requests ?? null,
    internal_notes: detail?.internal_notes ?? null,
    occasion: booking.occasion,
    table_assignments: detail?.table_assignments ?? booking.table_assignments,
    estimated_end_time: booking.estimated_end_time,
    deposit_status: booking.deposit_status,
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  venueId: string;
  currency: string;
  advancedMode: boolean;
  bookingId: string;
  /** Captured when the modal opens — stable for the edit session. */
  editSnapshot: UnifiedBookingEditSnapshot;
};

/**
 * Full table-booking modify flow in the same modal shell as DashboardStaffBookingModal,
 * reusing UnifiedBookingForm (party, date, time, guest, notes, table assignment in advanced mode).
 */
export function ModifyTableBookingModal({
  open,
  onClose,
  onSaved,
  venueId,
  currency,
  advancedMode,
  bookingId,
  editSnapshot,
}: Props) {
  if (!open) return null;

  const surfaceTabs = getStaffBookingSurfaceTabs('table_reservation', []);
  const widthClass = staffSurfaceBookingWidthClass(surfaceTabs, 'table_reservation', {
    tableAdvancedMode: advancedMode,
  });

  return (
    <div
      data-booking-detail-dismiss-exempt
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-[2px] sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modify-table-booking-modal-title"
        className="flex h-[min(90dvh,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-6 py-4">
          <h2 id="modify-table-booking-modal-title" className="text-lg font-semibold text-slate-900">
            Modify booking
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:pb-6">
          <div className={`mx-auto w-full ${widthClass}`}>
            <UnifiedBookingForm
              venueId={venueId}
              advancedMode={advancedMode}
              venueCurrency={currency}
              initialDate={editSnapshot.booking_date}
              initialTime={editSnapshot.booking_time.slice(0, 5)}
              editBookingId={bookingId}
              editSnapshot={editSnapshot}
              onCreated={() => {
                onSaved();
                onClose();
              }}
              onClose={onClose}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
