import type { BookingDetailLite } from '@/app/dashboard/bookings/ExpandedBookingContent';

/** Minimal guest shape for expanded booking UI before GET detail returns. */
export function guestStubFromBookingRow(booking: {
  guest_id?: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email?: string | null;
  guest_phone?: string | null;
  guest_name?: string;
  guest_visit_count?: number | null;
}): BookingDetailLite['guest'] | null {
  if (!booking.guest_id) return null;
  return {
    id: booking.guest_id,
    first_name: booking.guest_first_name ?? null,
    last_name: booking.guest_last_name ?? null,
    email: booking.guest_email ?? null,
    phone: booking.guest_phone ?? null,
    visit_count: booking.guest_visit_count ?? 0,
    last_visit_date: null,
    tags: [],
    customer_profile_notes: null,
  };
}
