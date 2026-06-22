import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the resource availability engine so the validation can be exercised
// deterministically without a database. minutesToTime / timeToMinutes (from
// '@/lib/availability') are intentionally NOT mocked — the validator uses the
// real implementations to resolve durations and end times.
const fetchResourceInput = vi.fn();
const computeResourceAvailability = vi.fn();

vi.mock('@/lib/availability/resource-booking-engine', () => ({
  fetchResourceInput: (...args: unknown[]) => fetchResourceInput(...args),
  computeResourceAvailability: (...args: unknown[]) => computeResourceAvailability(...args),
}));

import {
  resolveResourceModifyDuration,
  validateResourceBookingModification,
} from '@/lib/booking/validate-resource-booking-modification';

const RESOURCE_ID = 'res-1';

/** Build a single engine result row for RESOURCE_ID with a slot at `startTime`. */
function engineRow(opts: {
  slotIntervalMinutes: number;
  minBookingMinutes: number;
  maxBookingMinutes: number;
  startTime: string;
}) {
  return {
    id: RESOURCE_ID,
    name: 'Court 1',
    min_booking_minutes: opts.minBookingMinutes,
    max_booking_minutes: opts.maxBookingMinutes,
    slot_interval_minutes: opts.slotIntervalMinutes,
    slots: [{ start_time: opts.startTime }],
  };
}

function arrange(row: ReturnType<typeof engineRow>) {
  fetchResourceInput.mockResolvedValue({ resources: [] });
  computeResourceAvailability.mockReturnValue([row]);
}

const baseParams = {
  // Cast: the real signature wants a SupabaseClient, but fetchResourceInput is mocked.
  admin: {} as never,
  venueId: 'venue-1',
  bookingId: 'booking-1',
  resourceId: RESOURCE_ID,
  newDate: '2026-07-15',
  timeStr: '10:00',
};

describe('resolveResourceModifyDuration', () => {
  it('prefers duration_minutes and derives the end time', () => {
    const r = resolveResourceModifyDuration({ startHHmm: '10:00', durationMinutes: 45 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.durationMinutes).toBe(45);
      expect(r.endHHmm).toBe('10:45');
    }
  });

  it('rejects a sub-5-minute duration', () => {
    const r = resolveResourceModifyDuration({ startHHmm: '10:00', durationMinutes: 3 });
    expect(r.ok).toBe(false);
  });
});

describe('validateResourceBookingModification — slot-interval multiple', () => {
  beforeEach(() => {
    fetchResourceInput.mockReset();
    computeResourceAvailability.mockReset();
  });

  it('accepts a duration that is a multiple of the slot interval and within min/max', async () => {
    arrange(
      engineRow({ slotIntervalMinutes: 15, minBookingMinutes: 15, maxBookingMinutes: 120, startTime: '10:00' }),
    );
    const r = await validateResourceBookingModification({ ...baseParams, durationMinutes: 45 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.durationMinutes).toBe(45);
  });

  it('rejects a duration that is within min/max but NOT a multiple of the slot interval', async () => {
    // 35 minutes on a 15-minute resource: passes 15..120 min/max but is not a
    // multiple of 15, so it must be rejected (public path never offers it).
    arrange(
      engineRow({ slotIntervalMinutes: 15, minBookingMinutes: 15, maxBookingMinutes: 120, startTime: '10:00' }),
    );
    const r = await validateResourceBookingModification({ ...baseParams, durationMinutes: 35 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/multiple of 15 minutes/);
  });

  it('still enforces min/max before the interval check', async () => {
    arrange(
      engineRow({ slotIntervalMinutes: 30, minBookingMinutes: 60, maxBookingMinutes: 120, startTime: '10:00' }),
    );
    // 30 is a clean multiple of the interval but below the 60-minute minimum.
    const r = await validateResourceBookingModification({ ...baseParams, durationMinutes: 30 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/between 60 and 120 minutes/);
  });

  it('accepts a multiple equal to the interval when min permits', async () => {
    arrange(
      engineRow({ slotIntervalMinutes: 30, minBookingMinutes: 30, maxBookingMinutes: 90, startTime: '10:00' }),
    );
    const r = await validateResourceBookingModification({ ...baseParams, durationMinutes: 30 });
    expect(r.ok).toBe(true);
  });
});
