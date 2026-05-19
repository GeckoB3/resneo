import type {
  AppointmentAvailabilityResult,
  PractitionerSlot,
} from '@/lib/availability/appointment-engine';

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
  return merged;
}

/** Shape returned to clients when `any_available=true` on availability APIs. */
export function buildAnyAvailableAvailabilityPayload(
  result: AppointmentAvailabilityResult,
  serviceId: string,
): AppointmentAvailabilityResult {
  const pooled = poolAppointmentSlotsForService(result, serviceId);
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
