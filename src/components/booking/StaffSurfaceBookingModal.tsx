'use client';

import { useId } from 'react';
import { StaffSurfaceBookingStack } from '@/components/booking/StaffSurfaceBookingStack';
import type { BookingModel } from '@/types/booking-models';
import {
  getStaffBookingSurfaceTabs,
  type StaffBookingSurfaceTabId,
} from '@/lib/booking/staff-booking-modal-options';
import type { StaffRebookBootstrapPayloadV1 } from '@/lib/booking/staff-rebook-bootstrap';
import { Dialog } from '@/components/ui/primitives/Dialog';

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
  /** Linked venue the staff member is booking into (cross-venue create). */
  linkedOwnerVenueId?: string;
  linkedVenueName?: string;
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
  linkedOwnerVenueId,
  linkedVenueName,
}: StaffSurfaceBookingModalProps) {
  const titleId = useId();
  const title =
    heading ??
    (linkedVenueName ? `New booking in ${linkedVenueName}` : defaultHeading(intent));

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

  return (
    <div
      className="contents"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      size="lg"
      contentClassName="flex h-[min(90dvh,90vh)] max-h-[min(90dvh,90vh)] w-full max-w-3xl flex-col overflow-hidden p-0"
    >
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden"
        aria-labelledby={titleId}
        id={titleId}
      >
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
            linkedOwnerVenueId={linkedOwnerVenueId}
            linkedVenueName={linkedVenueName}
          />
        </div>
      </div>
    </Dialog>
    </div>
  );
}
