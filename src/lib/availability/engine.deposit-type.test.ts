import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAvailability } from './engine';
import type { BookingRestriction, EngineInput, VenueService } from '@/types/availability';

const venueId = 'v1';
const serviceId = 's1';

const service: VenueService = {
  id: serviceId,
  venue_id: venueId,
  name: 'Dinner',
  days_of_week: [0, 1, 2, 3, 4, 5, 6],
  start_time: '18:00',
  end_time: '22:00',
  last_booking_time: '21:00',
  is_active: true,
  sort_order: 0,
};

function restriction(partial: Partial<BookingRestriction> = {}): BookingRestriction {
  return {
    id: 'r1',
    service_id: serviceId,
    min_advance_minutes: 0,
    max_advance_days: 60,
    min_party_size_online: 1,
    max_party_size_online: 20,
    large_party_threshold: null,
    large_party_message: null,
    deposit_required_from_party_size: null,
    deposit_amount_per_person_gbp: null,
    online_requires_deposit: true,
    cancellation_notice_hours: 48,
    ...partial,
  };
}

function input(partial: Partial<EngineInput> = {}): EngineInput {
  return {
    venue_id: venueId,
    date: '2026-07-10',
    party_size: 6,
    services: [service],
    capacity_rules: [],
    durations: [],
    restrictions: [],
    blocks: [],
    bookings: [],
    schedule_exceptions: [],
    restriction_exceptions: [],
    deposit_legacy_amount_per_person_gbp: null,
    now: new Date(2026, 6, 1, 8, 0, 0),
    ...partial,
  };
}

function firstSlot(engineInput: EngineInput) {
  const results = computeAvailability(engineInput);
  const slots = results.flatMap((r) => r.slots);
  expect(slots.length).toBeGreaterThan(0);
  return slots[0]!;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deposit_type passthrough (restriction > legacy > default)', () => {
  it('uses the restriction deposit_type when set', () => {
    const slot = firstSlot(
      input({
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'card_hold',
          }),
        ],
        deposit_legacy_type: 'charge',
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_type).toBe('card_hold');
    expect(slot.configured_deposit_per_person_gbp).toBe(5);
    expect(slot.deposit_required).toBe(true);
    expect(slot.deposit_amount).toBe(30);
  });

  it('restriction "charge" wins over legacy "card_hold"', () => {
    const slot = firstSlot(
      input({
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'charge',
          }),
        ],
        deposit_legacy_type: 'card_hold',
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_type).toBe('charge');
    expect(slot.deposit_required).toBe(true);
    expect(slot.deposit_amount).toBe(30);
  });

  it('falls back to the legacy deposit_config type when no restriction row exists', () => {
    const slot = firstSlot(
      input({
        restrictions: [],
        deposit_legacy_amount_per_person_gbp: 5,
        deposit_legacy_type: 'card_hold',
        card_hold_deposits_enabled: true,
      }),
    );
    // Legacy-only venues never trigger online deposits (no restriction threshold)...
    expect(slot.deposit_required).toBe(false);
    expect(slot.deposit_amount).toBeNull();
    // ...but the configured fields are still exposed for staff surfaces.
    expect(slot.deposit_type).toBe('card_hold');
    expect(slot.configured_deposit_per_person_gbp).toBe(5);
  });

  it('defaults to "charge" when neither restriction nor legacy config supplies a type', () => {
    const slot = firstSlot(input({ restrictions: [restriction()], card_hold_deposits_enabled: true }));
    expect(slot.deposit_type).toBe('charge');
    expect(slot.configured_deposit_per_person_gbp).toBeNull();
    expect(slot.deposit_required).toBe(false);
  });
});

describe('threshold gating (unchanged behaviour)', () => {
  it('deposit_required stays false below the party threshold for charge deposits', () => {
    const slot = firstSlot(
      input({
        party_size: 4,
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'charge',
          }),
        ],
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_required).toBe(false);
    expect(slot.deposit_amount).toBeNull();
    // Configured fields are still populated unconditionally.
    expect(slot.deposit_type).toBe('charge');
    expect(slot.configured_deposit_per_person_gbp).toBe(5);
  });

  it('exposes configured card-hold fields below the threshold while deposit_required stays false', () => {
    const slot = firstSlot(
      input({
        party_size: 2,
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 7.5,
            deposit_type: 'card_hold',
          }),
        ],
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_required).toBe(false);
    expect(slot.deposit_amount).toBeNull();
    expect(slot.deposit_type).toBe('card_hold');
    expect(slot.configured_deposit_per_person_gbp).toBe(7.5);
  });

  it('requires the deposit at or above the threshold for card holds when the flag is on', () => {
    const slot = firstSlot(
      input({
        party_size: 8,
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'card_hold',
          }),
        ],
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_required).toBe(true);
    expect(slot.deposit_amount).toBe(40);
    expect(slot.deposit_type).toBe('card_hold');
  });
});

describe('flag-off and zero-fee safety (spec 6.3)', () => {
  it('flag off: card_hold resolves as no deposit with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const engineInput = input({
      restrictions: [
        restriction({
          deposit_required_from_party_size: 6,
          deposit_amount_per_person_gbp: 5,
          deposit_type: 'card_hold',
        }),
      ],
      card_hold_deposits_enabled: false,
    });
    const results = computeAvailability(engineInput);
    const slots = results.flatMap((r) => r.slots);
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.deposit_required).toBe(false);
      expect(slot.deposit_amount).toBeNull();
      expect(slot.deposit_type).toBe('charge');
      expect(slot.configured_deposit_per_person_gbp).toBeNull();
    }
    // Warned once per service, not once per slot.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('card_hold_deposits flag is off');
  });

  it('flag omitted behaves like flag off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slot = firstSlot(
      input({
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'card_hold',
          }),
        ],
      }),
    );
    expect(slot.deposit_required).toBe(false);
    expect(slot.deposit_type).toBe('charge');
    expect(warn).toHaveBeenCalled();
  });

  it('flag on but no positive fee: card_hold resolves as no deposit with a console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slot = firstSlot(
      input({
        restrictions: [restriction({ deposit_type: 'card_hold' })],
        card_hold_deposits_enabled: true,
      }),
    );
    expect(slot.deposit_required).toBe(false);
    expect(slot.deposit_type).toBe('charge');
    expect(slot.configured_deposit_per_person_gbp).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no positive per-person fee');
  });

  it('flag off does not affect charge deposits', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const slot = firstSlot(
      input({
        restrictions: [
          restriction({
            deposit_required_from_party_size: 6,
            deposit_amount_per_person_gbp: 5,
            deposit_type: 'charge',
          }),
        ],
        card_hold_deposits_enabled: false,
      }),
    );
    expect(slot.deposit_required).toBe(true);
    expect(slot.deposit_amount).toBe(30);
    expect(slot.deposit_type).toBe('charge');
    expect(warn).not.toHaveBeenCalled();
  });
});
