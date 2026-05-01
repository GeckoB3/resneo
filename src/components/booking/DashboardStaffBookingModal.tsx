'use client';

import type { StaffSurfaceBookingStackProps } from '@/components/booking/StaffSurfaceBookingStack';
import { StaffSurfaceBookingStack } from '@/components/booking/StaffSurfaceBookingStack';

type Props = Omit<StaffSurfaceBookingStackProps, 'onCreated' | 'bookingIntent'> & {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  title?: string;
  bookingIntent?: 'new' | 'walk-in';
};

/**
 * Modal shell for staff multi-surface booking flows (same surfaces as /dashboard/bookings/new).
 * Tabs appear only when the venue exposes more than one booking surface.
 */
export function DashboardStaffBookingModal({
  open,
  onClose,
  onCreated,
  title = 'New booking',
  bookingIntent = 'new',
  ...stack
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-[2px] sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-staff-booking-modal-title"
        className="flex h-[min(90dvh,90vh)] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-6 py-4">
          <h2 id="dashboard-staff-booking-modal-title" className="text-lg font-semibold text-slate-900">
            {title}
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
          <StaffSurfaceBookingStack {...stack} bookingIntent={bookingIntent} onCreated={onCreated} onClose={onClose} />
        </div>
      </div>
    </div>
  );
}
