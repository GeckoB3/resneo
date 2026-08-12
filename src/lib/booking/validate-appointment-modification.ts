import type { SupabaseClient } from '@supabase/supabase-js';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  attachVenueClockToAppointmentInput,
  fetchAppointmentInput,
  getOfferedAppointmentServicesForPractitioner,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { applyVariantToAppointmentInput } from '@/lib/appointments/service-variant';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';

/** Matches `validateAppointmentCustomInterval` cap in appointment-engine. */
export const MAX_APPOINTMENT_CORE_DURATION_MINUTES = 14 * 60;
/** Re-exported so callers see one floor, not three that drifted apart. */
export { MIN_APPOINTMENT_CORE_DURATION_MINUTES };

export function minutesBetweenStartAndEndHM(startHHmm: string, endHHmm: string): number {
  const startMin = timeToMinutes(startHHmm);
  let endMin = timeToMinutes(endHHmm);
  if (endMin <= startMin) {
    endMin += 24 * 60;
  }
  return endMin - startMin;
}

/**
 * Resolves the bookable segment end clock (HH:mm) for staff appointment modify / validate.
 * Prefers explicit `duration_minutes`, then `booking_end_time`, then catalogue default.
 */
export function resolveAppointmentModifyEndCoreHHmm(params: {
  startHHmm: string;
  durationMinutes?: number | null;
  bookingEndTime?: string | null;
  defaultDurationMinutes: number;
}): { ok: true; endCoreHHmm: string } | { ok: false; reason: string } {
  const { startHHmm, durationMinutes, bookingEndTime, defaultDurationMinutes } = params;
  const startMin = timeToMinutes(startHHmm);
  if (typeof durationMinutes === 'number' && Number.isInteger(durationMinutes)) {
    // Was a hard-coded 15 while the engine, the API schemas and the calendar drag
    // all allowed 5, so a 10 minute appointment could be created and dragged but
    // not saved from the modify form.
    if (
      durationMinutes < MIN_APPOINTMENT_CORE_DURATION_MINUTES ||
      durationMinutes > MAX_APPOINTMENT_CORE_DURATION_MINUTES
    ) {
      return {
        ok: false,
        reason: `duration_minutes must be an integer between ${MIN_APPOINTMENT_CORE_DURATION_MINUTES} and ${MAX_APPOINTMENT_CORE_DURATION_MINUTES}`,
      };
    }
    return { ok: true, endCoreHHmm: minutesToTime(startMin + durationMinutes) };
  }
  if (typeof bookingEndTime === 'string' && bookingEndTime.trim() !== '') {
    const raw = bookingEndTime.trim();
    return { ok: true, endCoreHHmm: raw.length >= 5 ? raw.slice(0, 5) : minutesToTime(startMin + defaultDurationMinutes) };
  }
  return { ok: true, endCoreHHmm: minutesToTime(startMin + defaultDurationMinutes) };
}

export interface ValidateAppointmentModificationIntervalParams {
  admin: SupabaseClient;
  venueId: string;
  bookingId: string;
  newDate: string;
  /** Local start time HH:mm */
  timeStr: string;
  /** Target practitioner / unified calendar id used by appointment engine */
  practId: string;
  /** appointment_service.id or service_items.id */
  svcId: string;
  durationMinutes?: number | null;
  bookingEndTime?: string | null;
  /** Explicit variant from the client; falls back to `bookingServiceVariantId` when omitted */
  serviceVariantId?: string | null;
  bookingServiceVariantId?: string | null;
  bookingProcessingSnapshot?: unknown;
  processingTimeBlocksOverride?: unknown;
  allowManualOverlap?: boolean;
  /** Staff move/resize past opening hours — skips the working/opening-hours gates. */
  allowOutsideHours?: boolean;
  /**
   * Other bookings that are moving in the same edit, and so must not be treated
   * as occupying their old slots.
   *
   * A multi-service visit is N rows moving together. Checking service 2 at its
   * new slot while services 1 and 3 still sit at their old ones reports the
   * visit as conflicting with itself, which previously left only one way to
   * validate a visit move at all: `allowManualOverlap`, which switches the
   * overlap gate off entirely and hides real clashes with other guests.
   *
   * The booking being validated is always excluded; these are excluded with it.
   */
  excludeBookingIds?: readonly string[];
}

