import type { SupabaseClient } from '@supabase/supabase-js';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  attachVenueClockToAppointmentInput,
  ensureServiceInAppointmentInput,
  fetchAppointmentInput,
  getOfferedAppointmentServicesForPractitioner,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
  serviceItemRowToEngineService,
  validateAppointmentCustomInterval,
} from '@/lib/availability/appointment-engine';
import { applyVariantToAppointmentInput } from '@/lib/appointments/service-variant';
import { canonicalServiceShape, parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { loadActiveVariantForService } from '@/lib/venue/service-variants';
import type { AppointmentService } from '@/types/booking-models';

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

/**
 * The booking's own calendar column. Exactly one of the two ids is authoritative:
 * `PATCH /api/venue/bookings/[id]` writes `calendar_id` when the row has one and
 * `practitioner_id` otherwise, so reads must resolve it the same way.
 */
function owningColumnId(row: { calendar_id?: string | null; practitioner_id?: string | null }): string | null {
  return row.calendar_id ?? row.practitioner_id ?? null;
}

/**
 * Is this edit merely CARRYING the service the booking already has, on the column it
 * already sits on?
 *
 * The offered-services check answers "may this be BOOKED here", so it belongs to the
 * pair being CHOSEN. A calendar that stops offering a service keeps the bookings
 * already in the diary, and the dashboard promises they go ahead as normal; without
 * this exemption not one of them could be dragged five minutes, resized, or saved
 * from the modify form again, because every one of those edits runs this validator.
 * A service that is simply parked closes the same trap.
 *
 * Only the exact stored pair is exempt. Change the calendar or change the service and
 * the ordinary check applies, so nothing NEW can be put on a calendar that does not
 * offer it.
 */
async function bookingCarriesItsOwnService(params: {
  admin: SupabaseClient;
  venueId: string;
  bookingId: string;
  practId: string;
  svcId: string;
}): Promise<boolean> {
  const { admin, venueId, bookingId, practId, svcId } = params;
  const { data } = await admin
    .from('bookings')
    .select('calendar_id, practitioner_id, service_item_id, appointment_service_id')
    .eq('id', bookingId)
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!data) return false;
  const row = data as {
    calendar_id?: string | null;
    practitioner_id?: string | null;
    service_item_id?: string | null;
    appointment_service_id?: string | null;
  };
  const storedService = row.service_item_id ?? row.appointment_service_id ?? null;
  return owningColumnId(row) === practId && storedService === svcId;
}

/**
 * The catalogue row for a service the calendar's loaders left out, so the engine can
 * still size and space the booking that carries it.
 *
 * Deliberately unfiltered on `is_active`: a parked service's existing bookings have to
 * stay editable, and this row is only ever put in front of the engine for the pair a
 * booking already has. The per-calendar override is not merged in because there is no
 * link row left to merge; the base catalogue entry is what the booking falls back to.
 */
async function loadCarriedServiceForEngine(
  admin: SupabaseClient,
  venueId: string,
  serviceId: string,
): Promise<AppointmentService | null> {
  const { data: item } = await admin
    .from('service_items')
    .select('*')
    .eq('venue_id', venueId)
    .eq('id', serviceId)
    .maybeSingle();
  if (item) {
    return serviceItemRowToEngineService(item as Record<string, unknown>, venueId, null);
  }
  const { data: legacy } = await admin
    .from('appointment_services')
    .select('*')
    .eq('venue_id', venueId)
    .eq('id', serviceId)
    .maybeSingle();
  if (!legacy) return null;
  const raw = legacy as Record<string, unknown>;
  const canon = canonicalServiceShape({
    durationMinutes: (raw.duration_minutes as number) ?? 30,
    processingBlocks: parseProcessingTimeBlocksFromDb(raw.processing_time_blocks),
  });
  return {
    ...(legacy as unknown as AppointmentService),
    duration_minutes: canon.durationMinutes,
    processing_time_blocks: canon.processingBlocks,
    is_active: true,
  };
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
   * Staff move/resize over a break.
   *
   * Separate from `allowOutsideHours` because the engine keeps the two gates
   * separate on purpose: passing the hours flag has never relaxed breaks. The
   * walk-in create path has allowed this since it was written; the move and
   * resize paths never sent it, so a drag the diary permitted came back 409
   * "Conflicts with a break" (SA-H5).
   */
  allowDuringBreaks?: boolean;
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
): Promise<
  | {
      ok: true;
      /**
       * The hours override is what let this through: the time sits outside the
       * calendar's working or opening hours, a service's own availability
       * window, or on a venue closure. Always false without `allowOutsideHours`.
       * Callers that always send the override (the diary, the modify form) use
       * it to say so rather than to refuse.
       */
      outsideHours: boolean;
    }
  | { ok: false; reason: string }
> {
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
    allowDuringBreaks,
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

  /**
   * A booking carrying the service it already has, on the column it already sits on,
   * is not choosing anything: see `bookingCarriesItsOwnService`. Costs one read, and
   * only on the path that used to refuse outright.
   */
  const offersServiceAlready =
    apptInput.services.some((s) => s.id === svcId && s.is_active !== false) &&
    apptInput.practitionerServices.some((ps) => ps.practitioner_id === practId && ps.service_id === svcId);
  let carriesOwnService = false;
  if (!offersServiceAlready) {
    carriesOwnService = await bookingCarriesItsOwnService({ admin, venueId, bookingId, practId, svcId });
    if (carriesOwnService && !apptInput.services.some((s) => s.id === svcId)) {
      const carried = await loadCarriedServiceForEngine(admin, venueId, svcId);
      // No catalogue row at all means the service is gone, not merely unlinked, and
      // there is nothing to size the booking with: leave the refusal to stand.
      if (carried) ensureServiceInAppointmentInput(apptInput, carried);
      else carriesOwnService = false;
    }
  }

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
  const svc =
    offered.find((s) => s.id === svcId) ??
    (carriesOwnService ? apptInput.services.find((s) => s.id === svcId) : undefined);
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
    allowDuringBreaks?: boolean;
    allowUnassignedService?: boolean;
    processingTimeBlocks?: ReturnType<typeof parseProcessingTimeBlocksFromDb>;
  } = {
    allowBookingOverlap: allowManualOverlap === true,
    allowOutsideHours: allowOutsideHours === true,
    allowDuringBreaks: allowDuringBreaks === true,
    // Carried through to the engine's own copy of the offered check, and to the
    // strict re-run below, which spreads these options.
    allowUnassignedService: carriesOwnService,
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

  /**
   * Whether the hours override was what let this through.
   *
   * The engine answers the hours question in one gate (working hours, opening
   * hours, a service's own availability window, a venue closure), and every
   * other check runs the same way with or without the override. So if the
   * strict run fails once the relaxed run has passed, the hours gate is the
   * only thing that can have failed. Pure and in memory: nothing is re-fetched.
   */
  const outsideHours =
    intervalOpts.allowOutsideHours === true &&
    !validateAppointmentCustomInterval(
      apptInput,
      practId,
      svcId,
      timeStr,
      resolvedEnd.endCoreHHmm,
      bookingId,
      { ...intervalOpts, allowOutsideHours: false },
    ).ok;

  return { ok: true, outsideHours };
}
