import { describe, expect, it } from 'vitest';
import { computeBookingForecastAndTodayOps } from './dashboard-home-payload';

/**
 * R36: one guest with two services back to back today read 2 on the home page's
 * "Appointments today" and 1 on the appointments list. A multi-service visit is one booking
 * (Docs/visit-services-independent-plan.md), so every count on the home page now counts it
 * once per day, as the list draws it. Times still come from every service.
 */

type OpsRow = Parameters<typeof computeBookingForecastAndTodayOps>[0]['todayBookings'][number];

function row(id: string, over: Partial<OpsRow> = {}): OpsRow {
  return {
    id,
    booking_date: '2026-09-12',
    booking_time: '10:00:00',
    party_size: 1,
    status: 'Booked',
    group_booking_id: null,
    person_label: null,
    class_instance_id: null,
    ...over,
  };
}

const visit = (id: string, time: string, over: Partial<OpsRow> = {}) =>
  row(id, { booking_time: time, group_booking_id: 'grp-1', ...over });

function ops(todayBookings: OpsRow[], weekBookings: OpsRow[] = todayBookings, nowMinutes = 9 * 60) {
  return computeBookingForecastAndTodayOps({
    todayBookings,
    weekBookingsForOps: weekBookings,
    dateStrs: ['2026-09-12', '2026-09-13'],
    nowMinutes,
  });
}

describe('computeBookingForecastAndTodayOps', () => {
  it('counts a multi-service visit as one appointment', () => {
    const { today, forecast } = ops([visit('cut', '10:00:00'), visit('colour', '10:45:00')]);
    expect(today.bookings).toBe(1);
    expect(forecast[0]).toMatchObject({ date: '2026-09-12', bookings: 1 });
  });

  it("reads the visit's status, not each service's", () => {
    const { today } = ops([
      visit('cut', '10:00:00', { status: 'Seated', staff_attendance_confirmed_at: '2026-09-12T08:00:00Z' }),
      visit('colour', '10:45:00', { status: 'Confirmed', staff_attendance_confirmed_at: '2026-09-12T08:00:00Z' }),
      row('solo', { booking_time: '12:00:00', status: 'Pending' }),
    ]);
    expect(today).toMatchObject({ bookings: 2, seated: 1, confirmed: 1, pending: 1 });
  });

  it('still counts the people of a party, and standalone bookings, one by one', () => {
    const { today } = ops([
      visit('mum', '10:00:00', { person_label: 'Mum' }),
      visit('child', '10:00:00', { person_label: 'Child' }),
      row('solo', { booking_time: '11:00:00' }),
    ]);
    expect(today.bookings).toBe(3);
  });

  it('counts a visit on each day it has services', () => {
    const week = [visit('day1', '10:00:00'), visit('day1b', '11:00:00'), visit('day2', '10:00:00', { booking_date: '2026-09-13' })];
    const { forecast } = ops(week.slice(0, 2), week);
    expect(forecast.map((f) => f.bookings)).toEqual([1, 1]);
  });

  it('keeps every service for the next start time', () => {
    // At 10:15 the visit is under way; its second service at 10:45 is still the next thing to start.
    const { today } = ops([visit('cut', '10:00:00', { status: 'Seated' }), visit('colour', '10:45:00')], undefined, 10 * 60 + 15);
    expect(today.next_booking).toEqual({ time: '10:45', party_size: 1 });
  });
});
