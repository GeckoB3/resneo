import type { SupabaseClient } from '@supabase/supabase-js';
import { minutesToTime, timeToMinutes } from '@/lib/availability';
import {
  computeResourceAvailability,
  fetchResourceInput,
} from '@/lib/availability/resource-booking-engine';
import { minutesBetweenStartAndEndHM } from '@/lib/booking/validate-appointment-modification';
import { validateResourceDuration } from '@/lib/booking/resource-duration-bounds';
import { entityBookingWindowFromRow, isGuestBookingDateAllowed } from '@/lib/booking/entity-booking-window';

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
  /**
   * RS-3: who is rescheduling.
   *
   * This validator was written for STAFF and hardcoded `skipPastSlotFilter: true`,
   * which suppresses the past-time cutoff and, with it, the minimum-notice and
   * same-day rules that ride on the same cutoff. `/api/confirm` then reused it
   * verbatim for guests, with no `isGuestBookingDateAllowed` and no past-start
   * guard of its own, and the guest picker deliberately requests past slots. A
   * guest could move their own booking to a time that had already passed, or up
   * to eleven months out.
   *
   * 'staff' keeps the deliberate override. 'guest' applies the same rules the
   * public create path applies. Defaults to 'staff' so existing callers are
   * unchanged; guest callers must opt in explicitly.
   */
  audience?: 'staff' | 'guest';
}

/**
 * Shared dry-run for resource reschedule: same engine path as PATCH slot
 * validation. `audience` decides whether the guest booking rules apply (RS-3).
 */
export async function validateResourceBookingModification(
  params: ValidateResourceBookingModificationParams,
): Promise<{ ok: true; durationMinutes: number; endHHmm: string } | { ok: false; reason: string }> {
  const { admin, venueId, bookingId, resourceId, newDate, timeStr } = params;
  const isGuest = params.audience === 'guest';

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
    // RS-3: staff keep the deliberate override; for a guest this is what turns
    // the past-time, minimum-notice and same-day rules back on.
    skipPastSlotFilter: !isGuest,
  });

  if (isGuest) {
    // Date-level window (max advance, same-day). The engine's cutoff covers
    // times within a date; this covers whether the date may be booked at all,
    // exactly as the public create path does before it consults the engine.
    const resourceRow = resInput.resources.find((r) => r.id === resourceId);
    if (!resourceRow) {
      return { ok: false, reason: 'Resource not found or inactive' };
    }
    const allowed = isGuestBookingDateAllowed(
      newDate,
      entityBookingWindowFromRow(resourceRow as unknown as Record<string, unknown>),
      resInput.venueTimezone ?? 'Europe/London',
    );
    if (!allowed) {
      return { ok: false, reason: 'This date is not available for booking' };
    }
  }
  const resResults = computeResourceAvailability(resInput, resolved.durationMinutes);
  const resRow = resResults.find((r) => r.id === resourceId);
  if (!resRow) {
    return { ok: false, reason: 'Resource not found or inactive' };
  }
  // RS-1: shared with the public create path, which had no bounds check at all
  // and stored a window the engine had only validated a clamped part of.
  const bounds = validateResourceDuration(resolved.durationMinutes, resRow);
  if (!bounds.ok) {
    return { ok: false, reason: bounds.reason };
  }
  const slotAvailable = resRow.slots.some((s) => s.start_time === startHm);
  if (!slotAvailable) {
    return { ok: false, reason: 'This resource slot is no longer available' };
  }

  return { ok: true, durationMinutes: resolved.durationMinutes, endHHmm: resolved.endHHmm };
}
