import { describe, it, expect } from 'vitest';
import { validateEventTicketBooking } from './validate-event-ticket-booking';
import type { EventAvailabilitySlot } from '@/lib/availability/event-ticket-engine';

function makeSlot(overrides: Partial<EventAvailabilitySlot> = {}): EventAvailabilitySlot {
  return {
    event_id: 'evt-1',
    series_key: 'evt-1',
    parent_event_id: null,
    event_name: 'Pottery Workshop',
    event_date: '2026-07-01',
    start_time: '18:00:00',
    end_time: '20:00:00',
    description: null,
    image_url: null,
    total_capacity: 20,
    remaining_capacity: 20,
    payment_requirement: 'full_payment',
    deposit_amount_pence: 0,
    cancellation_notice_hours: 24,
    ticket_types: [
      { id: 'adult', name: 'Adult', price_pence: 2000, capacity: null, remaining: 10, sort_order: 0 },
      { id: 'child', name: 'Child', price_pence: 1000, capacity: 5, remaining: 5, sort_order: 1 },
    ],
    ...overrides,
  };
}

describe('validateEventTicketBooking', () => {
  it('accepts a valid full-payment booking and charges the ticket total', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [
        { ticket_type_id: 'adult', quantity: 2, unit_price_pence: 2000 },
        { ticket_type_id: 'child', quantity: 1, unit_price_pence: 1000 },
      ],
      partySize: 3,
      requestedStartTime: '18:00',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.ticketTotalPence).toBe(5000);
    expect(res.value.requiresDeposit).toBe(true);
    expect(res.value.depositAmountPence).toBe(5000);
    // Label comes from the server ticket type, not the client.
    expect(res.value.ticketLines[0]!.label).toBe('Adult');
  });

  it('rejects a forged zero price (the M1 hole)', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 0 }],
      partySize: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it('rejects an unknown ticket type', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'forged', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it('rejects party_size that does not match ticket quantities', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 10,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it('rejects per-tier oversell', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'child', quantity: 6, unit_price_pence: 1000 }],
      partySize: 6,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
  });

  it('computes a per-person deposit for deposit events', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot({ payment_requirement: 'deposit', deposit_amount_pence: 500 }),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 2, unit_price_pence: 2000 }],
      partySize: 2,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.requiresDeposit).toBe(true);
    expect(res.value.depositAmountPence).toBe(1000);
    expect(res.value.cardHoldFeePence).toBeNull();
  });

  it('computes cardHoldFeePence as per-person fee x tickets for card_hold events, with no upfront charge', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot({ payment_requirement: 'card_hold', deposit_amount_pence: 500 }),
      ticketLines: [
        { ticket_type_id: 'adult', quantity: 2, unit_price_pence: 2000 },
        { ticket_type_id: 'child', quantity: 1, unit_price_pence: 1000 },
      ],
      partySize: 3,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 500 per person x 3 tickets; the ticket total never influences the fee.
    expect(res.value.cardHoldFeePence).toBe(1500);
    // Card holds never set the charge fields.
    expect(res.value.requiresDeposit).toBe(false);
    expect(res.value.depositAmountPence).toBe(0);
    expect(res.value.ticketTotalPence).toBe(5000);
  });

  it('treats a zero-fee card_hold event as none (cardHoldFeePence null, nothing charged)', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot({ payment_requirement: 'card_hold', deposit_amount_pence: 0 }),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.cardHoldFeePence).toBeNull();
    expect(res.value.requiresDeposit).toBe(false);
    expect(res.value.depositAmountPence).toBe(0);
  });

  it('returns cardHoldFeePence null for full_payment and none events', () => {
    const full = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
    });
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.value.cardHoldFeePence).toBeNull();

    const none = validateEventTicketBooking({
      slot: makeSlot({ payment_requirement: 'none' }),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
    });
    expect(none.ok).toBe(true);
    if (none.ok) expect(none.value.cardHoldFeePence).toBeNull();
  });

  it('charges nothing for a "none" payment event', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot({ payment_requirement: 'none' }),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.requiresDeposit).toBe(false);
    expect(res.value.depositAmountPence).toBe(0);
  });

  it('rejects a start-time mismatch when requestedStartTime is provided', () => {
    const res = validateEventTicketBooking({
      slot: makeSlot(),
      ticketLines: [{ ticket_type_id: 'adult', quantity: 1, unit_price_pence: 2000 }],
      partySize: 1,
      requestedStartTime: '19:00',
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });
});
