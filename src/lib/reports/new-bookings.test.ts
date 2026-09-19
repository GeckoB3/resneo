import { describe, expect, it } from 'vitest';
import {
  aggregateNewBookings,
  buildNewBookingsSummary,
  classifyNewBookings,
  countNewBookings,
  daysSpanned,
  loadNewBookingUnits,
  localDayWindowUtc,
  newBookingChannel,
  newBookingUnitKey,
  resolveNewBookingsPreset,
  type NewBookingRow,
  type NewBookingUnit,
} from './new-bookings';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

const TZ = 'Europe/London';

function row(id: string, over: Partial<NewBookingRow> = {}): NewBookingRow {
  return {
    id,
    // 10:00 BST on Saturday 19 September 2026.
    created_at: '2026-09-19T09:00:00.000Z',
    status: 'Booked',
    source: 'booking_page',
    cancellation_actor_type: null,
    created_by_staff_id: null,
    created_by_linked_venue_id: null,
    group_booking_id: null,
    person_label: null,
    class_instance_id: null,
    class_recurring_reservation_id: null,
    ...over,
  };
}

function unit(day: string, over: Partial<NewBookingUnit> = {}): NewBookingUnit {
  return { key: `row:${day}:${Math.random()}`, day, channel: 'online', state: 'active', rows: [], ...over };
}

describe('newBookingUnitKey', () => {
  it('keys the services of a visit together and everything else per row', () => {
    expect(newBookingUnitKey(row('a'))).toBe('row:a');
    expect(newBookingUnitKey(row('a', { group_booking_id: 'g1' }))).toBe('visit:g1');
    // A party: one person per row, each its own booking, as the list draws it.
    expect(newBookingUnitKey(row('a', { group_booking_id: 'g1', person_label: 'Guest 2' }))).toBe('row:a');
    // A class cart: one class per row.
    expect(newBookingUnitKey(row('a', { group_booking_id: 'g1', class_instance_id: 'ci' }))).toBe('row:a');
    expect(
      newBookingUnitKey(row('a', { class_instance_id: 'ci', class_recurring_reservation_id: 'r1' })),
    ).toBe('recurring:r1');
  });
});

describe('newBookingChannel', () => {
  it('reads how each booking came in', () => {
    expect(newBookingChannel(row('a', { source: 'booking_page' }))).toBe('online');
    expect(newBookingChannel(row('a', { source: 'widget' }))).toBe('online');
    expect(newBookingChannel(row('a', { source: 'online' }))).toBe('online');
    expect(newBookingChannel(row('a', { source: 'phone', created_by_staff_id: 's1' }))).toBe('team');
    expect(newBookingChannel(row('a', { source: 'walk-in' }))).toBe('walk_in');
  });

  it('puts a booking a linked venue made on your calendar under the linked venue', () => {
    expect(newBookingChannel(row('a', { source: 'phone', created_by_linked_venue_id: 'v2' }))).toBe('linked_venue');
  });

  it('falls back on who made it for a source it does not know', () => {
    expect(newBookingChannel(row('a', { source: null, created_by_staff_id: 's1' }))).toBe('team');
    expect(newBookingChannel(row('a', { source: null }))).toBe('online');
  });
});

