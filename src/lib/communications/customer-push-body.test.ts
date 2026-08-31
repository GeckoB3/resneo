/**
 * The lock-screen copy (P5-2).
 *
 * Worth testing rather than reviewing because of where it is read: a push body
 * appears on a locked phone, in front of whoever is near it, and it is the one
 * customer-facing string in this repo that nobody can proof-read in place.
 */
import { describe, it, expect } from 'vitest';
import {
  bookingChangedPushBody,
  reminderPushBody,
  waitlistOfferPushBody,
} from './customer-push-body';

const ALL_BODIES = [
  reminderPushBody({ venueName: 'The Studio', bookingDate: '2026-09-01', bookingTime: '10:00:00' }),
  reminderPushBody({ venueName: 'The Studio' }),
  bookingChangedPushBody({ venueName: 'The Studio', kind: 'modified' }),
  bookingChangedPushBody({ venueName: 'The Studio', kind: 'cancelled' }),
  waitlistOfferPushBody({ venueName: 'The Studio' }),
];

describe('the reminder', () => {
  it('names the time and the day, not "tomorrow"', () => {
    /*
      `pre_visit_reminder` is venue-configurable: `hoursBefore` is commonly
      same-day and can be set to anything. "Tomorrow" would be wrong for every
      venue that reminds on the morning of, and wrong in the direction that
      makes somebody miss an appointment.
    */
    /*
      Matched rather than pinned: en-GB's short September is "Sept" on current
      ICU and "Sep" on older builds, and a test that pins one of them fails on
      a runtime difference that no customer would notice.
    */
    expect(
      reminderPushBody({
        venueName: 'The Studio',
        bookingDate: '2026-09-01',
        bookingTime: '10:00:00',
      }),
    ).toMatch(/^Your appointment at The Studio is at 10:00am on Tue 1 Sept?\.$/);
  });

  it('reads as a sentence when the time is missing rather than trailing off', () => {
    expect(reminderPushBody({ venueName: 'The Studio' })).toBe(
      'Your appointment at The Studio is coming up.',
    );
  });

  it('formats afternoon times as pm, and midnight and noon correctly', () => {
    const at = (t: string) =>
      reminderPushBody({ venueName: 'V', bookingDate: '2026-09-01', bookingTime: t });
    expect(at('14:30:00')).toContain('2:30pm');
    expect(at('12:00:00')).toContain('12:00pm');
    expect(at('00:15:00')).toContain('12:15am');
  });

  it('reads the date as civil, not as an instant in some timezone', () => {
    // Parsed as parts on purpose. `new Date('2026-09-01')` is UTC midnight,
    // which prints as 31 August anywhere west of Greenwich, so a customer in
    // the US would be reminded of the wrong day.
    expect(
      reminderPushBody({ venueName: 'V', bookingDate: '2026-09-01', bookingTime: '09:00' }),
    ).toContain('Tue 1 Sep');
  });
});

describe('a booking that changed', () => {
  it('does not say who changed it', () => {
    // Fires for a venue edit and for a portal self-reschedule alike.
    const body = bookingChangedPushBody({ venueName: 'The Studio', kind: 'modified' });
    expect(body).toBe('Your booking at The Studio has changed. Tap to see the details.');
    expect(body).not.toMatch(/^The Studio\b/);
  });

  it('does not promise a new time, since the change may not be the time', () => {
    // The same notification covers a change of party size or service.
    expect(bookingChangedPushBody({ venueName: 'The Studio', kind: 'modified' })).not.toMatch(
      /new time/i,
    );
  });

  it('says cancelled when it is a cancellation', () => {
    expect(bookingChangedPushBody({ venueName: 'The Studio', kind: 'cancelled' })).toBe(
      'Your booking at The Studio has been cancelled.',
    );
  });
});

describe('a waitlist place', () => {
  it('says a place has come up, without saying which slot', () => {
    expect(waitlistOfferPushBody({ venueName: 'The Studio' })).toBe(
      'A place has come up at The Studio.',
    );
  });
});

describe('every body, whatever the event', () => {
  it('drops the venue clause rather than printing an empty one', () => {
    // A venue with no usable name is a data fault, not a reason to send
    // "Your booking at  has changed." to somebody's lock screen.
    expect(bookingChangedPushBody({ venueName: '  ', kind: 'cancelled' })).toBe(
      'Your booking has been cancelled.',
    );
    expect(waitlistOfferPushBody({ venueName: null })).toBe('A place has come up.');
  });

  it('carries no em-dash, per the house copy rule', () => {
    for (const body of ALL_BODIES) {
      expect(body, `em-dash in customer copy: ${body}`).not.toContain('—');
    }
  });

  it('names the venue and never the service', () => {
    // A service name on a lock screen is more than a passer-by needs to know.
    for (const body of ALL_BODIES) {
      expect(body).not.toMatch(/consultation|massage|treatment/i);
    }
  });

  it('is short enough to survive a lock screen', () => {
    // Both platforms truncate around two lines. Anything that reads as a
    // paragraph has already lost the reader.
    for (const body of ALL_BODIES) {
      expect(body.length, `too long for a notification: ${body}`).toBeLessThanOrEqual(90);
    }
  });
});
