import { describe, it, expect } from 'vitest';
import {
  accountBookingEndMs,
  accountBookingStartMs,
  filterAccountBookings,
  isCancelledAccountStatus,
  isPastBooking,
  isUpcomingBooking,
  parseAccountBookingFilter,
  ACCOUNT_BOOKING_MODEL_LABELS,
  accountBookingModelKey,
  filterAccountBookingsByModel,
  parseAccountBookingModel,
} from '@/lib/account/account-booking-filters';

/**
 * P0-2 acceptance. Every case here fails against the old implementation, which
 * compared a venue wall-clock date against a UTC calendar day and never looked
 * at the time at all.
 */

const row = (over: Partial<Parameters<typeof isPastBooking>[0]> = {}) => ({
  booking_date: '2026-06-15',
  booking_time: '18:00:00',
  booking_end_time: '19:30:00',
  status: 'Confirmed',
  time_zone: 'Europe/London',
  ...over,
});

/** 2026-06-15 14:00 London (BST, UTC+1). */
const LONDON_2PM = Date.parse('2026-06-15T13:00:00Z');

describe('parseAccountBookingFilter', () => {
  it('accepts the two real filters and falls back to all', () => {
    expect(parseAccountBookingFilter(undefined)).toBe('all');
    expect(parseAccountBookingFilter('UPCOMING')).toBe('upcoming');
    expect(parseAccountBookingFilter('past')).toBe('past');
    expect(parseAccountBookingFilter('nope')).toBe('all');
  });
});

describe('time of day decides, not just the date (G5)', () => {
  it('a booking EARLIER TODAY is past', () => {
    // The most visible symptom of the old rule: a customer saw the appointment
    // they attended this morning listed under Upcoming until midnight.
    const morning = row({ booking_time: '09:00:00', booking_end_time: '10:00:00' });
    expect(isPastBooking(morning, LONDON_2PM)).toBe(true);
    expect(isUpcomingBooking(morning, LONDON_2PM)).toBe(false);
  });

  it('a booking LATER TODAY is upcoming', () => {
    expect(isUpcomingBooking(row(), LONDON_2PM)).toBe(true);
    expect(isPastBooking(row(), LONDON_2PM)).toBe(false);
  });

  it('a booking IN PROGRESS is upcoming, not past', () => {
    // The end instant rather than the start is what makes this true: someone
    // sitting in the chair has not had a past appointment.
    const inProgress = row({ booking_time: '13:30:00', booking_end_time: '14:30:00' });
    expect(isUpcomingBooking(inProgress, LONDON_2PM)).toBe(true);
  });

  it('a booking with no end time flips at its start', () => {
    const noEnd = row({ booking_time: '13:00:00', booking_end_time: null });
    expect(isPastBooking(noEnd, LONDON_2PM)).toBe(true);
    expect(isUpcomingBooking({ ...noEnd, booking_time: '15:00:00' }, LONDON_2PM)).toBe(true);
  });

  it('handles a booking that runs past midnight', () => {
    const overnight = row({ booking_time: '23:00:00', booking_end_time: '01:00:00' });
    const end = accountBookingEndMs(overnight);
    expect(end).toBeGreaterThan(accountBookingStartMs(overnight));
    expect(end - accountBookingStartMs(overnight)).toBe(2 * 60 * 60 * 1000);
  });
});

describe('the venue timezone decides, not the server (G5)', () => {
  it('Australia/Sydney: still upcoming when UTC has already rolled over', () => {
    // 2026-06-16 08:00 in Sydney (UTC+10) is 2026-06-15 22:00 UTC. The old rule
    // compared booking_date '2026-06-16' against the UTC day '2026-06-15' and
    // called it upcoming by luck; an hour later, at 2026-06-16 00:30 UTC, a
    // booking on the 15th Sydney time that had already finished was STILL
    // upcoming, because the UTC day had not caught up.
    const sydney = row({
      booking_date: '2026-06-15',
      booking_time: '09:00:00',
      booking_end_time: '10:00:00',
      time_zone: 'Australia/Sydney',
    });
    // 2026-06-15 23:00 UTC is 2026-06-16 09:00 in Sydney: it is over.
    expect(isPastBooking(sydney, Date.parse('2026-06-15T23:00:00Z'))).toBe(true);
    // 2026-06-14 23:00 UTC is 2026-06-15 09:00 in Sydney: it is happening.
    expect(isUpcomingBooking(sydney, Date.parse('2026-06-14T23:30:00Z'))).toBe(true);
  });

  it('America/Los_Angeles: not yet past when UTC is already tomorrow', () => {
    // 2026-06-15 19:00 in Los Angeles (PDT, UTC-7) is 2026-06-16 02:00 UTC.
    // The old rule saw the UTC day as the 16th, the booking date as the 15th,
    // and filed a booking two hours away under Past.
    const la = row({
      booking_date: '2026-06-15',
      booking_time: '21:00:00',
      booking_end_time: '22:00:00',
      time_zone: 'America/Los_Angeles',
    });
    const utcAlreadyTomorrow = Date.parse('2026-06-16T02:00:00Z'); // 19:00 in LA
    expect(isUpcomingBooking(la, utcAlreadyTomorrow)).toBe(true);
    expect(isPastBooking(la, utcAlreadyTomorrow)).toBe(false);
  });

  it('reads the zone off venue.timezone when time_zone is absent', () => {
    const legacy = {
      booking_date: '2026-06-15',
      booking_time: '09:00:00',
      booking_end_time: '10:00:00',
      status: 'Confirmed',
      venue: { timezone: 'Australia/Sydney' },
    };
    expect(isPastBooking(legacy, Date.parse('2026-06-15T23:00:00Z'))).toBe(true);
  });

  it('falls back rather than throwing on an unusable stored zone (G23)', () => {
    // A customer who saved 'GMT+1' before validation existed must still be able
    // to load the page. It degrades to the fallback, then to London.
    const broken = row({ time_zone: 'GMT+1' });
    expect(() => accountBookingStartMs(broken)).not.toThrow();
    expect(accountBookingStartMs(broken)).toBe(Date.parse('2026-06-15T17:00:00Z'));
  });
});

