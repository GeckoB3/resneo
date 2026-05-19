import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Records staff booking flow duration for P0.6 time-to-book baseline (returning client target under 45s).
 */
export async function logStaffBookingFlowEvent(
  admin: SupabaseClient,
  params: {
    venue_id: string;
    booking_id: string;
    duration_ms: number;
    returning_guest: boolean;
    source: string;
  },
): Promise<void> {
  const { error } = await admin.from('events').insert({
    venue_id: params.venue_id,
    booking_id: params.booking_id,
    event_type: 'staff_booking_flow_completed',
    payload: {
      duration_ms: params.duration_ms,
      returning_guest: params.returning_guest,
      source: params.source,
    },
  });
  if (error) {
    console.error('[logStaffBookingFlowEvent] insert failed:', error.message, {
      venue_id: params.venue_id,
      booking_id: params.booking_id,
    });
  }
}
