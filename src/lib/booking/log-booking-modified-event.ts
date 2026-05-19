import type { SupabaseClient } from '@supabase/supabase-js';

export type BookingModificationActor = 'staff' | 'guest';

export interface BookingModifiedSnapshot {
  booking_date?: string;
  booking_time?: string;
  party_size?: number;
  booking_end_time?: string;
}

/**
 * Append-only booking_modified event (date/time changes and actor for baseline metrics).
 */
export async function logBookingModifiedEvent(
  admin: SupabaseClient,
  params: {
    venue_id: string;
    booking_id: string;
    modification_actor: BookingModificationActor;
    before: BookingModifiedSnapshot;
    after: BookingModifiedSnapshot;
  },
): Promise<void> {
  const { error } = await admin.from('events').insert({
    venue_id: params.venue_id,
    booking_id: params.booking_id,
    event_type: 'booking_modified',
    payload: {
      modification_actor: params.modification_actor,
      before: params.before,
      after: params.after,
    },
  });
  if (error) {
    console.error('[logBookingModifiedEvent] insert failed:', error.message, {
      venue_id: params.venue_id,
      booking_id: params.booking_id,
    });
  }
}

/** True when payload reflects a schedule change (not party-only tweaks). */
export function isScheduleModificationPayload(payload: {
  before?: BookingModifiedSnapshot;
  after?: BookingModifiedSnapshot;
}): boolean {
  const before = payload.before ?? {};
  const after = payload.after ?? {};
  if (before.booking_date != null && after.booking_date != null && before.booking_date !== after.booking_date) {
    return true;
  }
  const bt = before.booking_time?.slice(0, 5);
  const at = after.booking_time?.slice(0, 5);
  if (bt != null && at != null && bt !== at) return true;
  return false;
}
