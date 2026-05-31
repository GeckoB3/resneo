import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';

export interface BookingPageTeamMember {
  id: string;
  name: string;
}

/**
 * Bookable team members for the "Meet the team" section — the practitioners/calendars that
 * offer services, deduped across the catalog (works for both legacy and unified models).
 * Returns an empty list for venues without an appointment catalog (e.g. table-only).
 */
export async function listBookingPageTeam(
  supabase: SupabaseClient,
  venueId: string,
): Promise<BookingPageTeamMember[]> {
  try {
    const catalog = await fetchAppointmentCatalog(supabase, venueId);
    const byId = new Map<string, string>();
    for (const practitioner of catalog.practitioners) {
      if (!byId.has(practitioner.id)) byId.set(practitioner.id, practitioner.name);
    }
    return [...byId.entries()].map(([id, name]) => ({ id, name }));
  } catch {
    return [];
  }
}
