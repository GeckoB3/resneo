/**
 * P3-5: every transactional email tells a customer their account exists.
 *
 * `pre_visit_reminder` already carried the callout and six others did not, so
 * whether a customer ever discovered the portal depended on which email they
 * happened to receive: someone who paid a deposit, completed a form and then
 * cancelled got three emails and no mention of it.
 *
 * **ASSERTED ON THE SENT PATH, NOT THE GALLERY, and the plan says why.**
 * `reminder-56h.ts` and `day-of-reminder-email.ts` are referenced only by
 * `email-template-gallery-data.ts` and are never sent to anybody, so a
 * gallery-based check can pass while changing nothing a customer receives.
 * These assert on `renderCommunicationEmail`, which is the function
 * `sendPolicyMessage` actually renders with, and on its finished HTML and text
 * rather than on an intermediate slot: what is being claimed is that the
 * customer can SEE it.
 */
import { describe, it, expect } from 'vitest';
import { renderCommunicationEmail } from './renderer';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const BOOKING = {
  id: 'bk-1',
  booking_date: '2026-09-10',
  booking_time: '18:30:00',
  party_size: 2,
  guest_name: 'Ada Lovelace',
  guest_email: 'ada@example.test',
  // The link the callout renders. Set explicitly so these rows test the
  // CALLOUT rather than the resolver that supplies it (P3-4d).
  account_bookings_link: 'https://www.resneo.com/auth/portal?t=demo',
} as unknown as BookingEmailData;

const VENUE = {
  name: 'The Wharf',
  address: '1 Dock Street',
  phone: '+44 20 7946 0000',
  email: 'hello@wharf.test',
} as unknown as VenueEmailData;

/**
 * The six the plan names, plus the one that already worked as a control: if
 * `pre_visit_reminder` ever stops carrying it, this list says so too.
 */
const MUST_CARRY_CALLOUT = [
  'pre_visit_reminder',
  'confirm_or_cancel_prompt',
  'deposit_payment_reminder',
  'card_hold_payment_reminder',
  'cancellation_confirmation',
  'post_visit_thankyou',
  'compliance_form_reminder',
] as const;

function render(messageKey: string) {
  return renderCommunicationEmail({
    messageKey,
    booking: BOOKING,
    venue: VENUE,
    lane: 'appointments_other',
    paymentLink: 'https://pay.example.test/x',
    cancelLink: 'https://www.resneo.com/confirm/bk-1/tok?action=cancel',
    confirmLink: 'https://www.resneo.com/confirm/bk-1/tok',
    rebookLink: 'https://www.resneo.com/book/wharf',
  } as Parameters<typeof renderCommunicationEmail>[0]);
}

describe('the account callout reaches every email that should carry it', () => {
  for (const messageKey of MUST_CARRY_CALLOUT) {
    it(`${messageKey} carries it, in HTML and in plain text`, () => {
      const email = render(messageKey);
      expect(email, `${messageKey} rendered nothing`).toBeTruthy();
      expect(
        email!.html,
        `${messageKey} has no account callout in its HTML`,
      ).toContain('/auth/portal?t=demo');
      expect(
        email!.text,
        `${messageKey} has no account callout in its plain text`,
      ).toContain('/auth/portal?t=demo');
    });
  }

  it('does not invent a callout for an email with no link to give', () => {
    /*
      The vacuity guard. `accountBookingsLinkParts` falls back through the
      magic-link URL to the portal URL, so a booking with no address and no
      base URL must produce nothing rather than a dangling "View or sign in"
      pointing at undefined.
    */
    const previous = process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    try {
      const email = renderCommunicationEmail({
        messageKey: 'cancellation_confirmation',
        booking: { ...BOOKING, account_bookings_link: null, guest_email: null },
        venue: VENUE,
        lane: 'appointments_other',
      } as Parameters<typeof renderCommunicationEmail>[0]);
      expect(email!.html).not.toContain('View or sign in to your account');
      expect(email!.text).not.toContain('View or sign in to your account');
    } finally {
      if (previous) process.env.NEXT_PUBLIC_BASE_URL = previous;
    }
  });

  it('puts it AFTER the call to action, never instead of one', () => {
    // These emails exist to get one thing done: pay the deposit, complete the
    // form, confirm the booking. The account is a footnote to that, and
    // `postCtaHtml` is the slot that says so.
    const email = render('deposit_payment_reminder')!;
    expect(email.html).toContain('Pay Deposit Now');
    expect(email.html.indexOf('/auth/portal?t=demo')).toBeGreaterThan(
      email.html.indexOf('Pay Deposit Now'),
    );
  });
});
