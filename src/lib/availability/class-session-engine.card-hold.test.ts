import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeClassAvailability,
  resolveClassPaymentRequirement,
} from './class-session-engine';
import type { ClassInstance, ClassType } from '@/types/booking-models';

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
  instructor_id: null,
  instructor_name: null,
  payment_requirement: 'card_hold',
  deposit_amount_pence: 300,
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveClassPaymentRequirement — card_hold passthrough (spec 6.3)', () => {
  it('passes card_hold through when the fee is positive', () => {
    expect(resolveClassPaymentRequirement(baseType())).toBe('card_hold');
  });

  it('warns through console.warn when no warn sink is given', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveClassPaymentRequirement(baseType({ deposit_amount_pence: 0 }))).toBe('none');
    expect(consoleWarn).toHaveBeenCalledTimes(1);
  });

  it('degrades to none with a warning when the fee is zero or missing', () => {
    const warn = vi.fn();
    expect(
      resolveClassPaymentRequirement(baseType({ deposit_amount_pence: 0 }), {
        warn,
      }),
    ).toBe('none');
    expect(
      resolveClassPaymentRequirement(baseType({ deposit_amount_pence: null }), {
        warn,
      }),
    ).toBe('none');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no positive per-person fee');
  });
});

describe('computeClassAvailability — card_hold slots', () => {
  it('emits payment_requirement card_hold with the per-person fee in deposit_amount_pence', () => {
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [baseType()],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.payment_requirement).toBe('card_hold');
    expect(slots[0]?.deposit_amount_pence).toBe(300);
    // No money is taken today: the hold is not an online charge.
    expect(slots[0]?.requires_stripe_checkout).toBe(false);
  });

  it('degrades to none (no fee on the slot) when the fee is zero, warning once per class type', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [baseType({ deposit_amount_pence: 0 })],
      instances: [baseInstance({ id: 'ci-1' }), baseInstance({ id: 'ci-2', start_time: '12:00:00' })],
      bookedByInstance: {},
    });
    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.payment_requirement).toBe('none');
      expect(slot.deposit_amount_pence).toBeNull();
    }
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0]?.[0])).toContain('no positive per-person fee');
  });

  it('degrades to none when the fee is zero', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [baseType({ deposit_amount_pence: 0 })],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.payment_requirement).toBe('none');
    expect(slots[0]?.deposit_amount_pence).toBeNull();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0]?.[0])).toContain('no positive per-person fee');
  });

  it('leaves non-card-hold class types untouched', () => {
    const slots = computeClassAvailability({
      date: '2026-04-10',
      classTypes: [baseType({ payment_requirement: 'deposit', deposit_amount_pence: 250 })],
      instances: [baseInstance()],
      bookedByInstance: {},
    });
    expect(slots[0]?.payment_requirement).toBe('deposit');
    expect(slots[0]?.deposit_amount_pence).toBe(250);
  });
});
