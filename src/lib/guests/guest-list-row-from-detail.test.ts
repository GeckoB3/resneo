import { describe, expect, it } from 'vitest';
import { guestListRowFromDetailResponse } from '@/lib/guests/guest-list-row-from-detail';
import type { GuestDetailResponse } from '@/types/contacts';

describe('guestListRowFromDetailResponse', () => {
  it('maps guest and stats into a directory list row', () => {
    const detail: GuestDetailResponse = {
      guest: {
        id: 'guest-1',
        first_name: 'Alex',
        last_name: 'Smith',
        email: 'alex@example.com',
        phone: '+447911123456',
        tags: ['vip'],
        visit_count: 3,
        no_show_count: 0,
        last_visit_date: '2026-05-01',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2026-05-01T00:00:00Z',
        customer_profile_notes: null,
        marketing_opt_out: false,
        marketing_consent: true,
        marketing_consent_at: null,
      },
      stats: {
        total_bookings: 5,
        cancellations: 1,
        no_shows: 0,
        total_deposit_pence_paid: 2000,
        first_visit_date: '2025-02-01',
        last_visit_date: '2026-05-01',
        days_since_last_visit: 10,
        days_as_customer: 100,
      },
      booking_history: [],
      communications: [],
    };

    const row = guestListRowFromDetailResponse(detail);
    expect(row.id).toBe('guest-1');
    expect(row.first_name).toBe('Alex');
    expect(row.total_bookings).toBe(5);
    expect(row.cancelled_count).toBe(1);
    expect(row.paid_deposit_pence).toBe(2000);
    expect(row.tags).toEqual(['vip']);
  });
});
