import { describe, expect, it } from 'vitest';
import { buildDetailForExpanded } from '@/components/booking/booking-detail-expanded-payload';
import type { BookingDetail } from '@/app/dashboard/bookings/booking-detail-panel-model';

function detailFixture(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: 'bk-1',
    special_requests: null,
    internal_notes: null,
    cancellation_deadline: null,
    guest: null,
    communications: [],
    events: [],
    combination_staff_notes: null,
    ...overrides,
  } as unknown as BookingDetail;
}

describe('buildDetailForExpanded', () => {
  it('passes the card_hold summary through so the popover/modal charge gate can resolve', () => {
    const cardHold = {
      fee_pence: 2500,
      saved: true,
      charged_pence: null,
      charged_at: null,
      released_at: null,
      charge_failure_code: null,
      charge_window_ends_at: '2026-07-20T12:00:00Z',
    };
    const out = buildDetailForExpanded(detailFixture({ card_hold: cardHold }), {
      isHydrated: true,
      assignedTables: [],
    });
    expect(out.card_hold).toEqual(cardHold);
  });

  it('normalises a missing card_hold to null (no hold row)', () => {
    const out = buildDetailForExpanded(detailFixture(), { isHydrated: true, assignedTables: [] });
    expect(out.card_hold).toBeNull();
  });

  it('passes service_payment_requirement through for the full-payment labels', () => {
    const out = buildDetailForExpanded(detailFixture({ service_payment_requirement: 'full_payment' }), {
      isHydrated: true,
      assignedTables: [],
    });
    expect(out.service_payment_requirement).toBe('full_payment');
    const missing = buildDetailForExpanded(detailFixture(), { isHydrated: true, assignedTables: [] });
    expect(missing.service_payment_requirement).toBeNull();
  });
});
