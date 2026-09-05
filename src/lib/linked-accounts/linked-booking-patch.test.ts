import { describe, expect, it, vi } from 'vitest';
import { normalizeLinkedBookingRpcChanges } from '@/lib/linked-accounts/linked-booking-patch';

vi.mock('@/lib/booking/unified-calendar-list', () => ({
  venueUsesUnifiedCalendarList: vi.fn(async () => true),
}));

describe('normalizeLinkedBookingRpcChanges', () => {
  it('maps practitioner_id to calendar_id for unified venues', async () => {
    const admin = {} as ReturnType<typeof import('@/lib/supabase').getSupabaseAdminClient>;
    const out = await normalizeLinkedBookingRpcChanges(
      admin,
      {
        venue_id: '11111111-1111-1111-1111-111111111111',
        calendar_id: '22222222-2222-2222-2222-222222222222',
        practitioner_id: null,
        booking_date: '2026-05-22',
        booking_time: '10:00:00',
        booking_end_time: '11:00:00',
      },
      {
        practitioner_id: '33333333-3333-3333-3333-333333333333',
        booking_date: '2026-05-23',
        booking_time: '14:00:00',
        booking_end_time: '15:00:00',
      },
    );
    expect(out.calendar_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(out.practitioner_id).toBeUndefined();
    expect(out.estimated_end_time).toBeTruthy();
  });

  it('keeps the booking length when only the start moves', async () => {
    const admin = {} as ReturnType<typeof import('@/lib/supabase').getSupabaseAdminClient>;
    const out = await normalizeLinkedBookingRpcChanges(
      admin,
      {
        venue_id: '11111111-1111-1111-1111-111111111111',
        calendar_id: '22222222-2222-2222-2222-222222222222',
        practitioner_id: null,
        booking_date: '2026-05-22',
        booking_time: '10:00:00',
        booking_end_time: '10:30:00',
      },
      { booking_time: '14:00' },
    );
    expect(out.booking_end_time).toBe('14:30:00');
    expect(out.estimated_end_time).toBe('2026-05-22T14:30:00.000Z');
  });

  it('leaves an explicit end alone', async () => {
    const admin = {} as ReturnType<typeof import('@/lib/supabase').getSupabaseAdminClient>;
    const out = await normalizeLinkedBookingRpcChanges(
      admin,
      {
        venue_id: '11111111-1111-1111-1111-111111111111',
        calendar_id: '22222222-2222-2222-2222-222222222222',
        practitioner_id: null,
        booking_date: '2026-05-22',
        booking_time: '10:00:00',
        booking_end_time: '10:30:00',
      },
      { booking_time: '14:00', booking_end_time: '15:00' },
    );
    expect(out.booking_end_time).toBe('15:00');
  });
});
