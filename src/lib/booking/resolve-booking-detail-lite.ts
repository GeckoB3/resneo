import type { BookingDetailLite } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { VenueBookingDetailPayload } from '@/components/providers/DashboardDetailCacheProvider';

export function bookingDetailLiteFromCachePayload(
  bookingId: string,
  raw: VenueBookingDetailPayload | undefined,
): BookingDetailLite | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const id = (raw as { id?: unknown }).id;
  if (typeof id !== 'string' || id !== bookingId) return undefined;
  return raw as unknown as BookingDetailLite;
}
