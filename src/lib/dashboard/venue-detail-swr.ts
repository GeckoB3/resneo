import type { GuestDetailResponse } from '@/types/contacts';
import type { VenueBookingDetailPayload } from '@/components/providers/DashboardDetailCacheProvider';

/** Staff dashboard detail reads stay warm for 60s before background revalidation. */
export const VENUE_DETAIL_STALE_MS = 60_000;

export const GUEST_DETAIL_HISTORY_LIMIT_PREFETCH = 25;
export const GUEST_DETAIL_HISTORY_LIMIT_FULL = 80;

export const venueBookingDetailKey = (bookingId: string) =>
  ['venue-booking-detail', bookingId] as const;

export const venueBookingSummaryKey = (bookingId: string) =>
  ['venue-booking-summary', bookingId] as const;

export const venueGuestDetailKey = (guestId: string, historyLimit: number) =>
  ['venue-guest-detail', guestId, historyLimit] as const;

export async function fetchVenueBookingDetail(
  bookingId: string,
): Promise<VenueBookingDetailPayload> {
  const res = await fetch(`/api/venue/bookings/${bookingId}`, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Booking not found' : 'Failed to load booking');
  }
  const data = (await res.json()) as VenueBookingDetailPayload & { id?: unknown };
  if (!data || typeof data !== 'object' || typeof data.id !== 'string' || data.id !== bookingId) {
    throw new Error('Invalid booking detail response');
  }
  return data;
}

export async function fetchVenueBookingSummary(
  bookingId: string,
): Promise<VenueBookingDetailPayload> {
  const res = await fetch(`/api/venue/bookings/${bookingId}/summary`, {
    credentials: 'same-origin',
  });
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'Booking not found' : 'Failed to load booking summary');
  }
  const data = (await res.json()) as VenueBookingDetailPayload & { id?: unknown };
  if (!data || typeof data !== 'object' || typeof data.id !== 'string' || data.id !== bookingId) {
    throw new Error('Invalid booking summary response');
  }
  return data;
}

export async function fetchVenueGuestDetail(
  guestId: string,
  historyLimit = GUEST_DETAIL_HISTORY_LIMIT_FULL,
): Promise<GuestDetailResponse> {
  const res = await fetch(
    `/api/venue/guests/${guestId}?booking_history_limit=${historyLimit}`,
    { credentials: 'same-origin' },
  );
  if (!res.ok) {
    throw new Error('Failed to load guest');
  }
  const data: unknown = await res.json();
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === 'string') throw new Error(err);
  }
  if (!isGuestDetailPayload(data, guestId)) {
    throw new Error('Invalid guest detail response');
  }
  return data;
}

function isGuestDetailPayload(value: unknown, guestId: string): value is GuestDetailResponse {
  if (!value || typeof value !== 'object') return false;
  const g = (value as { guest?: { id?: unknown } }).guest;
  return typeof g?.id === 'string' && g.id === guestId;
}

/** Run prefetch callbacks with a small concurrency cap (idle warmup). */
export async function warmIdsWithConcurrency(
  ids: string[],
  warmOne: (id: string) => Promise<void>,
  concurrency = 4,
): Promise<void> {
  if (ids.length === 0) return;
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    while (index < ids.length) {
      const id = ids[index];
      index += 1;
      try {
        await warmOne(id);
      } catch {
        /* best-effort prefetch */
      }
    }
  });
  await Promise.all(workers);
}
