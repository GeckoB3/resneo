import { isAnyAvailablePractitionerId } from '@/lib/availability/appointment-any-practitioner';

export interface BookingCreatePractitionerSegment {
  practitionerId: string;
}

/**
 * Resolved calendar column for create APIs when the guest/staff picked “any available”.
 */
export function practitionerIdForBookingCreate(
  selectedPractitionerId: string | null,
  segments: BookingCreatePractitionerSegment[] | null | undefined,
): string | null {
  if (!selectedPractitionerId) return null;
  if (isAnyAvailablePractitionerId(selectedPractitionerId)) {
    return segments?.[0]?.practitionerId ?? null;
  }
  return selectedPractitionerId;
}