describe('status classification (G5a)', () => {
  it('treats Completed as past even when the clock says otherwise', () => {
    const completed = row({ booking_date: '2026-12-25', status: 'Completed' });
    expect(isPastBooking(completed, LONDON_2PM)).toBe(true);
    expect(isUpcomingBooking(completed, LONDON_2PM)).toBe(false);
  });

  it('treats all five cancelled spellings as past, today or in the future', () => {
    // The database has all of these. Matching only the exact string 'Cancelled'
    // left the other four showing as upcoming bookings a customer no longer has.
    for (const status of ['Cancelled', 'Canceled', 'No-Show', 'NoShow', 'No Show']) {
      const future = row({ booking_date: '2026-12-25', status });
      expect(isPastBooking(future, LONDON_2PM), status).toBe(true);
      expect(isUpcomingBooking(future, LONDON_2PM), status).toBe(false);
      expect(isCancelledAccountStatus(status), status).toBe(true);
    }
    expect(isCancelledAccountStatus('Confirmed')).toBe(false);
    expect(isCancelledAccountStatus('Completed')).toBe(false);
    expect(isCancelledAccountStatus(null)).toBe(false);
  });

  it('keeps a live status upcoming when it is genuinely in the future', () => {
    expect(isUpcomingBooking(row({ booking_date: '2026-12-25' }), LONDON_2PM)).toBe(true);
  });
});

describe('filterAccountBookings', () => {
  const rows = [
    { ...row({ booking_date: '2026-12-25' }), id: 'future' },
    { ...row({ booking_date: '2026-01-10' }), id: 'past-date' },
    { ...row({ booking_time: '09:00:00', booking_end_time: '10:00:00' }), id: 'earlier-today' },
    { ...row(), id: 'later-today' },
    { ...row({ booking_date: '2026-12-25', status: 'Cancelled' }), id: 'cancelled' },
    { ...row({ booking_date: '2026-12-25', status: 'Completed' }), id: 'completed' },
  ];

  it('splits on instants and terminal statuses', () => {
    expect(filterAccountBookings(rows, 'all', LONDON_2PM)).toHaveLength(6);
    expect(filterAccountBookings(rows, 'upcoming', LONDON_2PM).map((r) => r.id)).toEqual([
      'future',
      'later-today',
    ]);
    expect(filterAccountBookings(rows, 'past', LONDON_2PM).map((r) => r.id)).toEqual([
      'past-date',
      'earlier-today',
      'cancelled',
      'completed',
    ]);
  });

  it('partitions: every row is in exactly one of upcoming and past', () => {
    const up = filterAccountBookings(rows, 'upcoming', LONDON_2PM).length;
    const past = filterAccountBookings(rows, 'past', LONDON_2PM).length;
    expect(up + past).toBe(rows.length);
  });
});

describe('DST', () => {
  it('uses the offset in force on the booking day, not today', () => {
    // 12:00 on a GMT day and 12:00 on a BST day are an hour apart in UTC.
    const winter = accountBookingStartMs(
      row({ booking_date: '2026-01-15', booking_time: '12:00:00' }),
    );
    const summer = accountBookingStartMs(
      row({ booking_date: '2026-07-15', booking_time: '12:00:00' }),
    );
    expect(winter).toBe(Date.parse('2026-01-15T12:00:00Z'));
    expect(summer).toBe(Date.parse('2026-07-15T11:00:00Z'));
  });
});