describe('classifyNewBookings', () => {
  const classify = (rows: NewBookingRow[], opts: Parameters<typeof classifyNewBookings>[1] = { timeZone: TZ }) =>
    classifyNewBookings(rows, opts);

  it('counts a multi-service visit once, on the day its first service was made', () => {
    const units = classify([
      row('s2', { group_booking_id: 'g1', created_at: '2026-09-19T09:05:00.000Z' }),
      // 23:30 BST on the 18th: the visit was made on the 18th.
      row('s1', { group_booking_id: 'g1', created_at: '2026-09-18T22:30:00.000Z' }),
      row('solo'),
    ]);
    expect(units).toHaveLength(2);
    expect(units.find((u) => u.key === 'visit:g1')).toMatchObject({ day: '2026-09-18', state: 'active' });
  });

  it('counts each person in a party and each class in a cart', () => {
    const units = classify([
      row('p1', { group_booking_id: 'party', person_label: 'Guest 1' }),
      row('p2', { group_booking_id: 'party', person_label: 'Guest 2' }),
      row('c1', { group_booking_id: 'cart', class_instance_id: 'ci-1' }),
      row('c2', { group_booking_id: 'cart', class_instance_id: 'ci-2' }),
    ]);
    expect(units).toHaveLength(4);
  });

  it('counts a standing class reservation once', () => {
    const units = classify([
      row('r1', { class_instance_id: 'ci-1', class_recurring_reservation_id: 'res' }),
      row('r2', { class_instance_id: 'ci-2', class_recurring_reservation_id: 'res' }),
    ]);
    expect(units).toHaveLength(1);
  });

  it('leaves out imports, collective move copies, and additions to older bookings', () => {
    const units = classify(
      [
        row('imported', { source: 'import' }),
        row('moved', { source: 'phone' }),
        row('added', { group_booking_id: 'old-visit' }),
        row('next-session', { class_instance_id: 'ci', class_recurring_reservation_id: 'old-res' }),
        row('kept'),
      ],
      {
        timeZone: TZ,
        movedInIds: new Set(['moved']),
        startedEarlier: new Set(['visit:old-visit', 'recurring:old-res']),
      },
    );
    expect(units.map((u) => u.key)).toEqual(['row:kept']);
  });

  it('keeps cancelled bookings in, marks payment lapses, and holds back unpaid ones', () => {
    const units = classify([
      row('cancelled', { status: 'Cancelled', cancellation_actor_type: 'customer' }),
      row('staff-cancelled', { status: 'Cancelled', cancellation_actor_type: 'staff' }),
      row('lapsed', { status: 'Cancelled', cancellation_actor_type: 'system' }),
      row('pending', { status: 'Pending' }),
      row('seen', { status: 'Completed' }),
      row('no-show', { status: 'No-Show' }),
    ]);
    const byKey = Object.fromEntries(units.map((u) => [u.key, u.state]));
    expect(byKey).toEqual({
      'row:cancelled': 'cancelled',
      'row:staff-cancelled': 'cancelled',
      'row:lapsed': 'lapsed',
      'row:pending': 'pending',
      'row:seen': 'active',
      'row:no-show': 'active',
    });
    // A lapse is returned for the Overview's Auto (unpaid) tile, but counts nowhere here.
    expect(countNewBookings(units, '2026-09-19', '2026-09-19')).toMatchObject({
      total: 4,
      cancelled: 2,
      awaiting_payment: 1,
    });
  });

  it('keeps each booking\'s rows, the first one made at the front', () => {
    const units = classify([
      row('s2', { group_booking_id: 'g1', created_at: '2026-09-19T09:05:00.000Z', source: 'phone' }),
      row('s1', { group_booking_id: 'g1', created_at: '2026-09-19T09:00:00.000Z', source: 'booking_page' }),
    ]);
    expect(units).toHaveLength(1);
    expect(units[0]!.rows.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(units[0]!.channel).toBe('online');
  });

  it('treats a visit as on the books while any service is, and cancelled only when all are', () => {
    const units = classify([
      row('a1', { group_booking_id: 'part', status: 'Cancelled', cancellation_actor_type: 'staff' }),
      row('a2', { group_booking_id: 'part', status: 'Booked' }),
      row('b1', { group_booking_id: 'all', status: 'Cancelled', cancellation_actor_type: 'customer' }),
      row('b2', { group_booking_id: 'all', status: 'Cancelled', cancellation_actor_type: 'customer' }),
    ]);
    expect(Object.fromEntries(units.map((u) => [u.key, u.state]))).toEqual({
      'visit:part': 'active',
      'visit:all': 'cancelled',
    });
  });

  it('dates by the venue clock, in summer and in winter', () => {
    const [summer] = classify([row('a', { created_at: '2026-09-18T23:30:00.000Z' })]);
    expect(summer!.day).toBe('2026-09-19');
    const [winter] = classify([row('b', { created_at: '2026-01-18T23:30:00.000Z' })]);
    expect(winter!.day).toBe('2026-01-18');
  });
});

describe('countNewBookings and aggregateNewBookings', () => {
  const units: NewBookingUnit[] = [
    unit('2026-09-14', { channel: 'online' }),
    unit('2026-09-14', { channel: 'team', state: 'cancelled' }),
    unit('2026-09-16', { channel: 'walk_in' }),
    unit('2026-09-19', { channel: 'linked_venue' }),
    unit('2026-09-19', { channel: 'online', state: 'pending' }),
    // Payment lapses count nowhere on this tab.
    unit('2026-09-19', { channel: 'online', state: 'lapsed' }),
    unit('2026-09-20', { channel: 'online' }),
  ];

  it('counts inside the range only, with awaiting payment beside the total', () => {
    expect(countNewBookings(units, '2026-09-14', '2026-09-19')).toEqual({
      total: 4,
      by_channel: { online: 1, team: 1, walk_in: 1, linked_venue: 1 },
      cancelled: 1,
      awaiting_payment: 1,
    });
  });

  it('gives every day a row, quiet days included', () => {
    const report = aggregateNewBookings({ units, from: '2026-09-14', to: '2026-09-19', grain: 'day', today: '2026-09-19' });
    expect(report.periods.map((p) => [p.period_start, p.total])).toEqual([
      ['2026-09-14', 2],
      ['2026-09-15', 0],
      ['2026-09-16', 1],
      ['2026-09-17', 0],
      ['2026-09-18', 0],
      ['2026-09-19', 1],
    ]);
    expect(report.totals.total).toBe(4);
    expect(report.totals.awaiting_payment).toBe(1);
  });

  it('clamps week periods to the range', () => {
    const report = aggregateNewBookings({ units, from: '2026-09-10', to: '2026-09-20', grain: 'week', today: '2026-09-19' });
    expect(report.periods.map((p) => [p.period_start, p.period_end, p.total])).toEqual([
      ['2026-09-10', '2026-09-13', 0],
      ['2026-09-14', '2026-09-20', 5],
    ]);
  });
});

describe('resolveNewBookingsPreset', () => {
  it('resolves from the venue today (a Saturday), running the current week and month to today', () => {
    const today = '2026-09-19';
    expect(resolveNewBookingsPreset('today', today)).toEqual({ from: today, to: today });
    expect(resolveNewBookingsPreset('yesterday', today)).toEqual({ from: '2026-09-18', to: '2026-09-18' });
    expect(resolveNewBookingsPreset('this_week', today)).toEqual({ from: '2026-09-14', to: today });
    expect(resolveNewBookingsPreset('last_week', today)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(resolveNewBookingsPreset('this_month', today)).toEqual({ from: '2026-09-01', to: today });
    expect(resolveNewBookingsPreset('last_month', today)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('handles a Monday and a January', () => {
    expect(resolveNewBookingsPreset('this_week', '2026-09-14')).toEqual({ from: '2026-09-14', to: '2026-09-14' });
    expect(resolveNewBookingsPreset('last_week', '2026-09-14')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(resolveNewBookingsPreset('last_month', '2027-01-15')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('localDayWindowUtc', () => {
  it('bounds venue-local days, including the 25-hour day the clocks go back', () => {
    expect(localDayWindowUtc('2026-09-19', '2026-09-19', TZ)).toEqual({
      startIso: '2026-09-18T23:00:00.000Z',
      endIso: '2026-09-19T23:00:00.000Z',
    });
    expect(localDayWindowUtc('2026-10-25', '2026-10-25', TZ)).toEqual({
      startIso: '2026-10-24T23:00:00.000Z',
      endIso: '2026-10-26T00:00:00.000Z',
    });
  });

  it('counts whole days spanned', () => {
    expect(daysSpanned('2026-09-19', '2026-09-19')).toBe(1);
    expect(daysSpanned('2026-09-01', '2026-09-30')).toBe(30);
  });
});

describe('loadNewBookingUnits', () => {
  const filterValue = (call: RecordedCall, op: string, column: string) =>
    call.filters.find((f) => f[0] === op && f[1] === column)?.[2];

  it('loads the venue-local window, then drops move copies and additions to older visits', async () => {
    const created: NewBookingRow[] = [
      row('solo'),
      row('moved-copy'),
      row('added-service', { group_booking_id: 'old-visit' }),
      row('new-visit-1', { group_booking_id: 'new-visit' }),
      row('new-visit-2', { group_booking_id: 'new-visit' }),
    ];
    const { db, calls } = makeRecordingDb((call) => {
      if (call.table === 'bookings' && call.columns?.startsWith('id, created_at')) return { data: created };
      if (call.table === 'events') return { data: [{ booking_id: 'moved-copy' }] };
      if (call.table === 'bookings' && call.columns === 'group_booking_id') {
        const ids = filterValue(call, 'in', 'group_booking_id') as string[];
        return { data: ids.includes('old-visit') ? [{ group_booking_id: 'old-visit' }] : [] };
      }
      return undefined;
    });

    const units = await loadNewBookingUnits(db, {
      venueId: 'v1',
      timeZone: TZ,
      from: '2026-09-19',
      to: '2026-09-19',
    });

    expect(units.map((u) => u.key).sort()).toEqual(['row:solo', 'visit:new-visit']);
    const main = calls.find((c) => c.table === 'bookings' && c.columns?.startsWith('id, created_at'))!;
    expect(filterValue(main, 'eq', 'venue_id')).toBe('v1');
    expect(filterValue(main, 'gte', 'created_at')).toBe('2026-09-18T23:00:00.000Z');
    expect(filterValue(main, 'lt', 'created_at')).toBe('2026-09-19T23:00:00.000Z');
    const events = calls.find((c) => c.table === 'events')!;
    expect(filterValue(events, 'eq', 'event_type')).toBe('booking_moved_in');
    const earlier = calls.find((c) => c.columns === 'group_booking_id')!;
    expect(filterValue(earlier, 'lt', 'created_at')).toBe('2026-09-18T23:00:00.000Z');
    expect((filterValue(earlier, 'in', 'group_booking_id') as string[]).sort()).toEqual(['new-visit', 'old-visit']);
  });

  it('reads every page of a busy window', async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => row(`b${start + i}`));
    const { db } = makeRecordingDb((call) => {
      if (call.table !== 'bookings') return undefined;
      const range = call.filters.find((f) => f[0] === 'range') as [string, number, number];
      return { data: range[1] === 0 ? page(0, 1000) : page(1000, 250) };
    });
    const units = await loadNewBookingUnits(db, { venueId: 'v1', timeZone: TZ, from: '2026-09-19', to: '2026-09-19' });
    expect(units).toHaveLength(1250);
  });

  it('throws when the read fails, so the caller can decide', async () => {
    const { db } = makeRecordingDb((call) =>
      call.table === 'bookings' ? { error: { message: 'boom' } } : undefined,
    );
    await expect(
      loadNewBookingUnits(db, { venueId: 'v1', timeZone: TZ, from: '2026-09-19', to: '2026-09-19' }),
    ).rejects.toThrow('boom');
  });
});

describe('buildNewBookingsSummary', () => {
  it('reads from the earlier of Monday and the 1st, and splits today, week and month', async () => {
    // Wednesday 2 September 2026: the week began on Monday 31 August, in the previous month.
    const created: NewBookingRow[] = [
      row('aug-31', { created_at: '2026-08-31T09:00:00.000Z' }),
      row('sep-01', { created_at: '2026-09-01T09:00:00.000Z' }),
      row('today-1', { created_at: '2026-09-02T08:00:00.000Z' }),
      row('today-2', { created_at: '2026-09-02T15:00:00.000Z', source: 'phone', created_by_staff_id: 's1' }),
    ];
    const { db, calls } = makeRecordingDb((call) => {
      if (call.table === 'bookings' && call.columns?.startsWith('id, created_at')) return { data: created };
      return undefined;
    });
    const summary = await buildNewBookingsSummary(db, { venueId: 'v1', timeZone: TZ, today: '2026-09-02' });
    expect(summary.week_start).toBe('2026-08-31');
    expect(summary.month_start).toBe('2026-09-01');
    const main = calls.find((c) => c.table === 'bookings')!;
    expect(main.filters.find((f) => f[0] === 'gte')?.[2]).toBe('2026-08-30T23:00:00.000Z');
    expect(main.filters.find((f) => f[0] === 'lt')?.[2]).toBe('2026-09-02T23:00:00.000Z');
    expect(summary.today.total).toBe(2);
    expect(summary.today.by_channel).toMatchObject({ online: 1, team: 1 });
    expect(summary.this_week.total).toBe(4);
    expect(summary.this_month.total).toBe(3);
  });
});
