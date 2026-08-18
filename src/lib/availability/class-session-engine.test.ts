import { describe, expect, it } from 'vitest';
import {
  computeClassAvailability,
  isClassInstanceBookableForGuest,
  resolveClassPaymentRequirement,
} from './class-session-engine';
import type { ClassInstance, ClassType } from '@/types/booking-models';
import type { AvailabilityBlock, OpeningHours } from '@/types/availability';

const SAMPLE_INSTRUCTOR_ID = '11111111-1111-4111-8111-111111111111';

const baseType = (overrides: Partial<ClassType> = {}): ClassType => ({
  id: 'ct-1',
  venue_id: 'v-1',
  name: 'Yoga',
  description: null,
  duration_minutes: 60,
  capacity: 10,
  colour: '#22C55E',
  is_active: true,
  price_pence: 500,
  instructor_id: SAMPLE_INSTRUCTOR_ID,
  instructor_name: null,
  payment_requirement: 'full_payment',
  deposit_amount_pence: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const baseInstance = (overrides: Partial<ClassInstance> = {}): ClassInstance => ({
  id: 'ci-1',
  class_type_id: 'ct-1',
  timetable_entry_id: null,
  instance_date: '2026-04-10',
  start_time: '10:00:00',
  capacity_override: null,
  is_cancelled: false,
  cancel_reason: null,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('resolveClassPaymentRequirement', () => {
  it('prefers explicit payment_requirement', () => {
    expect(resolveClassPaymentRequirement(baseType({ payment_requirement: 'none' }))).toBe('none');
  });

  it('maps legacy requires_online_payment false to none', () => {
    expect(
      resolveClassPaymentRequirement(
        baseType({ payment_requirement: undefined, requires_online_payment: false, price_pence: 500 }),
      ),
    ).toBe('none');
  });

  it('treats legacy missing payment mode with price as pay-at-venue (no inferred full_payment)', () => {
    expect(
      resolveClassPaymentRequirement(
        baseType({ payment_requirement: undefined, requires_online_payment: undefined, price_pence: 500 }),
      ),
    ).toBe('none');
  });

  it('maps legacy requires_online_payment true with price to full_payment', () => {
    expect(
      resolveClassPaymentRequirement(
        baseType({ payment_requirement: undefined, requires_online_payment: true, price_pence: 500 }),
      ),
    ).toBe('full_payment');
  });
});

describe('computeClassAvailability', () => {
  it('sets requires_stripe_checkout for full_payment with price', () => {
    const t = baseType({ payment_requirement: 'full_payment', price_pence: 500 });
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [t],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.requires_stripe_checkout).toBe(true);
    expect(slots[0]?.payment_requirement).toBe('full_payment');
  });

  it('skips Stripe for none with list price', () => {
    const t = baseType({ payment_requirement: 'none', price_pence: 500 });
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [t],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots[0]?.requires_stripe_checkout).toBe(false);
  });

  it('excludes instances inside guest min-notice window', () => {
    const t = baseType();
    const inst = baseInstance({ instance_date: '2026-06-15', start_time: '14:00:00' });
    const ref = Date.parse('2026-06-15T13:30:00.000Z');
    const window = {
      minNoticeHours: 1,
      venueTimezone: 'Etc/UTC',
      referenceNowMs: ref,
    };
    expect(isClassInstanceBookableForGuest(inst, window)).toBe(false);
    const slots = computeClassAvailability({
      date: '2026-06-15',
      classTypes: [t],
      instances: [inst],
      bookedByInstance: {},
      guestBookingWindow: window,
    });
    expect(slots).toHaveLength(0);
  });

  it('includes instances after guest min-notice window', () => {
    const t = baseType();
    const inst = baseInstance({ instance_date: '2026-06-15', start_time: '18:00:00' });
    const ref = Date.parse('2026-06-15T09:00:00.000Z');
    const window = {
      minNoticeHours: 2,
      venueTimezone: 'Etc/UTC',
      referenceNowMs: ref,
    };
    expect(isClassInstanceBookableForGuest(inst, window)).toBe(true);
    const slots = computeClassAvailability({
      date: '2026-06-15',
      classTypes: [t],
      instances: [inst],
      bookedByInstance: {},
      guestBookingWindow: window,
    });
    expect(slots).toHaveLength(1);
  });

  it('uses custom instructor_name for guest display when set', () => {
    const t = baseType({ instructor_name: 'Guest teacher' });
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [t],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots[0]?.instructor_name).toBe('Guest teacher');
  });

  it('falls back to instructorDisplayNamesById when instructor_name is empty', () => {
    const t = baseType({ instructor_name: null });
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [t],
      instances: [baseInstance()],
      bookedByInstance: {},
      instructorDisplayNamesById: { [SAMPLE_INSTRUCTOR_ID]: 'Studio calendar' },
    });
    expect(slots[0]?.instructor_name).toBe('Studio calendar');
  });
});

