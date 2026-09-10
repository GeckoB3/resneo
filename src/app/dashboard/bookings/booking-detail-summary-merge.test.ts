import { describe, expect, it } from 'vitest';
import { mergeBookingSummaryOverDetail } from '@/app/dashboard/bookings/booking-detail-summary-merge';
import type { BookingDetail } from '@/app/dashboard/bookings/booking-detail-panel-model';

function detail(overrides: Partial<BookingDetail>): BookingDetail {
  return {
    id: 'bk-1',
    status: 'Booked',
    deposit_status: 'Paid',
    events: [],
    communications: [],
    ...overrides,
  } as unknown as BookingDetail;
}

describe('mergeBookingSummaryOverDetail', () => {
  it('keeps enrichment fields the summary omits (payment mode, card hold)', () => {
    const prev = detail({
      service_payment_requirement: 'full_payment',
      card_hold: { fee_pence: 2000 } as BookingDetail['card_hold'],
      events: [{ id: 'e1' }] as BookingDetail['events'],
      communications: [{ id: 'c1' }] as BookingDetail['communications'],
      combination_staff_notes: 'window seat',
    });
    // A raw summary payload: stubs events/communications/notes, carries no
    // card_hold key at all, and (pre-enrichment) no payment mode.
    const summary = detail({ status: 'Confirmed', combination_staff_notes: null });
    delete (summary as unknown as Record<string, unknown>).service_payment_requirement;
    delete (summary as unknown as Record<string, unknown>).card_hold;

    const merged = mergeBookingSummaryOverDetail(prev, summary);
    expect(merged.status).toBe('Confirmed'); // summary fields win
    expect(merged.service_payment_requirement).toBe('full_payment');
    expect(merged.card_hold).toEqual({ fee_pence: 2000 });
    expect(merged.events).toEqual([{ id: 'e1' }]);
    expect(merged.communications).toEqual([{ id: 'c1' }]);
    expect(merged.combination_staff_notes).toBe('window seat');
  });

  it('prefers summary values when it actually carries them', () => {
    const prev = detail({ service_payment_requirement: 'deposit' });
    const summary = detail({ service_payment_requirement: 'full_payment' });
    expect(mergeBookingSummaryOverDetail(prev, summary).service_payment_requirement).toBe(
      'full_payment',
    );
  });

  it('keeps the per-service lines when the summary carries the visit money without them', () => {
    const lines = [
      { booking_id: 'bk-1', name: 'Cut', total_pence: 3000 },
      { booking_id: 'bk-2', name: 'Colour', total_pence: 5000 },
    ];
    const prev = detail({
      visit_payment: {
        booking_count: 2,
        booking_ids: ['bk-1', 'bk-2'],
        total_pence: 8000,
        amount_paid_pence: 0,
        balance_due_pence: 8000,
        lines,
      },
    });
    const summary = detail({
      visit_payment: {
        booking_count: 2,
        booking_ids: ['bk-1', 'bk-2'],
        total_pence: 8000,
        amount_paid_pence: 3000,
        balance_due_pence: 5000,
      },
    });
    const merged = mergeBookingSummaryOverDetail(prev, summary);
    expect(merged.visit_payment?.amount_paid_pence).toBe(3000); // summary money wins
    expect(merged.visit_payment?.lines).toEqual(lines);

    // Lines the summary does carry win outright.
    const fresh = [{ booking_id: 'bk-1', name: 'Cut', total_pence: 3500 }];
    const withLines = detail({
      visit_payment: { ...summary.visit_payment!, lines: fresh },
    });
    expect(mergeBookingSummaryOverDetail(prev, withLines).visit_payment?.lines).toEqual(fresh);
  });

  it('returns the summary as-is when there is no prior detail or ids differ', () => {
    const summary = detail({});
    expect(mergeBookingSummaryOverDetail(null, summary)).toBe(summary);
    expect(mergeBookingSummaryOverDetail(detail({ id: 'other' }), summary)).toBe(summary);
  });
});
