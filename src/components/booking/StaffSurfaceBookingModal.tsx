'use client';

import { useId } from 'react';
import { StaffSurfaceBookingStack } from '@/components/booking/StaffSurfaceBookingStack';
import type { BookingModel } from '@/types/booking-models';
import {
  getStaffBookingSurfaceTabs,
  type StaffBookingSurfaceTabId,
} from '@/lib/booking/staff-booking-modal-options';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';

export interface StaffSurfaceBookingModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  venueId: string;
  currency: string;
  bookingModel: BookingModel;
  enabledModels: BookingModel[];
  intent: 'new' | 'walk-in';
  /** Table booking: match New booking page (floor plan assignment). */
  advancedMode?: boolean;
  preselectedDate?: string;
  preselectedPractitionerId?: string;
  preselectedTime?: string;
  /** Guest-history / expanded-row rebook — passed through to {@link StaffSurfaceBookingStack}. */
  staffRebookBootstrap?: StaffRebookBootstrapPayloadV1 | null;
  /** Visible dialog title (defaults from {@link intent}). */
  heading?: string;
  /** Remount inner stack when changed (e.g. increment on each open). */
  stackKey?: number | string;
}

function defaultHeading(intent: 'new' | 'walk-in'): string {
  return intent === 'new' ? 'New booking' : 'Walk-in';
}

/**
 * Staff booking flows in a modal (parity with `/dashboard/bookings/new`):
 * primary model + enabled secondaries, optional one-shot rebook bootstrap.
 */
export function StaffSurfaceBookingModal({
  open,
  onClose,
  onCreated,
  venueId,
  currency,
  bookingModel,
  enabledModels,
  intent,
  advancedMode = false,
  preselectedDate,
  preselectedPractitionerId,
  preselectedTime,
  staffRebookBootstrap = null,
  heading,
  stackKey,
}: StaffSurfaceBookingModalProps) {
  const titleId = useId();
  const title = heading ?? defaultHeading(intent);

  const timedSlotPrefill = typeof preselectedTime === 'string' && preselectedTime.trim() !== '';

  const staffSurfaceTabs = getStaffBookingSurfaceTabs(bookingModel, enabledModels);

  const bootstrapSurface =
    staffRebookBootstrap &&
    staffSurfaceTabs.some((t) => t.id === staffRebookBootstrap.surface)
      ? staffRebookBootstrap.surface
      : undefined;

  /** Bootstrap surface wins; else empty-slot HH:mm prefers Appointment when hybrid. */
  const initialStaffSurfaceTabId: StaffBookingSurfaceTabId | undefined =
    bootstrapSurface ??
    (timedSlotPrefill && staffSurfaceTabs.some((t) => t.id === 'unified_scheduling')
      ? 'unified_scheduling'
      : undefined);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[min(90dvh,90vh)] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 bg-white px-6 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-slate-900">
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
          <StaffSurfaceBookingStack
            key={stackKey ?? 'staff-surface-booking-modal'}
            bookingModel={bookingModel}
            enabledModels={enabledModels}
            venueId={venueId}
            currency={currency}
            advancedMode={advancedMode}
            bookingIntent={intent}
            onCreated={onCreated}
            onClose={onClose}
            initialDate={preselectedDate}
            initialTime={preselectedTime}
            initialStaffSurfaceTabId={initialStaffSurfaceTabId}
            preselectedPractitionerId={preselectedPractitionerId}
            staffRebookBootstrap={staffRebookBootstrap}
          />
        </div>
      </div>
    </div>
  );
}
