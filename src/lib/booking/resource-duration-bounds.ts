/**
 * RS-1: the one place that decides whether a requested resource duration is
 * bookable at all.
 *
 * `computeResourceAvailability` CLAMPS its `requestedDurationMinutes` into
 * `[min_booking_minutes, max_booking_minutes]` before it builds the slot grid
 * (`resource-booking-engine.ts:359`). That is right for generating slots, and
 * wrong as a gate: a caller asking for 09:00 to 23:00 against a 3-hour cap gets
 * validated as a 3-hour booking. The staff modify path noticed and added its own
 * bounds check; the public create path did not, and stored the raw 14-hour
 * window, blocking the resource all day. The DB trigger waves malformed resource
 * windows through on the stated assumption that "the application validates
 * resource windows".
 *
 * So both paths call this, and the caller derives the stored end from the
 * duration this approved rather than from anything the client sent.
 */
export interface ResourceDurationBounds {
  min_booking_minutes: number;
  max_booking_minutes: number;
  slot_interval_minutes: number;
}

export function validateResourceDuration(
  durationMinutes: number,
  bounds: ResourceDurationBounds,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return { ok: false, reason: 'Booking duration must be a positive whole number of minutes' };
  }

  if (
    durationMinutes < bounds.min_booking_minutes ||
    durationMinutes > bounds.max_booking_minutes
  ) {
    return {
      ok: false,
      reason: `Booking duration must be between ${bounds.min_booking_minutes} and ${bounds.max_booking_minutes} minutes`,
    };
  }

  // Must land on a real public slot length. The public picker only ever offers
  // multiples of `slot_interval_minutes` (`resourceDurationCandidatesMinutes`),
  // so anything else is a crafted or drifted request, and a booking made at a
  // non-multiple duration can never be rescheduled without cancel-and-rebook.
  const step = bounds.slot_interval_minutes;
  if (typeof step === 'number' && step > 0 && durationMinutes % step !== 0) {
    return { ok: false, reason: `Booking duration must be a multiple of ${step} minutes` };
  }

  return { ok: true };
}
