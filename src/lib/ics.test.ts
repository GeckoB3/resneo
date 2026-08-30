import { describe, it, expect } from 'vitest';
import { buildIcsContent } from '@/lib/ics';
import { buildGoogleCalendarAddUrlForBooking } from '@/lib/emails/calendar-links';

/**
 * `.ics` generation, which had no test at all.
 *
 * The defect this file exists to pin: a booking's date and time are the
 * VENUE's wall clock, and this helper read them as UTC. A 14:00 appointment at
 * a London venue went into the guest's calendar at 15:00 for the whole of
 * British Summer Time, every year, for every booking made through the
 * confirmation step. Nothing failed; the file was valid, the time was wrong.
 *
 * `buildGoogleCalendarAddUrlForBooking` resolved the zone correctly all along,
 * so ResNeo's two "add to calendar" affordances disagreed about the same
 * booking. The last test here is the one that keeps them together.
 */

/** `DTSTART:20260610T130000Z` -> `2026-06-10T13:00:00Z` */
function dtstart(ics: string): string {
  const m = /DTSTART:(\d{8}T\d{6}Z)/.exec(ics);
  if (!m) throw new Error(`no DTSTART in:\n${ics}`);
  return m[1];
}

function dtend(ics: string): string {
  const m = /DTEND:(\d{8}T\d{6}Z)/.exec(ics);
  if (!m) throw new Error(`no DTEND in:\n${ics}`);
  return m[1];
}

const base = {
  venueName: 'Frozen Venue',
  venueAddress: '1 Frozen Street',
  bookingDate: '2026-06-10',
  bookingTime: '14:00',
  partySize: 2,
  timeZone: 'Europe/London',
};

describe('the start instant', () => {
  it('reads the wall clock in the venue zone, not as UTC', () => {
    // 10 June is BST, so 14:00 London is 13:00 UTC. Before the fix this said
    // 14:00Z, which is 15:00 in the guest's own calendar.
    expect(dtstart(buildIcsContent(base))).toBe('20260610T130000Z');
  });

  it('follows the same venue through a DST change', () => {
    // January is GMT, so the same wall-clock time is a different instant. A
    // helper that applied one fixed offset would get exactly one of these two
    // right, which is what a spot check at the wrong time of year would miss.
    const winter = buildIcsContent({ ...base, bookingDate: '2026-01-14' });
    expect(dtstart(winter)).toBe('20260114T140000Z');
    expect(dtstart(buildIcsContent(base))).toBe('20260610T130000Z');
  });

  it('respects a venue in another zone entirely', () => {
    const sydney = buildIcsContent({ ...base, timeZone: 'Australia/Sydney' });
    // 14:00 on 10 June in Sydney (AEST, UTC+10) is 04:00 UTC.
    expect(dtstart(sydney)).toBe('20260610T040000Z');
  });
});

describe('a timezone the venue typed by hand', () => {
  it('degrades to a usable file rather than throwing', () => {
    // `venues.timezone` is free text (G23 records four portal routes that
    // crashed on exactly this). Making the zone required must not turn a wrong
    // time into a button that throws when a guest clicks it.
    for (const bad of ['GMT+1', 'London', 'UK', '', '   ']) {
      expect(() => buildIcsContent({ ...base, timeZone: bad }), bad).not.toThrow();
      // And it still produces a usable file rather than a broken one.
      expect(dtstart(buildIcsContent({ ...base, timeZone: bad }))).toMatch(/^\d{8}T\d{6}Z$/);
    }
  });
});

describe('the length', () => {
  it('uses the real duration when the caller knows it', () => {
    const ics = buildIcsContent({ ...base, durationMinutes: 45 });
    expect(dtstart(ics)).toBe('20260610T130000Z');
    expect(dtend(ics)).toBe('20260610T134500Z');
  });

  it('falls back per booking model, not to a flat guess', () => {
    // An appointment is an hour and an event is three; the flat 90 minutes this
    // used to apply was wrong for both.
    expect(dtend(buildIcsContent({ ...base, bookingModel: 'unified_scheduling' }))).toBe(
      '20260610T140000Z',
    );
    expect(dtend(buildIcsContent({ ...base, bookingModel: 'event_ticket' }))).toBe(
      '20260610T160000Z',
    );
  });

  it('caps an implausible duration rather than emitting a week-long event', () => {
    const ics = buildIcsContent({ ...base, durationMinutes: 60 * 24 * 7 });
    expect(dtend(ics)).toBe('20260611T130000Z');
  });
});

describe('the file itself', () => {
  it('is a single well-formed VEVENT', () => {
    const ics = buildIcsContent(base);
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    // CRLF is required by RFC 5545, and some calendar clients are strict.
    expect(ics).toContain('\r\n');
  });

  it('escapes a venue name that would otherwise break the format', () => {
    const ics = buildIcsContent({ ...base, venueName: 'Smith, Jones; Co' });
    expect(ics).toContain('SUMMARY:Reservation at Smith\\, Jones\\; Co');
  });

  it('omits the location line rather than emitting an empty one', () => {
    expect(buildIcsContent({ ...base, venueAddress: null })).not.toContain('LOCATION:');
  });
});

describe('the two add-to-calendar affordances agree', () => {
  it('on the start instant and the length, for the same booking', () => {
    // The whole point. A guest offered both a Google link and an .ics file
    // should not be able to tell which one they used from the result.
    const ics = buildIcsContent({ ...base, bookingModel: 'unified_scheduling' });
    const googleUrl = buildGoogleCalendarAddUrlForBooking(
      {
        id: 'b1',
        booking_date: base.bookingDate,
        booking_time: base.bookingTime,
        party_size: base.partySize,
        guest_name: '',
        guest_email: '',
        guest_phone: '',
        booking_model: 'unified_scheduling',
      } as unknown as Parameters<typeof buildGoogleCalendarAddUrlForBooking>[0],
      {
        name: base.venueName,
        address: base.venueAddress,
        timezone: base.timeZone,
      } as unknown as Parameters<typeof buildGoogleCalendarAddUrlForBooking>[1],
    );

    expect(googleUrl, 'the Google link should have been buildable').toBeTruthy();
    const dates = new URL(googleUrl!).searchParams.get('dates');
    expect(dates, 'no dates parameter').toBeTruthy();

    const [googleStart, googleEnd] = dates!.split('/');
    expect(dtstart(ics)).toBe(googleStart);
    expect(dtend(ics)).toBe(googleEnd);
  });

  it('and would have disagreed before this was shared', () => {
    // A guard on the guard: if both helpers were somehow returning the same
    // wrong thing, the agreement test above would pass while both were broken.
    // 14:00 London in June is 13:00 UTC and nothing else.
    expect(dtstart(buildIcsContent(base))).not.toBe('20260610T140000Z');
  });
});
