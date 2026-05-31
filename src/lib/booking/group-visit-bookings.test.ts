import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyStatusToAllGroupVisitRows,
  formatGroupVisitSegmentDurationLabel,
  groupVisitSegmentsFromList,
  mapGroupVisitListRow,
  mergeGroupVisitRowsWithSeeds,
  multiServiceVisitDatePhrase,
  preferLaterBookingStatus,
  resolveGroupVisitSegmentDisplayStatus,
  resolveVisitPillAnchorStatus,
  groupVisitSegmentPillStatus,
  mergePreferLaterGroupVisitRows,
  applyVisitAttendanceConfirmToGroupVisitRows,
  peekGroupVisitBookings,
  primeGroupVisitBookingsFromListSeeds,
  resolveInitialGroupVisitBookings,
} from '@/lib/booking/group-visit-bookings';

describe('group-visit-bookings cache', () => {
  beforeEach(() => {
    primeGroupVisitBookingsFromListSeeds([]);
  });

  it('primes multi-service groups from list seeds', () => {
    primeGroupVisitBookingsFromListSeeds([
      {
        id: 'a',
        booking_time: '10:00',
        status: 'Booked',
        group_booking_id: 'g1',
        booking_item_name: 'Cut',
      },
      {
        id: 'b',
        booking_time: '11:00',
        status: 'Booked',
        group_booking_id: 'g1',
        booking_item_name: 'Colour',
      },
    ]);
    const cached = peekGroupVisitBookings('g1');
    expect(cached?.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('resolveInitialGroupVisitBookings prefers cached segments', () => {
    primeGroupVisitBookingsFromListSeeds([
      { id: 'a', booking_time: '10:00', status: 'Booked', group_booking_id: 'g2' },
      { id: 'b', booking_time: '11:00', status: 'Booked', group_booking_id: 'g2' },
    ]);
    const initial = resolveInitialGroupVisitBookings([], 'g2');
    expect(initial?.length).toBe(2);
  });

  it('groupVisitSegmentsFromList returns sorted siblings', () => {
    const rows = groupVisitSegmentsFromList(
      [
        { id: 'b', booking_time: '11:00', status: 'Booked', group_booking_id: 'g3' },
        { id: 'a', booking_time: '10:00', status: 'Booked', group_booking_id: 'g3' },
      ],
      'g3',
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('maps wall-clock duration and add-on minutes from list rows', () => {
    const row = mapGroupVisitListRow({
      id: 'x',
      booking_time: '10:00',
      booking_end_time: '10:45',
      status: 'Booked',
      addons_total_duration_minutes: 15,
    });
    expect(row.duration_minutes).toBe(45);
    expect(row.addons_total_duration_minutes).toBe(15);
  });

  it('formats duration with service and extras breakdown', () => {
    expect(
      formatGroupVisitSegmentDurationLabel({
        duration_minutes: 45,
        addons_total_duration_minutes: 15,
      }),
    ).toBe('45 min (30 min service + 15 min extras)');
  });

  it('preferLaterBookingStatus keeps Confirmed over stale Booked', () => {
    expect(preferLaterBookingStatus('Booked', 'Confirmed')).toBe('Confirmed');
    expect(preferLaterBookingStatus('Confirmed', 'Booked')).toBe('Confirmed');
  });

  it('mergeGroupVisitRowsWithSeeds does not downgrade Confirmed segments from stale seeds', () => {
    const rows = [
      {
        id: 'a',
        booking_time: '10:00',
        booking_end_time: null,
        status: 'Confirmed',
        person_label: null,
        booking_item_name: 'Cut',
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: 30,
        addons_total_duration_minutes: 0,
      },
      {
        id: 'b',
        booking_time: '11:00',
        booking_end_time: null,
        status: 'Booked',
        person_label: null,
        booking_item_name: 'Colour',
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: 60,
        addons_total_duration_minutes: 0,
      },
    ];
    const merged = mergeGroupVisitRowsWithSeeds(rows, [
      { id: 'a', status: 'Booked' },
      { id: 'b', status: 'Booked' },
    ]);
    expect(merged[0]!.status).toBe('Confirmed');
    expect(merged[1]!.status).toBe('Booked');
  });

  it('resolveGroupVisitSegmentDisplayStatus lifts siblings to anchor Confirmed', () => {
    expect(resolveGroupVisitSegmentDisplayStatus('Booked', 'Confirmed')).toBe('Confirmed');
  });

  it('groupVisitSegmentPillStatus lifts siblings when visit attendance is confirmed on anchor', () => {
    expect(
      groupVisitSegmentPillStatus(
        { status: 'Booked', staff_attendance_confirmed_at: null, guest_attendance_confirmed_at: null },
        'Booked',
        true,
      ),
    ).toBe('Confirmed');
  });

  it('mergePreferLaterGroupVisitRows keeps Confirmed when fetch returns stale Booked', () => {
    const prev = [
      {
        id: 'a',
        booking_time: '10:00',
        booking_end_time: null,
        status: 'Confirmed',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
      {
        id: 'b',
        booking_time: '11:00',
        booking_end_time: null,
        status: 'Confirmed',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
    ];
    const fetched = [
      { ...prev[0]!, status: 'Confirmed' },
      { ...prev[1]!, status: 'Booked' },
    ];
    const merged = mergePreferLaterGroupVisitRows(prev, fetched);
    expect(merged.every((r) => r.status === 'Confirmed')).toBe(true);
  });

  it('applyVisitAttendanceConfirmToGroupVisitRows confirms every pre-arrival segment', () => {
    const rows = [
      {
        id: 'a',
        booking_time: '10:00',
        booking_end_time: null,
        status: 'Pending',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
      {
        id: 'b',
        booking_time: '11:00',
        booking_end_time: null,
        status: 'Booked',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
    ];
    const next = applyVisitAttendanceConfirmToGroupVisitRows(rows, true);
    expect(next.every((r) => r.status === 'Confirmed')).toBe(true);
  });

  it('mergeGroupVisitRowsWithSeeds updates stale segment statuses from list seeds', () => {
    const rows = [
      {
        id: 'a',
        booking_time: '10:00',
        booking_end_time: null,
        status: 'Booked',
        person_label: null,
        booking_item_name: 'Cut',
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: 30,
        addons_total_duration_minutes: 0,
      },
      {
        id: 'b',
        booking_time: '11:00',
        booking_end_time: null,
        status: 'Booked',
        person_label: null,
        booking_item_name: 'Colour',
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: 60,
        addons_total_duration_minutes: 0,
      },
    ];
    const merged = mergeGroupVisitRowsWithSeeds(rows, [
      { id: 'a', status: 'Confirmed' },
      { id: 'b', status: 'Confirmed' },
    ]);
    expect(merged.every((r) => r.status === 'Confirmed')).toBe(true);
  });

  it('applyStatusToAllGroupVisitRows sets one status on every segment', () => {
    const rows = [
      {
        id: 'a',
        booking_time: '10:00',
        booking_end_time: null,
        status: 'Booked',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
      {
        id: 'b',
        booking_time: '11:00',
        booking_end_time: null,
        status: 'Confirmed',
        person_label: null,
        booking_item_name: null,
        service_variant_name: null,
        booking_addon_labels: [],
        duration_minutes: null,
        addons_total_duration_minutes: 0,
      },
    ];
    const next = applyStatusToAllGroupVisitRows(rows, 'Seated');
    expect(next.map((r) => r.status)).toEqual(['Seated', 'Seated']);
  });

  it('multiServiceVisitDatePhrase omits "on" for today and tomorrow', () => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    expect(multiServiceVisitDatePhrase(todayIso)).toBe('today');
    expect(multiServiceVisitDatePhrase(tomorrowIso)).toBe('tomorrow');
    expect(multiServiceVisitDatePhrase('2020-06-15')).toMatch(/^on /);
  });
});
