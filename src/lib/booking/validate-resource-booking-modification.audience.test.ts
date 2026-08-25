import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * RS-3: this validator was written for staff and hardcoded
 * `skipPastSlotFilter: true`, which suppresses the past-time cutoff and, with it,
 * the minimum-notice and same-day rules that ride on the same cutoff.
 * `/api/confirm` reused it verbatim for guests, with no `isGuestBookingDateAllowed`
 * and no past-start guard of its own, and the guest picker deliberately asked for
 * past slots. A guest could move their booking to a time that had already passed,
 * or up to eleven months out.
 */

vi.mock('@/lib/availability/resource-booking-engine', () => ({
  fetchResourceInput: vi.fn(),
  computeResourceAvailability: vi.fn(),
}));

import {
  fetchResourceInput,
  computeResourceAvailability,
} from '@/lib/availability/resource-booking-engine';
import { validateResourceBookingModification } from './validate-resource-booking-modification';

const mockFetchInput = vi.mocked(fetchResourceInput);
const mockCompute = vi.mocked(computeResourceAvailability);

const RESOURCE_ID = 'res-1';
const ADMIN = {} as SupabaseClient;

function resourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RESOURCE_ID,
    venue_id: 'venue-1',
    name: 'Court 1',
    min_booking_minutes: 60,
    max_booking_minutes: 120,
    slot_interval_minutes: 30,
    is_active: true,
    allow_same_day_booking: true,
    min_booking_notice_hours: 0,
    max_advance_booking_days: 30,
    ...overrides,
  };
}

function setup(opts: { resource?: Record<string, unknown>; slotStarts?: string[] } = {}) {
  const resource = opts.resource ?? resourceRow();
  mockFetchInput.mockResolvedValue({
    date: '2026-06-10',
    resources: [resource],
    existingBookings: [],
    venueTimezone: 'Europe/London',
  } as never);
  mockCompute.mockReturnValue([
    {
      id: RESOURCE_ID,
      name: 'Court 1',
      resource_type: 'court',
      min_booking_minutes: resource.min_booking_minutes as number,
      max_booking_minutes: resource.max_booking_minutes as number,
      slot_interval_minutes: resource.slot_interval_minutes as number,
      price_per_slot_pence: 1000,
      payment_requirement: 'none',
      deposit_amount_pence: null,
      cancellation_notice_hours: 24,
      slots: (opts.slotStarts ?? ['10:00']).map((t) => ({ start_time: t })),
    },
  ] as never);
}

function call(extra: Record<string, unknown> = {}) {
  return validateResourceBookingModification({
    admin: ADMIN,
    venueId: 'venue-1',
    bookingId: 'b1',
    resourceId: RESOURCE_ID,
    newDate: '2026-06-10',
    timeStr: '10:00',
    durationMinutes: 60,
    ...extra,
  });
}

// Pinned so "is this date allowed" is a property of the fixture, not of the day
// the suite happens to run. 2026-06-10 is tomorrow; 2027-05-01 is far outside a
// 30-day advance window.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-09T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('validateResourceBookingModification audience (RS-3)', () => {
  it('keeps the staff override by default: past slots stay visible to the engine', async () => {
    setup();

    const result = await call();

    expect(result.ok).toBe(true);
    expect(mockFetchInput).toHaveBeenCalledWith(
      expect.objectContaining({ skipPastSlotFilter: true }),
    );
  });

  it('keeps the staff override when audience is explicitly staff', async () => {
    setup();

    await call({ audience: 'staff' });

    expect(mockFetchInput).toHaveBeenCalledWith(
      expect.objectContaining({ skipPastSlotFilter: true }),
    );
  });

  it('turns the past-time, notice and same-day rules back on for a guest', async () => {
    setup();

    const result = await call({ audience: 'guest' });

    expect(result.ok).toBe(true);
    // This single flag is what restores all three engine-side rules.
    expect(mockFetchInput).toHaveBeenCalledWith(
      expect.objectContaining({ skipPastSlotFilter: false }),
    );
  });

  it('refuses a guest reschedule beyond the resource max advance window', async () => {
    // 30-day window; this date is roughly eleven months out.
    setup({ resource: resourceRow({ max_advance_booking_days: 30 }) });
    mockFetchInput.mockResolvedValue({
      date: '2027-05-01',
      resources: [resourceRow({ max_advance_booking_days: 30 })],
      existingBookings: [],
      venueTimezone: 'Europe/London',
    } as never);

    const result = await call({ audience: 'guest', newDate: '2027-05-01' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('This date is not available for booking');
  });

  it('does not apply the date window to staff', async () => {
    setup({ resource: resourceRow({ max_advance_booking_days: 30 }) });
    mockFetchInput.mockResolvedValue({
      date: '2027-05-01',
      resources: [resourceRow({ max_advance_booking_days: 30 })],
      existingBookings: [],
      venueTimezone: 'Europe/London',
    } as never);

    const result = await call({ audience: 'staff', newDate: '2027-05-01' });

    expect(result.ok).toBe(true);
  });

  it('refuses a guest when the resource row is missing from the input', async () => {
    mockFetchInput.mockResolvedValue({
      date: '2026-06-10',
      resources: [],
      existingBookings: [],
      venueTimezone: 'Europe/London',
    } as never);
    mockCompute.mockReturnValue([] as never);

    const result = await call({ audience: 'guest' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Resource not found or inactive');
  });

  it('still applies the shared duration bounds for both audiences (RS-1)', async () => {
    setup();

    const staff = await call({ durationMinutes: 840 });
    const guest = await call({ audience: 'guest', durationMinutes: 840 });

    expect(staff.ok).toBe(false);
    expect(guest.ok).toBe(false);
    if (!guest.ok) expect(guest.reason).toMatch(/between 60 and 120 minutes/);
  });
});
