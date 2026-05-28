'use client';

import { useCallback, useMemo } from 'react';
import { useSWRConfig } from 'swr';
import { useDashboardToolbarVenue } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import { useVenuePostgresLiveSync } from '@/lib/realtime/useVenuePostgresLiveSync';
import {
  venueBookingDetailKey,
  venueBookingSummaryKey,
} from '@/lib/dashboard/venue-detail-swr';

/**
 * No-op refresh for the live-sync polling fallback.
 *
 * Previously this revalidated *every* cached booking detail + summary on each
 * fallback tick (every 30s while the realtime channel is reconnecting). With a
 * dashboard that has hovered/opened many rows that produced a continuous storm
 * of booking-detail fan-out fetches (huge database egress). Targeted updates
 * still happen via the per-row realtime `handler`s below; this only disables the
 * indiscriminate bulk revalidation.
 */
const noopRefresh = () => {};

function bookingIdFromPayload(payload: {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}): string | null {
  const raw = payload.new?.id ?? payload.old?.id;
  return typeof raw === 'string' ? raw : null;
}

function bookingIdFromAssignmentPayload(payload: {
  new?: Record<string, unknown>;
  old?: Record<string, unknown>;
}): string | null {
  const raw = payload.new?.booking_id ?? payload.old?.booking_id;
  return typeof raw === 'string' ? raw : null;
}

/**
 * Keeps cached booking detail/summary SWR entries fresh when another staff member
 * or a webhook updates bookings outside bookings/contacts list views.
 */
export function VenueDetailLiveInvalidator() {
  const { venueId } = useDashboardToolbarVenue();
  const { mutate } = useSWRConfig();

  const invalidateBooking = useCallback(
    (bookingId: string) => {
      void mutate(venueBookingDetailKey(bookingId), undefined, { revalidate: true });
      void mutate(venueBookingSummaryKey(bookingId), undefined, { revalidate: true });
    },
    [mutate],
  );

  const subscriptions = useMemo(
    () => [
      {
        table: 'bookings',
        filter: `venue_id=eq.${venueId}`,
        handler: (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const id = bookingIdFromPayload(payload);
          if (id) invalidateBooking(id);
        },
      },
      {
        table: 'booking_table_assignments',
        handler: (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          const id = bookingIdFromAssignmentPayload(payload);
          if (id) invalidateBooking(id);
        },
      },
    ],
    [invalidateBooking, venueId],
  );

  useVenuePostgresLiveSync({
    venueId,
    onRefresh: noopRefresh,
    subscriptions,
  });

  return null;
}
