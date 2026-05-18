'use client';

import useSWR from 'swr';
import type { GuestDetailResponse } from '@/types/contacts';
import type { VenueBookingDetailPayload } from '@/components/providers/DashboardDetailCacheProvider';
import {
  fetchVenueBookingDetail,
  fetchVenueGuestDetail,
  GUEST_DETAIL_HISTORY_LIMIT_FULL,
  venueBookingDetailKey,
  venueGuestDetailKey,
  VENUE_DETAIL_STALE_MS,
} from '@/lib/dashboard/venue-detail-swr';

export function useVenueBookingDetail(bookingId: string | null | undefined) {
  const id = bookingId?.trim() || null;
  return useSWR<VenueBookingDetailPayload>(
    id ? venueBookingDetailKey(id) : null,
    () => fetchVenueBookingDetail(id!),
    {
      revalidateOnFocus: false,
      dedupingInterval: VENUE_DETAIL_STALE_MS,
    },
  );
}

export function useVenueGuestDetail(
  guestId: string | null | undefined,
  historyLimit = GUEST_DETAIL_HISTORY_LIMIT_FULL,
) {
  const id = guestId?.trim() || null;
  return useSWR<GuestDetailResponse>(
    id ? venueGuestDetailKey(id, historyLimit) : null,
    () => fetchVenueGuestDetail(id!, historyLimit),
    {
      revalidateOnFocus: false,
      dedupingInterval: VENUE_DETAIL_STALE_MS,
    },
  );
}
