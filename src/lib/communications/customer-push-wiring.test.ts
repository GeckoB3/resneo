/**
 * P5-2: that the customer push is actually SENT, and what it says.
 *
 * `customer-push-notification.test.ts` proves the sender behaves. This proves
 * it is called, which is the half that gets missed: a sender nothing calls
 * passes every test it has and reaches nobody, and the failure looks exactly
 * like the expected silence of "no customer devices are registered yet".
 *
 * The copy is asserted here rather than left to review because it is the one
 * part a customer reads on a lock screen, where a passer-by may read it too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const hoisted = vi.hoisted(() => ({
  /** Every push that reached the sender, in order. */
  pushes: [] as Array<{ bookingId: string; event: string; body: string; guestId?: string | null }>,
  /** Every policy message that reached the outbound sender, in order. */
  sent: [] as Array<{ messageKey: string; channel: string }>,
  /** What the sender reports back, so the call site's logging can be exercised. */
  pushResult: { sent: false, reason: 'no_tokens' } as { sent: boolean; reason?: string },
}));

vi.mock('./outbound', () => ({
  sendPolicyMessage: async (args: { messageKey: string; channel: string }) => {
    hoisted.sent.push({ messageKey: args.messageKey, channel: args.channel });
    return { sent: true };
  },
}));

vi.mock('./staff-push-notification', () => ({
  sendStaffPush: async () => ({ sent: false }),
}));

vi.mock('./customer-push-notification', () => ({
  sendCustomerPush: async (args: {
    bookingId: string;
    guestId?: string | null;
    event: string;
    body: string;
  }) => {
    hoisted.pushes.push(args);
    return hoisted.pushResult;
  },
}));

const BOOKING = {
  id: 'bk-1',
  guest_name: 'Cass Reed',
  guest_email: 'cass@example.com',
  booking_date: '2026-09-01',
  booking_time: '10:00',
  party_size: 2,
} as BookingEmailData;

const VENUE = { name: 'The Studio' } as VenueEmailData;

beforeEach(() => {
  vi.resetModules();
  hoisted.pushes = [];
  hoisted.sent = [];
  hoisted.pushResult = { sent: false, reason: 'no_tokens' };
});

describe('a booking that changes', () => {
  it('pushes the customer once, as booking_changed, after the email and SMS', async () => {
    const { sendBookingModificationNotification } = await import('./send-templated');
    await sendBookingModificationNotification(BOOKING, VENUE, 'venue-1');

    expect(hoisted.sent.map((s) => s.channel)).toEqual(['email', 'sms']);
    expect(hoisted.pushes).toHaveLength(1);
    expect(hoisted.pushes[0]).toMatchObject({ bookingId: 'bk-1', event: 'booking_changed' });
  });

  it('does not name who changed it, because the customer may have', async () => {
    /*
      This fires for a change the venue made and for a portal self-reschedule.
      "The Studio has changed your booking" is a lie in the second case, on the
      customer's own lock screen, about something they just did themselves.
    */
    const { sendBookingModificationNotification } = await import('./send-templated');
    await sendBookingModificationNotification(BOOKING, VENUE, 'venue-1');

    const { body } = hoisted.pushes[0];
    expect(body).toBe('Your booking at The Studio has changed. Tap to see the details.');
    // The venue must not be the SUBJECT of the verb, which is the form that
    // makes the claim: "The Studio has changed your booking". Matching the
    // bare substring instead would fail against the correct sentence, since
    // "...at The Studio has changed..." contains it.
    expect(body).not.toMatch(/^The Studio\b/);
    expect(body).not.toMatch(/\bhas changed your booking\b/);
  });
});

describe('a booking that is cancelled', () => {
  it('says cancelled rather than changed, on the same event', async () => {
    // One event, because the app has one channel for it, but a customer told
    // their booking "has changed" would go looking for a new time.
    const { sendCancellationNotification } = await import('./send-templated');
    await sendCancellationNotification(BOOKING, VENUE, 'venue-1');

    expect(hoisted.pushes).toHaveLength(1);
    expect(hoisted.pushes[0].event).toBe('booking_changed');
    expect(hoisted.pushes[0].body).toBe('Your booking at The Studio has been cancelled.');
  });
});

describe('when it reaches nobody', () => {
  it('carries on, and says why', async () => {
    // Every device row is `audience = 'staff'` until a customer build ships,
    // so `no_tokens` is the expected answer today. It must not look like a
    // failure, and it must not be silent either: `no_tokens` and `suppressed`
    // are indistinguishable from outside without this line.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendCancellationNotification } = await import('./send-templated');

    const result = await sendCancellationNotification(BOOKING, VENUE, 'venue-1');

    expect(result.email.sent, 'the email is what the customer relies on').toBe(true);
    expect(log).toHaveBeenCalledWith(
      '[customer-push] booking_changed not sent',
      expect.objectContaining({ reason: 'no_tokens' }),
    );
    log.mockRestore();
  });

  it('says nothing at all when it did send', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    hoisted.pushResult = { sent: true };
    const { sendCancellationNotification } = await import('./send-templated');

    await sendCancellationNotification(BOOKING, VENUE, 'venue-1');

    expect(log).not.toHaveBeenCalledWith(
      '[customer-push] booking_changed not sent',
      expect.anything(),
    );
    log.mockRestore();
  });
});