/**
 * Shared dry-run for staff appointment reschedule: same engine path as PATCH interval validation.
 */
export async function validateAppointmentModificationInterval(
  params: ValidateAppointmentModificationIntervalParams,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const {
    admin,
    venueId,
    bookingId,
    newDate,
    timeStr,
    practId,
    svcId,
    durationMinutes,
    bookingEndTime,
    serviceVariantId,
    bookingServiceVariantId,
    bookingProcessingSnapshot,
    processingTimeBlocksOverride,
    allowManualOverlap,
    allowOutsideHours,
    excludeBookingIds,
  } = params;

  const idLc = bookingId.toLowerCase();
  const excluded = new Set<string>([idLc, ...(excludeBookingIds ?? []).map((v) => v.toLowerCase())]);

  const apptInput = await fetchAppointmentInput({
    supabase: admin,
    venueId,
    date: newDate,
    practitionerId: practId,
    serviceId: svcId,
  });
  apptInput.existingBookings = apptInput.existingBookings.filter(
    (b) => !excluded.has(b.id.toLowerCase()),
  );
  apptInput.skipPastSlotFilter = true;

  const variantIdToUse =
    serviceVariantId !== undefined ? serviceVariantId : (bookingServiceVariantId ?? null);

  if (variantIdToUse) {
    const variant = await loadActiveVariantForService({
      admin,
      venueId,
      serviceId: svcId,
      variantId: variantIdToUse,
    });
    if (!variant) {
      return { ok: false, reason: 'Invalid or inactive variant for this service' };
    }
    const applied = applyVariantToAppointmentInput({
      services: apptInput.services,
      serviceId: svcId,
      variant,
    });
    if (!applied) {
      return { ok: false, reason: 'Service not available with this staff member' };
    }
  }

  const { data: venueClock } = await admin
    .from('venues')
    .select('timezone, booking_rules, opening_hours, venue_opening_exceptions')
    .eq('id', venueId)
    .single();
  attachVenueClockToAppointmentInput(apptInput, venueClock ?? {});

  const practitioner = apptInput.practitioners.find((p) => p.id === practId && p.is_active);
  if (!practitioner) {
    return { ok: false, reason: 'Staff not available' };
  }
  const offered = getOfferedAppointmentServicesForPractitioner(
    practitioner,
    apptInput.services,
    apptInput.practitionerServices,
  );
  const svc = offered.find((s) => s.id === svcId);
  if (!svc) {
    return { ok: false, reason: 'Service not available with this staff member' };
  }

  const resolvedEnd = resolveAppointmentModifyEndCoreHHmm({
    startHHmm: timeStr,
    durationMinutes,
    bookingEndTime,
    defaultDurationMinutes: svc.duration_minutes,
  });
  if (!resolvedEnd.ok) {
    return resolvedEnd;
  }

  const intervalOpts: {
    allowBookingOverlap?: boolean;
    allowOutsideHours?: boolean;
    processingTimeBlocks?: ReturnType<typeof parseProcessingTimeBlocksFromDb>;
  } = {
    allowBookingOverlap: allowManualOverlap === true,
    allowOutsideHours: allowOutsideHours === true,
  };
  if (processingTimeBlocksOverride !== undefined) {
    intervalOpts.processingTimeBlocks = parseProcessingTimeBlocksFromDb(processingTimeBlocksOverride);
  } else if (bookingProcessingSnapshot != null) {
    intervalOpts.processingTimeBlocks = parseProcessingTimeBlocksFromDb(bookingProcessingSnapshot);
  }

  const intervalCheck = validateAppointmentCustomInterval(
    apptInput,
    practId,
    svcId,
    timeStr,
    resolvedEnd.endCoreHHmm,
    bookingId,
    intervalOpts,
  );

  if (!intervalCheck.ok) {
    return { ok: false, reason: intervalCheck.reason ?? 'Selected time is not available for this practitioner' };
  }

  return { ok: true };
}
