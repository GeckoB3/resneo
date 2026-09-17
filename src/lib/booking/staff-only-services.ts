/**
 * "Staff bookings only" (`service_items.is_bookable_online`, plan §6.6; W4).
 *
 * A service with the flag off is a normal service that guests cannot book themselves: staff see it in
 * their own booking form (and in the collective staff form), while public pages, public availability
 * and public create routes leave it out. The column has existed since
 * `20260430120000_unified_scheduling_engine.sql` and was read nowhere in the booking path; W4 wires
 * it. Nothing sets it yet (the Services page checkbox is W5), and on 2026-09-16 no service on staging
 * or production had it off, so wiring it changes nothing until someone ticks the box.
 *
 * Appointment services on the legacy model have no such column, so only `service_items` is read.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** Of the ids given, those guests may not book themselves. Empty when the read fails (fail open). */
export async function loadStaffOnlyServiceIds(
  admin: SupabaseClient,
  serviceIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(serviceIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  const { data, error } = await admin
    .from('service_items')
    .select('id')
    .in('id', ids)
    .eq('is_bookable_online', false);
  if (error) {
    console.error('[staff-only-services] lookup failed; treating every service as bookable online', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((row) => row.id as string));
}

export async function isServiceStaffOnly(admin: SupabaseClient, serviceId: string | null | undefined): Promise<boolean> {
  if (!serviceId) return false;
  return (await loadStaffOnlyServiceIds(admin, [serviceId])).has(serviceId);
}

/** Staff sources book anything; a guest-facing source cannot book a staff-only service. */
export function isStaffBookingSource(source: string | null | undefined): boolean {
  return source === 'phone' || source === 'walk-in';
}