describe('computeClassAvailability — venue opening hours vs explicit blocks', () => {
  // 2026-04-10 is a Friday.
  const FRIDAY = '2026-04-10';
  const SUNDAY = '2026-04-12';

  /** Weekly hours Mon–Fri 09:00–17:00, closed weekends. Keys are "0"–"6" (Sun=0). */
  const weekdayOpeningHours: OpeningHours = {
    '1': { periods: [{ open: '09:00', close: '17:00' }] },
    '2': { periods: [{ open: '09:00', close: '17:00' }] },
    '3': { periods: [{ open: '09:00', close: '17:00' }] },
    '4': { periods: [{ open: '09:00', close: '17:00' }] },
    '5': { periods: [{ open: '09:00', close: '17:00' }] },
    '0': { closed: true },
    '6': { closed: true },
  };

  it('shows an evening class on a weekday that falls outside weekly opening hours (no blocks)', () => {
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '19:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.start_time).toBe('19:00:00');
  });

  it('shows a class scheduled on a weekly-closed day (no blocks)', () => {
    const slots = computeClassAvailability({
      date: SUNDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: SUNDAY, start_time: '10:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(1);
  });

  it('hides a class on a full-day venue-wide closure block', () => {
    const block: AvailabilityBlock = {
      id: 'blk-1',
      venue_id: 'v-1',
      service_id: null,
      block_type: 'closed',
      date_start: FRIDAY,
      date_end: FRIDAY,
      time_start: null,
      time_end: null,
      override_max_covers: null,
      reason: 'Public holiday',
    };
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '10:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [block],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(0);
  });

  it('hides a class that overlaps a partial closure window', () => {
    const block: AvailabilityBlock = {
      id: 'blk-2',
      venue_id: 'v-1',
      service_id: null,
      block_type: 'closed',
      date_start: FRIDAY,
      date_end: FRIDAY,
      time_start: '09:30:00',
      time_end: '11:30:00',
      override_max_covers: null,
      reason: 'Maintenance',
    };
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '10:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [block],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(0);
  });

  it('shows a class that does not overlap a partial closure window', () => {
    const block: AvailabilityBlock = {
      id: 'blk-3',
      venue_id: 'v-1',
      service_id: null,
      block_type: 'closed',
      date_start: FRIDAY,
      date_end: FRIDAY,
      time_start: '13:00:00',
      time_end: '15:00:00',
      override_max_covers: null,
      reason: 'Maintenance',
    };
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '10:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [block],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(1);
  });

  it('shows a class that fits inside amended hours for the date', () => {
    const block: AvailabilityBlock = {
      id: 'blk-4',
      venue_id: 'v-1',
      service_id: null,
      block_type: 'amended_hours',
      date_start: FRIDAY,
      date_end: FRIDAY,
      time_start: null,
      time_end: null,
      override_max_covers: null,
      reason: 'Reduced hours',
      override_periods: [{ open: '10:00', close: '14:00' }],
    };
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '11:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [block],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(1);
  });

  /**
   * Stage 5, operator decision (B): amended hours no longer hide a class.
   *
   * An Hours override is a SLOT-GENERATION concept -- it says which times a guest may pick
   * off a grid. A class is a fixed time staff put on the calendar deliberately, so it is
   * gated by explicit closures only, exactly as the venue's weekly hours never hid it.
   * An explicit closure over the class still hides it; the full-day closure test covers that.
   */
it('still shows a class outside amended hours, which only constrain slot generation', () => {
    const block: AvailabilityBlock = {
      id: 'blk-5',
      venue_id: 'v-1',
      service_id: null,
      block_type: 'amended_hours',
      date_start: FRIDAY,
      date_end: FRIDAY,
      time_start: null,
      time_end: null,
      override_max_covers: null,
      reason: 'Reduced hours',
      override_periods: [{ open: '10:00', close: '14:00' }],
    };
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '15:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [block],
      venueOpeningHours: weekdayOpeningHours,
    });
    expect(slots).toHaveLength(1);
  });

  it('shows classes when venue has no opening hours and no blocks', () => {
    const slots = computeClassAvailability({
      date: FRIDAY,
      classTypes: [baseType()],
      instances: [baseInstance({ instance_date: FRIDAY, start_time: '06:00:00' })],
      bookedByInstance: {},
      venueWideBlocks: [],
      venueOpeningHours: null,
    });
    expect(slots).toHaveLength(1);
  });
});
