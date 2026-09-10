import { describe, expect, it } from 'vitest';
import { applyOptimisticStatusToBookingRows, visitSiblingOverlay } from '@/lib/booking/booking-row-overlay';

describe('applyOptimisticStatusToBookingRows', () => {
  const rows = [
    { id: 'a', group_booking_id: 'g', status: 'Confirmed' },
    { id: 'b', group_booking_id: 'g', status: 'Confirmed' },
    { id: 'c', group_booking_id: null, status: 'Confirmed' },
  ];
  const notTable = () => false;

  it('starts one service only', () => {
    const out = applyOptimisticStatusToBookingRows(rows, 'a', 'Seated', notTable);
    expect(out.map((r) => r.status)).toEqual(['Seated', 'Confirmed', 'Confirmed']);
  });

  it('completes one service only', () => {
    const started = rows.map((r) => (r.id === 'a' ? { ...r, status: 'Seated' } : r));
    const out = applyOptimisticStatusToBookingRows(started, 'a', 'Completed', notTable);
    expect(out.map((r) => r.status)).toEqual(['Completed', 'Confirmed', 'Confirmed']);
  });

  it('confirms the whole visit', () => {
    const booked = rows.map((r) => ({ ...r, status: 'Booked' }));
    const out = applyOptimisticStatusToBookingRows(booked, 'a', 'Confirmed', notTable);
    expect(out.map((r) => r.status)).toEqual(['Confirmed', 'Confirmed', 'Booked']);
  });
});

describe('visitSiblingOverlay', () => {
  it('never hands a Start to the other services of the visit', () => {
    const out = visitSiblingOverlay(
      { status: 'Seated', client_arrived_at: null, deposit_status: 'Paid', deposit_amount_pence: 2000 },
      { previous: 'Confirmed', next: 'Seated' },
    );
    expect(out).toEqual({ client_arrived_at: null });
  });

  it('never hands a Complete to the other services of the visit', () => {
    const out = visitSiblingOverlay({ status: 'Completed' }, { previous: 'Seated', next: 'Completed' });
    expect(out).toEqual({});
  });

  it('spreads a Confirm, which is a fact about the whole visit', () => {
    const out = visitSiblingOverlay(
      { status: 'Confirmed', staff_attendance_confirmed_at: '2026-09-10T09:00:00.000Z' },
      { previous: 'Booked', next: 'Confirmed' },
    );
    expect(out).toEqual({
      status: 'Confirmed',
      staff_attendance_confirmed_at: '2026-09-10T09:00:00.000Z',
    });
  });

  it('leaves the status out when the transition is not known', () => {
    const out = visitSiblingOverlay({
      status: 'Seated',
      client_arrived_at: '2026-09-10T09:00:00.000Z',
      guest_attendance_confirmed_at: null,
    });
    expect(out).toEqual({
      client_arrived_at: '2026-09-10T09:00:00.000Z',
      guest_attendance_confirmed_at: null,
    });
  });
});
