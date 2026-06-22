import type { SupabaseClient } from '@supabase/supabase-js';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  computeResourceAvailability,
  fetchResourceInput,
} from '@/lib/availability/resource-booking-engine';
import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';

export function resolveResourceModifyDuration(params: {
  startHHmm: string;
  bookingEndTime?: string | null;
  durationMinutes?: number | null;
}): { ok: true; durationMinutes: number; endHHmm: string } | { ok: false; reason: string } {
  const startHHmm = params.startHHmm.slice(0, 5);
  if (typeof params.durationMinutes === 'number' && Number.isInteger(params.durationMinutes)) {
    if (params.durationMinutes < 5) {
      return { ok: false, reason: 'duration_minutes must be at least 5' };
    }
    return {
      ok: true,
      durationMinutes: params.durationMinutes,
      endHHmm: minutesToTime(timeToMinutes(startHHmm) + params.durationMinutes),
    };
  }
  if (typeof params.bookingEndTime === 'string' && params.bookingEndTime.trim() !== '') {
    const end = params.bookingEndTime.trim().slice(0, 5);
    const dur = minutesBetweenStartAndEndHM(startHHmm, end);
    if (dur <= 0) {
      return { ok: false, reason: 'booking_end_time must be after start time' };
    }
    return { ok: true, durationMinutes: dur, endHHmm: end };
  }
  return { ok: false, reason: 'Provide duration_minutes or booking_end_time' };
}

export interface ValidateResourceBookingModificationParams {
  admin: SupabaseClient;
  venueId: string;
  bookingId: string;
  resourceId: string;
  newDate: string;
  /** Local start time HH:mm */
  timeStr: string;
  bookingEndTime?: string | null;
  durationMinutes?: number | null;
}

/**
 * Shared dry-run for staff resource reschedule: same engine path as PATCH slot validation.
 */
export async function validateResourceBookingModification(
  params: ValidateResourceBookingModificationParams,
): Promise<{ ok: true; durationMinutes: number; endHHmm: string } | { ok: false; reason: string }> {
  const { admin, venueId, bookingId, resourceId, newDate, timeStr } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return { ok: false, reason: 'Invalid booking_date' };
  }

  const startHm = timeStr.slice(0, 5);
  const resolved = resolveResourceModifyDuration({
    startHHmm: startHm,
    bookingEndTime: params.bookingEndTime,
    durationMinutes: params.durationMinutes,
  });
  if (!resolved.ok) {
    return resolved;
  }

  const resInput = await fetchResourceInput({
    supabase: admin,
    venueId,
    date: newDate,
    resourceId,
    excludeBookingId: bookingId,
    skipPastSlotFilter: true,
  });
  const resResults = computeResourceAvailability(resInput, resolved.durationMinutes);
  const resRow = resResults.find((r) => r.id === resourceId);
  if (!resRow) {
    return { ok: false, reason: 'Resource not found or inactive' };
  }
  if (resolved.durationMinutes < resRow.min_booking_minutes || resolved.durationMinutes > resRow.max_booking_minutes) {
    return {
      ok: false,
      reason: `Booking duration must be between ${resRow.min_booking_minutes} and ${resRow.max_booking_minutes} minutes`,
    };
  }
  // Staff reschedule must land on a slot-interval multiple, matching the public
  // booking path (which only ever offers durations from
  // resourceDurationCandidatesMinutes — multiples of slot_interval_minutes).
  // Without this, a 35-min reschedule on a 15-min resource would pass min/max
  // yet never be a real public slot length.
  const slotInterval = resRow.slot_interval_minutes;
  if (
    typeof slotInterval === 'number' &&
    slotInterval > 0 &&
    (resolved.durationMinutes <= 0 || resolved.durationMinutes % slotInterval !== 0)
  ) {
    return {
      ok: false,
      reason: `Booking duration must be a multiple of ${slotInterval} minutes`,
    };
  }
  const slotAvailable = resRow.slots.some((s) => s.start_time === startHm);
  if (!slotAvailable) {
    return { ok: false, reason: 'This resource slot is no longer available' };
  }

  return { ok: true, durationMinutes: resolved.durationMinutes, endHHmm: resolved.endHHmm };
}