/**
 * The type filter that replaced `/account/events` and `/account/resources`
 * (P1-3).
 *
 * Two pages became one filter, so the filter now carries what those pages
 * guaranteed. The case that matters most is `unified_scheduling`: it is the
 * model every venue on the platform actually uses, and a filter that knew only
 * `practitioner_appointment` would show a customer an empty "Appointments" view
 * while their appointments sat one pill away under "All".
 */
describe('the booking type filter', () => {
  const row = (booking_model: string) => ({ booking_model });

  it('accepts every key it offers a pill for', () => {
    for (const { id } of ACCOUNT_BOOKING_MODEL_LABELS) {
      expect(parseAccountBookingModel(id)).toBe(id);
    }
  });

  it('falls back to all rather than throwing on an unknown or missing key', () => {
    expect(parseAccountBookingModel('event_ticket')).toBe('all');
    expect(parseAccountBookingModel('vouchers')).toBe('all');
    expect(parseAccountBookingModel('')).toBe('all');
    expect(parseAccountBookingModel(undefined)).toBe('all');
    expect(parseAccountBookingModel(null)).toBe('all');
    expect(parseAccountBookingModel('all')).toBe('all');
  });

  it('takes the first recognised value from a repeated param', () => {
    expect(parseAccountBookingModel(['event', 'class'])).toBe('event');
    expect(parseAccountBookingModel(['nonsense', 'class'])).toBe('class');
  });

  it('is case and whitespace tolerant, since these keys are shared in URLs', () => {
    expect(parseAccountBookingModel(' Event ')).toBe('event');
  });

  it('groups BOTH appointment models under one key', () => {
    // `unified_scheduling` is what every venue on the platform books through;
    // `practitioner_appointment` is the older shape. The split is internal, and
    // `bookingModelShortLabel` already prints both as "Appointment".
    expect(accountBookingModelKey('unified_scheduling')).toBe('appointment');
    expect(accountBookingModelKey('practitioner_appointment')).toBe('appointment');

    const rows = [row('unified_scheduling'), row('practitioner_appointment'), row('class_session')];
    expect(filterAccountBookingsByModel(rows, 'appointment')).toHaveLength(2);
  });

  it('maps each stored model to the key whose pill claims it', () => {
    expect(accountBookingModelKey('event_ticket')).toBe('event');
    expect(accountBookingModelKey('resource_booking')).toBe('resource');
    expect(accountBookingModelKey('class_session')).toBe('class');
    expect(accountBookingModelKey('table_reservation')).toBe('table');
    expect(accountBookingModelKey('something_new')).toBeNull();
    expect(accountBookingModelKey(null)).toBeNull();
  });

  it('selects only the model asked for', () => {
    const rows = [
      row('event_ticket'),
      row('resource_booking'),
      row('class_session'),
      row('table_reservation'),
      row('unified_scheduling'),
    ];
    expect(filterAccountBookingsByModel(rows, 'event')).toEqual([row('event_ticket')]);
    expect(filterAccountBookingsByModel(rows, 'resource')).toEqual([row('resource_booking')]);
    expect(filterAccountBookingsByModel(rows, 'all')).toHaveLength(5);
  });

  it('partitions: every recognised row lands in exactly one pill', () => {
    // A stored model that no key claims would otherwise be invisible under
    // every filter except All, which is how a new booking model would silently
    // disappear from a customer's list.
    const rows = ACCOUNT_BOOKING_MODEL_LABELS.flatMap(() => []) as Array<{ booking_model: string }>;
    const all = [
      'event_ticket',
      'resource_booking',
      'class_session',
      'table_reservation',
      'unified_scheduling',
      'practitioner_appointment',
    ].map(row);
    rows.push(...all);

    const counted = ACCOUNT_BOOKING_MODEL_LABELS.reduce(
      (sum, { id }) => sum + filterAccountBookingsByModel(rows, id).length,
      0,
    );
    expect(counted).toBe(all.length);
  });

  it('drops a row whose model no pill claims, rather than showing it under one', () => {
    const rows = [row('event_ticket'), row('something_new')];
    for (const { id } of ACCOUNT_BOOKING_MODEL_LABELS) {
      expect(filterAccountBookingsByModel(rows, id).map((r) => r.booking_model)).not.toContain(
        'something_new',
      );
    }
    expect(filterAccountBookingsByModel(rows, 'all')).toHaveLength(2);
  });

  it('offers a label for every key and no duplicates', () => {
    const ids = ACCOUNT_BOOKING_MODEL_LABELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ACCOUNT_BOOKING_MODEL_LABELS.map((m) => m.label)).size).toBe(ids.length);
    expect(ids).toEqual(['appointment', 'class', 'event', 'resource', 'table']);
  });
});
