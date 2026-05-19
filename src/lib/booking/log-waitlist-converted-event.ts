import type { SupabaseClient } from '@supabase/supabase-js';
import { logBookingOp } from '@/lib/observability/booking-ops-log';

/**
 * Audit trail when a waitlist entry becomes a booking (Phase 1a.3 polish).
 * `booking_created` is still emitted by the bookings trigger; this records waitlist provenance.
 */
export async function logWaitlistConvertedEvent(
  admin: SupabaseClient,
  params: {
    venueId: string;
    bookingId: string;
    waitlistEntryId: string;
    waitlistKind: 'appointment' | 'table';
    bookingModel?: string;
  },
): Promise<void> {
  const { error } = await admin.from('events').insert({
    venue_id: params.venueId,
    booking_id: params.bookingId,
    event_type: 'waitlist_converted',
    payload: {
      waitlist_entry_id: params.waitlistEntryId,
      waitlist_kind: params.waitlistKind,
    },
  });

  if (error) {
    console.error('[logWaitlistConvertedEvent] events insert failed:', error.message, {
      bookingId: params.bookingId,
      waitlistEntryId: params.waitlistEntryId,
    });
  }

  logBookingOp({
    operation: 'confirm',
    venue_id: params.venueId,
    booking_id: params.bookingId,
    booking_model: params.bookingModel,
  });
}
