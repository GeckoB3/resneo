import { describe, expect, it } from 'vitest';
import {
  bookingPaymentStateLabel,
  buildPaymentHistory,
  buildPriceSummary,
  otherVisitLineNote,
  paymentMethodLabel,
  pendingCardPayments,
  pendingCardState,
  pendingCardTotalPence,
  PENDING_CARD_STALE_MS,
  type BookingPaymentRow,
  type PaymentDisplayBooking,
} from '@/lib/booking/payment-display';

/**
 * Ported from the app's `lib/payments/payment-display.test.ts` so the two
 * surfaces cannot describe the same booking differently. Cases covering the
 * charge gate and amount validation are omitted: the web cannot take payments.
 */

const row = (over: Partial<BookingPaymentRow>): BookingPaymentRow => ({
  id: 'p1',
  booking_id: 'bk-1',
  method: 'card_present',
  status: 'succeeded',
  amount_pence: 2500,
  note: null,
  created_at: '2026-07-23T10:00:00Z',
  ...over,
});

const booking = (over: Partial<PaymentDisplayBooking>): PaymentDisplayBooking => ({
  id: 'bk-1',
  ...over,
});

function labels(rows: ReturnType<typeof buildPriceSummary>) {
  return rows.map((r) => [r.label, r.pence, r.note ?? null]);
}

describe('labels', () => {
  it('maps every payment state to a neutral label', () => {
    expect(bookingPaymentStateLabel('unpaid')).toBe('Unpaid');
    expect(bookingPaymentStateLabel('deposit_paid')).toBe('Deposit paid');
    expect(bookingPaymentStateLabel('partially_paid')).toBe('Partially paid');
    expect(bookingPaymentStateLabel('paid')).toBe('Paid');
    expect(bookingPaymentStateLabel('refunded')).toBe('Refunded');
  });

  it('maps ledger methods to short labels', () => {
    expect(paymentMethodLabel('card_present')).toBe('Card');
    expect(paymentMethodLabel('cash')).toBe('Cash');
    expect(paymentMethodLabel('external')).toBe('Other');
    expect(paymentMethodLabel('online')).toBe('Online');
  });
});

describe('buildPaymentHistory', () => {
  it('lists every row newest first, including pending and failed ones', () => {
    // A failed or still-processing attempt is exactly what staff need when
    // something goes wrong; hiding it leaves the booking looking simply unpaid.
    const rows = buildPaymentHistory(
      [
        row({ id: 'a', created_at: '2026-07-23T09:00:00Z', status: 'failed' }),
        row({ id: 'b', created_at: '2026-07-23T11:00:00Z', status: 'pending' }),
        row({ id: 'c', created_at: '2026-07-23T10:00:00Z', method: 'cash' }),
        row({ id: 'd', created_at: '2026-07-23T08:00:00Z', status: 'refunded' }),
      ],
      'bk-1',
    );
    expect(rows.map((r) => [r.key, r.statusLabel, r.methodLabel, r.tone])).toEqual([
      ['b', 'Processing', 'Card', 'warning'],
      ['c', 'Collected', 'Cash', 'default'],
      ['a', 'Failed', 'Card', 'danger'],
      ['d', 'Refunded', 'Card', 'muted'],
    ]);
  });

  it('labels a row collected on another service of the visit', () => {
    const rows = buildPaymentHistory([row({ booking_id: 'bk-2' })], 'bk-1');
    expect(rows[0]!.note).toBe('Collected on another service in this visit');
    expect(buildPaymentHistory([row({ booking_id: 'bk-1' })], 'bk-1')[0]!.note).toBeNull();
  });

  it('tolerates a missing list', () => {
    expect(buildPaymentHistory(undefined, 'bk-1')).toEqual([]);
  });
});

