import { describe, expect, it } from 'vitest';
import {
  attendanceConfirmationSources,
  canShowCancelStaffAttendanceConfirmationAction,
  canShowConfirmBookingAttendanceAction,
  showAttendanceConfirmedPill,
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from './booking-staff-indicators';

describe('showDepositPendingPill', () => {
  it('true when deposit pending and amount > 0', () => {
    expect(showDepositPendingPill({ deposit_status: 'Pending', deposit_amount_pence: 500 })).toBe(true);
  });

  it('false when deposit paid', () => {
    expect(showDepositPendingPill({ deposit_status: 'Paid', deposit_amount_pence: 500 })).toBe(false);
  });

  it('false when pending but zero amount (odd row)', () => {
    expect(showDepositPendingPill({ deposit_status: 'Pending', deposit_amount_pence: 0 })).toBe(false);
  });

  it('false when not required', () => {
    expect(showDepositPendingPill({ deposit_status: 'Not Required', deposit_amount_pence: null })).toBe(false);
  });
});

describe('showAttendanceConfirmedPill', () => {
  it('false when neither guest nor staff', () => {
    expect(showAttendanceConfirmedPill({})).toBe(false);
  });

  it('true when guest confirmed only', () => {
    expect(
      showAttendanceConfirmedPill({ guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z' }),
    ).toBe(true);
  });

  it('true when staff confirmed only', () => {
    expect(
      showAttendanceConfirmedPill({ staff_attendance_confirmed_at: '2026-01-02T12:00:00.000Z' }),
    ).toBe(true);
  });

  it('true when both (edge case 3)', () => {
    expect(
      showAttendanceConfirmedPill({
        guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
        staff_attendance_confirmed_at: '2026-01-02T12:00:00.000Z',
      }),
    ).toBe(true);
  });
});

describe('showAttendanceConfirmedSupplementPill', () => {
  it('false when status is already Confirmed', () => {
    expect(
      showAttendanceConfirmedSupplementPill({
        status: 'Confirmed',
        guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('true when Booked and guest confirmed', () => {
    expect(
      showAttendanceConfirmedSupplementPill({
        status: 'Booked',
        guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('false when nothing confirmed', () => {
    expect(showAttendanceConfirmedSupplementPill({ status: 'Booked' })).toBe(false);
  });
});

describe('canShowConfirmBookingAttendanceAction', () => {
  it('true for pending booking without attendance when not walk-in', () => {
    expect(
      canShowConfirmBookingAttendanceAction({
        status: 'Pending',
        source: 'booking_page',
        guest_attendance_confirmed_at: null,
        staff_attendance_confirmed_at: null,
      }),
    ).toBe(true);
  });

  it('false for walk-in', () => {
    expect(
      canShowConfirmBookingAttendanceAction({
        status: 'Pending',
        source: 'walk-in',
        guest_attendance_confirmed_at: null,
        staff_attendance_confirmed_at: null,
      }),
    ).toBe(false);
  });

  it('false when already confirmed', () => {
    expect(
      canShowConfirmBookingAttendanceAction({
        status: 'Pending',
        source: 'booking_page',
        staff_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('true when guest confirmed but staff has not (status Booked)', () => {
    expect(
      canShowConfirmBookingAttendanceAction({
        status: 'Booked',
        source: 'booking_page',
        guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
        staff_attendance_confirmed_at: null,
      }),
    ).toBe(true);
  });

  it('false when lifecycle status is Confirmed', () => {
    expect(
      canShowConfirmBookingAttendanceAction({
        status: 'Confirmed',
        source: 'booking_page',
        guest_attendance_confirmed_at: null,
        staff_attendance_confirmed_at: null,
      }),
    ).toBe(false);
  });
});

describe('canShowCancelStaffAttendanceConfirmationAction', () => {
  it('true when staff confirmed and not walk-in', () => {
    expect(
      canShowCancelStaffAttendanceConfirmationAction({
        status: 'Confirmed',
        source: 'booking_page',
        staff_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('false when status is Booked and no staff timestamp', () => {
    expect(
      canShowCancelStaffAttendanceConfirmationAction({
        status: 'Booked',
        source: 'booking_page',
        staff_attendance_confirmed_at: null,
      }),
    ).toBe(false);
  });

  it('false when guest confirmed (not staff) — show guest revert UX, not staff', () => {
    expect(
      canShowCancelStaffAttendanceConfirmationAction({
        status: 'Confirmed',
        source: 'booking_page',
        staff_attendance_confirmed_at: null,
        guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      }),
    ).toBe(false);
  });
});

describe('attendanceConfirmationSources', () => {
  it('returns both timestamps when set', () => {
    const r = attendanceConfirmationSources({
      guest_attendance_confirmed_at: '2026-01-01T12:00:00.000Z',
      staff_attendance_confirmed_at: '2026-01-02T12:00:00.000Z',
    });
    expect(r.guestAt).toBe('2026-01-01T12:00:00.000Z');
    expect(r.staffAt).toBe('2026-01-02T12:00:00.000Z');
  });
});
