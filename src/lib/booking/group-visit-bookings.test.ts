import { describe, expect, it, beforeEach, vi } from 'vitest';
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

  /*
    Runs on a FROZEN clock, against literal dates.

    It used to build "today" with `new Date().toISOString().slice(0, 10)`,
    which is the UTC date, and compare it against a helper that works in LOCAL
    dates (`new Date(`${iso}T12:00:00`)` and `toDateString()`). Those are the
    same string for most of the day and different either side of midnight
    wherever local time is not UTC. It duly failed at 00:01 BST on 2026-08-30:
    UTC was still the 29th, so the test asked for 'on Sat 29 Aug' and demanded
    'today'.

    So this was a real timezone defect in the test, not merely a rollover
    race, and the fix has to remove BOTH. Freezing the clock at each side of
    midnight does that: local dates are stated outright, and the assertion no
    longer depends on when or where the suite is run.
  */
  it('multiServiceVisitDatePhrase omits "on" for today and tomorrow', () => {
    // Local-time constructor on purpose: `new Date(y, m, d)` is local, and
    // local is what the helper compares against.
    const justBeforeMidnight = new Date(2026, 7, 29, 23, 59, 59, 900);
    const justAfterMidnight = new Date(2026, 7, 30, 0, 0, 0, 100);

    for (const [now, today, tomorrow] of [
      [justBeforeMidnight, '2026-08-29', '2026-08-30'],
      [justAfterMidnight, '2026-08-30', '2026-08-31'],
    ] as const) {
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        expect(multiServiceVisitDatePhrase(today), `today at ${now.toISOString()}`).toBe('today');
        expect(multiServiceVisitDatePhrase(tomorrow), `tomorrow at ${now.toISOString()}`).toBe(
          'tomorrow',
        );
        expect(multiServiceVisitDatePhrase('2020-06-15')).toMatch(/^on /);
      } finally {
        vi.useRealTimers();
      }
    }
  });
});

describe('visit pill anchor and terminal outcomes (H8)', () => {
  const seg = (status: string) => ({ id: status, status });
  const pill = (status: string, anchor: string | null, visitConfirmed = false) =>
    groupVisitSegmentPillStatus(
      { status, staff_attendance_confirmed_at: null, guest_attendance_confirmed_at: null },
      anchor,
      visitConfirmed,
    );

  it('one cancelled service does not mark the rest of the visit cancelled', () => {
    // The defect: Cancelled ranks highest of all, the anchor folds every segment
    // through "furthest along wins", and each pill is floored at that anchor, so
    // a single cancelled service rendered every live service as Cancelled.
    const anchor = resolveVisitPillAnchorStatus(
      'Booked',
      [seg('Cancelled'), seg('Booked'), seg('Confirmed')],
      false,
    );
    expect(anchor).toBe('Confirmed');
    expect(pill('Booked', anchor)).toBe('Confirmed');
  });

  it('one no-show does not mark the rest of the visit a no-show', () => {
    const anchor = resolveVisitPillAnchorStatus('Booked', [seg('No-Show'), seg('Booked')], false);
    expect(anchor).toBe('Booked');
    expect(pill('Booked', anchor)).toBe('Booked');
  });

  it('opening the visit on a cancelled segment does not cancel its siblings', () => {
    // The seed matters as much as the fold: it is the expanded row's own status.
    const anchor = resolveVisitPillAnchorStatus('Cancelled', [seg('Booked'), seg('Booked')], false);
    expect(anchor).toBe('Booked');
    expect(pill('Booked', anchor)).toBe('Booked');
  });

  it('keeps a cancelled segment cancelled, whatever the anchor says', () => {
    expect(pill('Cancelled', 'Confirmed')).toBe('Cancelled');
    expect(pill('No-Show', 'Seated')).toBe('No-Show');
    // Attendance lifts must not resurrect a terminal row either.
    expect(pill('Cancelled', 'Booked', true)).toBe('Cancelled');
  });

  it('has no anchor at all when every segment is terminal, so pills show their own status', () => {
    const anchor = resolveVisitPillAnchorStatus(
      'Cancelled',
      [seg('Cancelled'), seg('Cancelled')],
      false,
    );
    expect(anchor).toBeNull();
    expect(pill('Cancelled', anchor)).toBe('Cancelled');
  });

  it('still floors live siblings at the furthest-along live status', () => {
    // The behaviour the anchor exists for must survive: a stale Booked seed is
    // still lifted to Confirmed by a sibling that has got further.
    const anchor = resolveVisitPillAnchorStatus('Booked', [seg('Booked'), seg('Seated')], false);
    expect(anchor).toBe('Seated');
    expect(pill('Booked', anchor)).toBe('Seated');
  });
});