describe('buildPriceSummary', () => {
  it('lists the service, each add-on, and the booking total', () => {
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Cut & finish',
        service_variant_price_pence: 3000,
        addons: [
          { addon_id: 'a1', addon_name_snapshot: 'Scalp massage', price_pence_at_booking: 500 },
          { addon_id: 'a2', addon_name_snapshot: 'Gloss', price_pence_at_booking: 800 },
        ],
        addons_total_price_pence: 1300,
        balance_due_pence: 4300,
      }),
    );
    expect(labels(rows)).toEqual([
      ['Cut & finish', 3000, null],
      ['Scalp massage', 500, null],
      ['Gloss', 800, null],
      ['Booking total', 4300, null],
      ['Outstanding', 4300, null],
    ]);
  });

  it('resolves the total from variant + add-ons when the stored column is empty', () => {
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Massage',
        service_variant_price_pence: 4000,
        addons_total_price_pence: 1000,
        booking_total_price_pence: null,
        balance_due_pence: 5000,
      }),
    );
    expect(rows.find((r) => r.label === 'Booking total')?.pence).toBe(5000);
  });

  it('names an unpriced service instead of hiding it', () => {
    const rows = buildPriceSummary(
      booking({ service_variant_name: 'Consultation', service_variant_price_pence: null }),
    );
    expect(labels(rows)).toEqual([['Consultation', null, 'Price not set']]);
  });

  it('shows the visit total for a multi-service visit', () => {
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Colour',
        service_variant_price_pence: 6000,
        visit_payment: {
          booking_count: 2,
          booking_ids: ['bk-1', 'bk-2'],
          total_pence: 9000,
          amount_paid_pence: 0,
          balance_due_pence: 9000,
        },
        balance_due_pence: 9000,
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(['Colour', 'Visit total (2 services)', 'Outstanding']);
  });

  it('lists every service of a visit with its own price, without double-counting', () => {
    const rows = buildPriceSummary(
      booking({
        id: 'bk-1',
        service_variant_name: 'Cut & finish',
        service_variant_price_pence: 3000,
        addons: [{ addon_id: 'a1', addon_name_snapshot: 'Gloss', price_pence_at_booking: 800 }],
        addons_total_price_pence: 800,
        visit_payment: {
          booking_count: 2,
          booking_ids: ['bk-1', 'bk-2'],
          total_pence: 10300,
          amount_paid_pence: 0,
          balance_due_pence: 10300,
          lines: [
            { booking_id: 'bk-1', name: 'Cut & finish', total_pence: 3800 },
            { booking_id: 'bk-2', name: 'Colour', total_pence: 6500 },
          ],
        },
        balance_due_pence: 10300,
      }),
    );
    expect(labels(rows)).toEqual([
      ['Cut & finish', 3800, null],
      ['Colour', 6500, null],
      ['Visit total (2 services)', 10300, null],
      ['Outstanding', 10300, null],
    ]);
  });

  it('falls back to the on-screen service name when a visit line has none', () => {
    const rows = buildPriceSummary(
      booking({
        id: 'bk-1',
        service_variant_name: 'Cut & finish',
        service_variant_price_pence: 3000,
        visit_payment: {
          booking_count: 2,
          booking_ids: ['bk-1', 'bk-2'],
          total_pence: 9500,
          amount_paid_pence: 0,
          balance_due_pence: 9500,
          lines: [
            { booking_id: 'bk-1', name: null, total_pence: 3000 },
            { booking_id: 'bk-2', name: null, total_pence: 6500 },
          ],
        },
        balance_due_pence: 9500,
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Cut & finish',
      'Service',
      'Visit total (2 services)',
      'Outstanding',
    ]);
  });

  it('reports a paid deposit without double-counting it as paid-so-far', () => {
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Facial',
        service_variant_price_pence: 5000,
        deposit_status: 'Paid',
        deposit_amount_pence: 1000,
        amount_paid_pence: 1000,
        balance_due_pence: 4000,
      }),
    );
    expect(labels(rows)).toEqual([
      ['Facial', 5000, null],
      ['Deposit paid', 1000, null],
      ['Outstanding', 4000, null],
    ]);
  });

  it('shows paid-so-far when in-person payments went on top of the deposit', () => {
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Facial',
        service_variant_price_pence: 5000,
        deposit_status: 'Paid',
        deposit_amount_pence: 1000,
        amount_paid_pence: 3000,
        balance_due_pence: 2000,
      }),
    );
    expect(rows.map((r) => r.label)).toEqual([
      'Facial',
      'Deposit paid',
      'Paid so far',
      'Outstanding',
    ]);
  });

  it('explains an unknown balance rather than showing a dash', () => {
    // The app says "Enter an amount" because its sheet has a field. The web
    // cannot take payments, so it names the cause instead of implying an action.
    const rows = buildPriceSummary(
      booking({
        service_variant_name: 'Package',
        service_variant_price_pence: 5000,
        balance_due_pence: null,
      }),
    );
    expect(rows.find((r) => r.label === 'Outstanding')?.note).toBe('Price not set');
  });

  it('renders nothing for a booking with no prices, deposit or payments', () => {
    expect(buildPriceSummary(booking({}))).toEqual([]);
  });
});

