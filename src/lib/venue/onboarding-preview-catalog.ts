import type { BookingModel } from '@/types/booking-models';

/**
 * What a venue still has to add before guests can book anything, keyed on the primary
 * booking model. Restaurants are absent on purpose: their service periods and capacity
 * are set during onboarding itself, so they can never reach the final step empty.
 */
const MISSING_CATALOG_BY_MODEL: Partial<
  Record<BookingModel, { noun: string; href: string; linkLabel: string }>
> = {
  practitioner_appointment: {
    noun: 'service',
    href: '/dashboard/appointment-services',
    linkLabel: 'Services',
  },
  unified_scheduling: {
    noun: 'service',
    href: '/dashboard/appointment-services',
    linkLabel: 'Services',
  },
  class_session: { noun: 'class', href: '/dashboard/class-timetable', linkLabel: 'Class timetable' },
  event_ticket: { noun: 'event', href: '/dashboard/event-manager', linkLabel: 'Event manager' },
  resource_booking: {
    noun: 'resource',
    href: '/dashboard/resource-timeline',
    linkLabel: 'Resource timeline',
  },
};

export type PreviewCatalogState =
  /** Still loading, the call failed, or the model has no catalogue copy: claim nothing either way. */
  | { kind: 'unknown' }
  /** Server confirmed guests can book, so the screen may say the catalogue is set. */
  | { kind: 'ready' }
  /** Nothing is bookable yet, and this is what is missing. */
  | { kind: 'missing'; noun: string; href: string; linkLabel: string };

/**
 * Decides what the final onboarding screen is allowed to claim.
 *
 * The screen used to assert that services were set and hand over the booking link
 * regardless, which was wrong for any venue that skipped catalogue setup. Copy is now
 * driven by `guest_booking_ready`, the same flag behind the dashboard checklist, and
 * defaults to claiming nothing when the answer is not known.
 */
export function resolvePreviewCatalogState(
  status: { bookingReady: boolean; bookingModel: BookingModel } | null,
): PreviewCatalogState {
  if (!status) return { kind: 'unknown' };
  if (status.bookingReady) return { kind: 'ready' };
  const missing = MISSING_CATALOG_BY_MODEL[status.bookingModel];
  return missing ? { kind: 'missing', ...missing } : { kind: 'unknown' };
}
