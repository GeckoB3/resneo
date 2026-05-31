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
  VENUE_DETAIL_DEDUPE_MS,
} from '@/lib/dashboard/venue-detail-swr';

// Live freshness comes from Supabase realtime (per-booking invalidation in
// VenueDetailLiveInvalidator) plus revalidate-on-focus. A timed `refreshInterval`
// here re-ran the expensive detail fan-out every minute for every open panel,
// so it is intentionally omitted to cut database egress.
export function useVenueBookingDetail(bookingId: string | null | undefined) {
  const id = bookingId?.trim() || null;
  return useSWR<VenueBookingDetailPayload>(
    id ? venueBookingDetailKey(id) : null,
    () => fetchVenueBookingDetail(id!),
    {
      revalidateOnFocus: false,
      dedupingInterval: VENUE_DETAIL_DEDUPE_MS,
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
      dedupingInterval: VENUE_DETAIL_DEDUPE_MS,
    },
  );
}