describe('otherVisitLineNote', () => {
  it('flags a row collected on another service of the visit', () => {
    expect(otherVisitLineNote(row({ booking_id: 'bk-2' }), 'bk-1')).toBe(
      'Collected on another service in this visit',
    );
  });

  it('says nothing for a row anchored to the booking on screen', () => {
    expect(otherVisitLineNote(row({ booking_id: 'bk-1' }), 'bk-1')).toBeNull();
  });

  it('tolerates an older payload with no booking_id', () => {
    expect(otherVisitLineNote(row({ booking_id: undefined }), 'bk-1')).toBeNull();
  });
});

describe('pendingCardPayments', () => {
  const rows = [
    row({ id: 'a', status: 'pending', method: 'card_present', amount_pence: 1000 }),
    row({ id: 'b', status: 'pending', method: 'cash', amount_pence: 500 }),
    row({ id: 'c', status: 'succeeded', method: 'card_present', amount_pence: 700 }),
    row({ id: 'd', status: 'pending', method: 'card_present', amount_pence: 200 }),
  ];

  it('keeps only card rows still waiting on their webhook', () => {
    expect(pendingCardPayments(rows).map((r) => r.id)).toEqual(['a', 'd']);
  });

  it('totals what is in flight, and tolerates a missing list', () => {
    expect(pendingCardTotalPence(rows)).toBe(1200);
    expect(pendingCardTotalPence(undefined)).toBe(0);
  });
});

describe('pendingCardState', () => {
  const at = (iso: string) => row({ status: 'pending', method: 'card_present', created_at: iso });
  const NOW = Date.parse('2026-07-23T12:00:00Z');

  it('says there is nothing to warn about when nothing is pending', () => {
    expect(pendingCardState({ payments: [row({})], nowMs: NOW })).toEqual({
      verdict: 'none',
      rows: [],
      totalPence: 0,
    });
  });

  it('blocks on a fresh row, with the total to show staff', () => {
    const out = pendingCardState({
      payments: [at('2026-07-23T11:59:00Z')],
      nowMs: NOW,
    });
    expect(out.verdict).toBe('in_flight');
    expect(out.totalPence).toBe(2500);
  });

  it('softens a row whose webhook is clearly never coming', () => {
    const out = pendingCardState({
      payments: [at('2026-07-23T11:50:00Z')],
      nowMs: NOW,
    });
    expect(out.verdict).toBe('stale');
  });

  it('stays in flight right up to the edge of the window', () => {
    const edge = new Date(NOW - PENDING_CARD_STALE_MS).toISOString();
    expect(pendingCardState({ payments: [at(edge)], nowMs: NOW }).verdict).toBe('in_flight');
  });

  it('assumes in flight until the clock has actually been read', () => {
    expect(pendingCardState({ payments: [at('2020-01-01T00:00:00Z')], nowMs: 0 }).verdict).toBe(
      'in_flight',
    );
  });

  it('assumes in flight when the row has no readable timestamp', () => {
    expect(pendingCardState({ payments: [at('not-a-date')], nowMs: NOW }).verdict).toBe('in_flight');
  });
});
