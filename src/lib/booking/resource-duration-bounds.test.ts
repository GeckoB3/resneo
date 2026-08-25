import { describe, it, expect } from 'vitest';
import { validateResourceDuration } from './resource-duration-bounds';

/**
 * RS-1: `computeResourceAvailability` clamps the requested duration into
 * [min,max] before building its grid, so slot availability only ever proves the
 * CLAMPED span is free. The public create path had no bounds check at all and
 * stored the raw window, so a 09:00-23:00 request against a 3-hour cap validated
 * as 3 hours and blocked the resource for 14.
 */

const BOUNDS = { min_booking_minutes: 60, max_booking_minutes: 180, slot_interval_minutes: 30 };

describe('validateResourceDuration', () => {
  it('accepts a duration inside the bounds and on the slot interval', () => {
    expect(validateResourceDuration(120, BOUNDS)).toEqual({ ok: true });
  });

  it('accepts the exact minimum and maximum', () => {
    expect(validateResourceDuration(60, BOUNDS).ok).toBe(true);
    expect(validateResourceDuration(180, BOUNDS).ok).toBe(true);
  });

  it('rejects the RS-1 case: a span far beyond the maximum', () => {
    // 09:00 to 23:00 against a 3-hour cap. The engine clamped this to 180 and
    // reported the slot free; the row then stored 840.
    const result = validateResourceDuration(840, BOUNDS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/between 60 and 180 minutes/);
  });

  it('rejects a span below the minimum', () => {
    expect(validateResourceDuration(30, BOUNDS).ok).toBe(false);
  });

  it('rejects zero and negative durations', () => {
    // The negative case produced a free `Booked` row via a negative price.
    expect(validateResourceDuration(0, BOUNDS).ok).toBe(false);
    expect(validateResourceDuration(-60, BOUNDS).ok).toBe(false);
  });

  it('rejects a non-integer duration', () => {
    expect(validateResourceDuration(90.5, BOUNDS).ok).toBe(false);
  });

  it('rejects a duration that is not a slot-interval multiple', () => {
    // In bounds but never a real public slot length, and permanently
    // un-reschedulable because the modify validator refuses it (RS-9).
    const result = validateResourceDuration(95, BOUNDS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/multiple of 30 minutes/);
  });

  it('skips the interval rule when the resource has no usable interval', () => {
    expect(
      validateResourceDuration(95, { ...BOUNDS, slot_interval_minutes: 0 }).ok,
    ).toBe(true);
  });
});
