'use client';

import dynamic from 'next/dynamic';
import type { VenuePublic } from './types';
import type { BookingModel } from '@/types/booking-models';

const BookingFlow = dynamic(() => import('./BookingFlow').then((m) => ({ default: m.BookingFlow })), {
  loading: () => <BookingFlowRouteFallback />,
});

const AppointmentBookingFlow = dynamic(
  () => import('./AppointmentBookingFlow').then((m) => ({ default: m.AppointmentBookingFlow })),
  { loading: () => <BookingFlowRouteFallback /> },
);

const EventBookingFlow = dynamic(
  () => import('./EventBookingFlow').then((m) => ({ default: m.EventBookingFlow })),
  { loading: () => <BookingFlowRouteFallback /> },
);

const ClassBookingFlow = dynamic(
  () => import('./ClassBookingFlow').then((m) => ({ default: m.ClassBookingFlow })),
  { loading: () => <BookingFlowRouteFallback /> },
);

const ResourceBookingFlow = dynamic(
  () => import('./ResourceBookingFlow').then((m) => ({ default: m.ResourceBookingFlow })),
  { loading: () => <BookingFlowRouteFallback /> },
);

function BookingFlowRouteFallback() {
  return (
    <div className="flex justify-center py-12" role="status" aria-label="Loading booking">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
    </div>
  );
}

export interface LockedPractitionerBooking {
  id: string;
  name: string;
  /** URL segment; passed as practitioner_slug to appointment catalog */
  bookingSlug: string;
}

interface Props {
  venue: VenuePublic;
  /** Multi-tab public page: which flow to render; defaults to `venue.booking_model`. */
  activeBookingModel?: BookingModel;
  embed?: boolean;
  onHeightChange?: () => void;
  cancellationPolicy?: string;
  accentColour?: string;
  /** Model B: pre-selected practitioner from /book/{venue}/{practitioner-slug} */
  lockedPractitioner?: LockedPractitionerBooking | null;
  /** §7.7: set when this flow is mounted inside a venue collective page. */
  collectiveId?: string;
}

/**
 * Renders the correct booking flow component based on the venue's booking model.
 *
 * Architecture (Unified Scheduling Engine plan):
 * - **table_reservation** - restaurant `BookingFlow`.
 * - **unified_scheduling** - practitioner-style flow backed by `unified_calendars` +
 *   `service_items` + `calendar_service_assignments`.
 * - **event_ticket / class_session / resource_booking** - legacy dedicated flows for venues
 *   still on those enum values. Engine/API support for event/class/resource under USE exists
 *   (`getUnifiedAvailableSlots`, `event_sessions`); full UI consolidation is a future cutover.
 *
 * Flows are code-split so embeds and public book pages only download the active model’s bundle.
 */
export function BookingFlowRouter({
  venue,
  activeBookingModel,
  embed,
  onHeightChange,
  cancellationPolicy,
  accentColour,
  lockedPractitioner,
  collectiveId,
}: Props) {
  const model: BookingModel =
    activeBookingModel ?? ((venue.booking_model as BookingModel | undefined) ?? 'table_reservation');

  switch (model) {
    case 'practitioner_appointment':
    case 'unified_scheduling':
      return (
        <AppointmentBookingFlow
          venue={venue}
          cancellationPolicy={cancellationPolicy}
          embed={embed}
          onHeightChange={onHeightChange}
          accentColour={accentColour}
          lockedPractitioner={lockedPractitioner ?? undefined}
          collectiveId={collectiveId}
        />
      );
    case 'event_ticket':
      return <EventBookingFlow venue={venue} cancellationPolicy={cancellationPolicy} />;
    case 'class_session':
      return <ClassBookingFlow venue={venue} cancellationPolicy={cancellationPolicy} />;
    case 'resource_booking':
      return <ResourceBookingFlow venue={venue} cancellationPolicy={cancellationPolicy} />;
    default:
      return (
        <BookingFlow
          venue={venue}
          embed={embed}
          onHeightChange={onHeightChange}
          cancellationPolicy={cancellationPolicy}
          accentColour={accentColour}
        />
      );
  }
}
