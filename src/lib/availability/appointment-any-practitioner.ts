import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppointmentAvailabilityResult,
  PractitionerSlot,
} from '@/lib/availability/appointment-engine';
import {
  collapsePooledSlotsByStartTime,
  type AnyAvailablePractitionerConfig,
  DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG,
} from '@/lib/feature-flags/any-available-practitioner-config';

/** Calendar / practitioner column ids that can deliver `serviceId` at this venue. */
export async function listPractitionerIdsForAppointmentService(
  supabase: SupabaseClient,
  venueId: string,
  serviceId: string,
): Promise<string[]> {
  const practitionerIds = new Set<string>();

  const { data: legacyLinks } = await supabase
    .from('practitioner_services')
    .select('practitioner_id, practitioners!inner(venue_id, is_active)')
    .eq('service_id', serviceId)
    .eq('practitioners.venue_id', venueId)
    .eq('practitioners.is_active', true);
  for (const row of legacyLinks ?? []) {
    const id = (row as { practitioner_id?: string }).practitioner_id;
    if (id) practitionerIds.add(id);
  }

  const { data: unifiedAssignments } = await supabase
    .from('calendar_service_assignments')
    .select('calendar_id, unified_calendars!inner(venue_id, is_active)')
    .eq('service_item_id', serviceId)
    .eq('unified_calendars.venue_id', venueId)
    .eq('unified_calendars.is_active', true);
  for (const row of unifiedAssignments ?? []) {
    const id = (row as { calendar_id?: string }).calendar_id;
    if (id) practitionerIds.add(id);
  }

  return [...practitionerIds];
}

/** Active calendar / practitioner column ids in dashboard sort order (unified first, else legacy). */
export async function listVenueCalendarSortOrder(
  supabase: SupabaseClient,
  venueId: string,
): Promise<string[]> {
  const { data: unified } = await supabase
    .from('unified_calendars')
    .select('id, sort_order')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (unified && unified.length > 0) {
    return unified.map((row) => (row as { id: string }).id);
  }

  const { data: legacy } = await supabase
    .from('practitioners')
    .select('id, sort_order')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  return (legacy ?? []).map((row) => (row as { id: string }).id);
}

/** Sentinel practitioner id for pooled “any available” booking flows. */
export const ANY_AVAILABLE_PRACTITIONER_ID = '__any_available__';

export function isAnyAvailablePractitionerId(id: string | null | undefined): boolean {
  return id === ANY_AVAILABLE_PRACTITIONER_ID;
}

/**
 * Merge bookable slots across all practitioners for one service, earliest first.
 * Each slot retains its assigned practitioner for booking creation.
 */
export function poolAppointmentSlotsForService(
  result: AppointmentAvailabilityResult,
  serviceId: string,
  options?: {
    assignment?: AnyAvailablePractitionerConfig;
    calendarOrder?: string[];
  },
): PractitionerSlot[] {
  const merged: PractitionerSlot[] = [];
  for (const practitioner of result.practitioners) {
    for (const slot of practitioner.slots) {
      if (slot.service_id !== serviceId) continue;
      merged.push({
        ...slot,
        practitioner_id: practitioner.id,
        practitioner_name: practitioner.name,
      });
    }
  }
  merged.sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.practitioner_name.localeCompare(b.practitioner_name),
  );

  const assignment = options?.assignment ?? DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG;
  if (assignment.mode === 'priority') {
    return collapsePooledSlotsByStartTime(merged, assignment, options?.calendarOrder ?? []);
  }
  return merged;
}

/** Shape returned to clients when `any_available=true` on availability APIs. */
export function buildAnyAvailableAvailabilityPayload(
  result: AppointmentAvailabilityResult,
  serviceId: string,
  options?: {
    assignment?: AnyAvailablePractitionerConfig;
    calendarOrder?: string[];
  },
): AppointmentAvailabilityResult {
  const pooled = poolAppointmentSlotsForService(result, serviceId, options);
  const serviceMeta = result.practitioners
    .flatMap((p) => p.services)
    .find((s) => s.id === serviceId);
  return {
    practitioners: [
      {
        id: ANY_AVAILABLE_PRACTITIONER_ID,
        name: 'Any available',
        services: serviceMeta ? [serviceMeta] : [],
        slots: pooled,
      },
    ],
  };
}
