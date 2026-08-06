import { describe, it, expect } from 'vitest';
import {
  BOOKING_PII_FIELDS,
  linkedViewerMustNotSeePii,
  redactBookingPiiFields,
  redactCommunicationRecipients,
} from './redact-booking-pii';

/** A booking row shaped like the one the detail route spreads into its response. */
function bookingRow() {
  return {
    id: 'b1',
    venue_id: 'v1',
    booking_date: '2026-08-10',
    booking_time: '14:00',
    status: 'Booked',
    guest_first_name: 'Ann',
    guest_last_name: 'Lee',
    guest_email: 'ann@example.test',
    guest_phone: '07700900000',
    special_requests: 'Ann is allergic to PPD',
    dietary_notes: 'Coeliac',
    occasion: 'Birthday',
    internal_notes: 'Late twice, take deposit',
  };
}

describe('redactBookingPiiFields', () => {
  it('nulls every identifying field on the booking row', () => {
    const out = redactBookingPiiFields(bookingRow());

    for (const field of BOOKING_PII_FIELDS) {
      expect(out[field as keyof typeof out]).toBeNull();
    }
  });

  it('leaves operational fields untouched', () => {
    const out = redactBookingPiiFields(bookingRow());

    expect(out.id).toBe('b1');
    expect(out.booking_date).toBe('2026-08-10');
    expect(out.booking_time).toBe('14:00');
    expect(out.status).toBe('Booked');
  });

  it('redacts free text, which is the field that leaks a name past a name redaction', () => {
    const out = redactBookingPiiFields(bookingRow());

    // The original value names the client and states a health fact.
    expect(out.special_requests).toBeNull();
    expect(out.dietary_notes).toBeNull();
  });

  it('does not add fields that were absent, so it never widens a payload', () => {
    const out = redactBookingPiiFields({ id: 'b1', status: 'Booked' });

    expect(out).toEqual({ id: 'b1', status: 'Booked' });
    expect('guest_email' in out).toBe(false);
  });

  it('does not mutate its input', () => {
    const input = bookingRow();
    redactBookingPiiFields(input);

    expect(input.guest_email).toBe('ann@example.test');
  });
});

describe('redactCommunicationRecipients', () => {
  it('nulls the recipient, which holds the email address or phone number', () => {
    const out = redactCommunicationRecipients([
      { id: 'c1', channel: 'email', status: 'sent', recipient: 'ann@example.test' },
      { id: 'c2', channel: 'sms', status: 'sent', recipient: '07700900000' },
    ]);

    expect(out.map((r) => r.recipient)).toEqual([null, null]);
  });

  it('keeps the operational fields a linked venue legitimately needs', () => {
    const out = redactCommunicationRecipients([
      { id: 'c1', channel: 'email', status: 'failed', recipient: 'ann@example.test' },
    ]);

    expect(out[0]).toMatchObject({ id: 'c1', channel: 'email', status: 'failed' });
  });

  it('handles an empty list', () => {
    expect(redactCommunicationRecipients([])).toEqual([]);
  });
});

describe('linkedViewerMustNotSeePii', () => {
  it('never redacts own-venue staff', () => {
    expect(linkedViewerMustNotSeePii(true, { pii: false })).toBe(false);
    expect(linkedViewerMustNotSeePii(true, null)).toBe(false);
  });

  it('redacts a linked viewer without the PII grant', () => {
    expect(linkedViewerMustNotSeePii(false, { pii: false })).toBe(true);
  });

  it('does not redact a linked viewer holding the PII grant', () => {
    expect(linkedViewerMustNotSeePii(false, { pii: true })).toBe(false);
  });

  it('treats a missing pii flag as not granted', () => {
    expect(linkedViewerMustNotSeePii(false, {})).toBe(true);
  });

  it('does not redact when there is no linked grant at all', () => {
    // No grant means this is not a linked-viewer request; access is decided elsewhere.
    expect(linkedViewerMustNotSeePii(false, null)).toBe(false);
  });
});
