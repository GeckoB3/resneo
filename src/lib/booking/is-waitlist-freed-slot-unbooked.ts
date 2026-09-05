/**
 * Checks whether an appointment slot is still unbooked (for waitlist cascade).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { slotTimeForDb } from '@/lib/booking/waitlist-freed-slot';
import type { WaitlistFreedSlotContext } from '@/lib/booking/waitlist-freed-slot';

/**
 * Statuses that still hold the slot. `Arrived` was listed here for a long time
 * but is not a value of the `booking_status` enum (arrival is the
 * `client_arrived_at` timestamp), so PostgREST refused every check with a bare
 * 400 that the HEAD request hid, and every alert was kept as "still open".
 */
const ACTIVE_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'];

export async function isWaitlistFreedSlotStillUnbooked(
  admin: SupabaseClient,
  slot: WaitlistFreedSlotContext,
): Promise<boolean> {
  const timeForDb = slotTimeForDb(slot.slotTime);

  let query = admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('venue_id', slot.venueId)
    .eq('booking_date', slot.slotDate)
    .eq('booking_time', timeForDb)
    .in('status', ACTIVE_STATUSES);

  if (slot.calendarId) {
    query = query.or(
      `calendar_id.eq.${slot.calendarId},practitioner_id.eq.${slot.calendarId}`,
    );
  }

  const { count, error } = await query;
  if (error) {
    console.error('[isWaitlistFreedSlotStillUnbooked] query failed:', error, {
      venueId: slot.venueId,
      slotDate: slot.slotDate,
    });
    // Keep staff alerts visible when the check fails; do not auto-dismiss.
    return true;
  }

  return (count ?? 0) === 0;
}
