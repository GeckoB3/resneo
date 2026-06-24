import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/booking/staff-cancel-booking', () => ({
  cancelStaffBookingWithNotify: vi.fn(),
}));

import { cancelStaffBookingWithNotify } from '@/lib/booking/staff-cancel-booking';
import { cancelClassInstanceBookings } from './cancel-class-instance-bookings';

const mockCancel = vi.mocked(cancelStaffBookingWithNotify);

const VENUE = 'venue-1';
const INSTANCE = 'inst-1';

/** Admin/staffDb double: only `from('bookings').select().eq().eq().in()` is exercised. */
function makeDb(bookingRows: Array<{ id: string; group_booking_id: string | null; status: string }>) {
  const inMock = vi.fn().mockResolvedValue({ data: bookingRows, error: null });
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: inMock,
  };
  return {
    from: vi.fn().mockReturnValue(builder),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cancelClassInstanceBookings', () => {
  it('cancels each active booking, de-dupes groups, and collects notification work', async () => {
    const rows = [
      { id: 'b1', group_booking_id: null, status: 'Booked' },
      { id: 'b2', group_booking_id: 'grp', status: 'Confirmed' },
      { id: 'b3', group_booking_id: 'grp', status: 'Confirmed' }, // same group -> skipped
      { id: 'b4', group_booking_id: null, status: 'Pending' },
    ];
    const admin = makeDb(rows);
    const staffDb = makeDb(rows);

    mockCancel.mockResolvedValue({ cancelled: true, scheduleNotification: vi.fn() } as never);

    const result = await cancelClassInstanceBookings(admin, staffDb, {
      venueId: VENUE,
      classInstanceId: INSTANCE,
      className: 'Yoga',
      instanceDate: '2026-07-01',
      actorId: 'staff-1',
    });

    // b1, b2, b4 cancelled; b3 skipped as a duplicate group member.
    expect(mockCancel).toHaveBeenCalledTimes(3);
    const cancelledIds = mockCancel.mock.calls.map((c) => c[3] as unknown);
    expect(cancelledIds).toEqual(['b1', 'b2', 'b4']);
    expect(result.cancelledCount).toBe(3);
    expect(result.refundFailures).toBe(0);
    expect(result.notificationWork).toHaveLength(3);

    // Refund/notify copy carries the class name + date.
    const opts = mockCancel.mock.calls[0]![4] as { refundMessagePrefix?: string; actorId: string | null };
    expect(opts.refundMessagePrefix).toContain('Yoga');
    expect(opts.refundMessagePrefix).toContain('2026-07-01');
    expect(opts.actorId).toBe('staff-1');
  });

  it('tallies refund failures and omits failed bookings from notification work', async () => {
    const rows = [
      { id: 'ok', group_booking_id: null, status: 'Booked' },
      { id: 'fail', group_booking_id: null, status: 'Booked' },
    ];
    const admin = makeDb(rows);
    const staffDb = makeDb(rows);

    mockCancel.mockImplementation(async (_admin, _db, _venue, bookingId) => {
      if (bookingId === 'fail') {
        return { cancelled: false, refundFailed: true } as never;
      }
      return { cancelled: true, scheduleNotification: vi.fn() } as never;
    });

    const result = await cancelClassInstanceBookings(admin, staffDb, {
      venueId: VENUE,
      classInstanceId: INSTANCE,
      className: 'Spin',
      instanceDate: '2026-07-02',
      actorId: null,
    });

    expect(result.cancelledCount).toBe(1);
    expect(result.refundFailures).toBe(1);
    expect(result.notificationWork).toHaveLength(1);
  });

  it('returns empty result when there are no active bookings', async () => {
    const admin = makeDb([]);
    const staffDb = makeDb([]);

    const result = await cancelClassInstanceBookings(admin, staffDb, {
      venueId: VENUE,
      classInstanceId: INSTANCE,
      className: 'Pilates',
      instanceDate: '2026-07-03',
      actorId: 'staff-1',
    });

    expect(mockCancel).not.toHaveBeenCalled();
    expect(result.cancelledCount).toBe(0);
    expect(result.refundFailures).toBe(0);
    expect(result.notificationWork).toEqual([]);
  });

  it('throws when the booking query fails', async () => {
    const inMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    const admin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: inMock,
      }),
    } as never;

    await expect(
      cancelClassInstanceBookings(admin, admin, {
        venueId: VENUE,
        classInstanceId: INSTANCE,
        className: 'X',
        instanceDate: '2026-07-04',
        actorId: null,
      }),
    ).rejects.toThrow(/Failed to list bookings/);
  });
});
