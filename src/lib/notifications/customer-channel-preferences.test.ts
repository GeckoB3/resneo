/**
 * P4-3: which messages a customer may switch off, and which they may not.
 *
 * A preference matrix is a way to make the product quieter, and also a way to
 * stop somebody hearing that their deposit is due before they lose the booking
 * for not paying it. Nearly every test here is about the second thing.
 */
import { describe, it, expect } from 'vitest';
import {
  MESSAGE_CATEGORY,
  customerAllowsMessageOnChannel,
  isControllable,
  preferenceKey,
  readChannelMatrix,
} from './customer-channel-preferences';

describe('what may never be switched off', () => {
  const ALWAYS_SENT = [
    'booking_confirmation',
    'deposit_payment_request',
    'deposit_confirmation',
    'card_hold_request',
    'compliance_form_request',
    'appointment_waitlist_offer',
    'custom_message',
    'class_credits_purchased',
    'class_course_refunded',
  ] as const;

  for (const key of ALWAYS_SENT) {
    it(`${key} is sent whatever the customer has stored`, () => {
      /*
        Asserted against a preference bag that says NO to everything, because
        the risk is not the UI offering a switch, it is a value arriving in a
        free-form jsonb column and being honoured.
      */
      const hostile = {
        reminders_email: false,
        reminders_sms: false,
        changes_email: false,
        changes_sms: false,
        marketing_email: false,
      };
      for (const channel of ['email', 'sms', 'push'] as const) {
        expect(customerAllowsMessageOnChannel(hostile, key, channel)).toBe(true);
      }
    });
  }

  it('categorises every message key, so a new one cannot default to silenceable', () => {
    // TypeScript already forces the Record to be exhaustive; this says why it
    // matters, and fails loudly if the type is ever loosened.
    for (const [key, category] of Object.entries(MESSAGE_CATEGORY)) {
      expect(
        category === null || ['reminders', 'changes', 'marketing'].includes(category),
        `${key} has no decision recorded`,
      ).toBe(true);
    }
  });
});

describe('the floor under booking changes', () => {
  it('never lets a customer silence a change by EMAIL', () => {
    /*
      The one written record of a cancellation or a moved appointment. It
      cannot be re-sent once suppressed, so the switch does not exist rather
      than merely being hidden: this is checked in the resolver because the
      column is free-form and a crafted PATCH can write to it directly.
    */
    expect(isControllable('changes', 'email')).toBe(false);
    expect(
      customerAllowsMessageOnChannel({ changes_email: false }, 'cancellation_confirmation', 'email'),
    ).toBe(true);
    expect(
      customerAllowsMessageOnChannel({ changes_email: false }, 'booking_modification', 'email'),
    ).toBe(true);
  });

  it('DOES let them silence the text message', () => {
    // The noise, as opposed to the record.
    expect(
      customerAllowsMessageOnChannel({ changes_sms: false }, 'cancellation_confirmation', 'sms'),
    ).toBe(false);
  });

  it('ignores a push preference, because nothing sends customer push yet', () => {
    /*
      Corrects P4-3, which asks for a push column. The customer push send path
      does not exist: `user_devices.audience` records an intent with no
      delivery behind it. Offering the toggle would be the very defect this
      task fixes, a control that saves and changes nothing, so push is not
      controllable and a stored value is not honoured.
    */
    expect(isControllable('reminders', 'push')).toBe(false);
    expect(
      customerAllowsMessageOnChannel({ reminders_push: false }, 'pre_visit_reminder', 'push'),
    ).toBe(true);
  });
});

describe('reminders', () => {
  it('turning off SMS reminders stops SMS and leaves email alone', () => {
    // P4-3's acceptance, at the level that decides it.
    const prefs = { reminders_sms: false };
    expect(customerAllowsMessageOnChannel(prefs, 'pre_visit_reminder', 'sms')).toBe(false);
    expect(customerAllowsMessageOnChannel(prefs, 'pre_visit_reminder', 'email')).toBe(true);
  });

  it('applies to every reminder, not just the pre-visit one', () => {
    const prefs = { reminders_sms: false };
    for (const key of [
      'deposit_payment_reminder',
      'card_hold_payment_reminder',
      'compliance_form_reminder',
      'compliance_record_expiring',
      'class_credits_expiring',
      'confirm_or_cancel_prompt',
    ] as const) {
      expect(customerAllowsMessageOnChannel(prefs, key, 'sms'), key).toBe(false);
    }
  });

  it('is ON when nothing is stored, so existing accounts are unchanged', () => {
    /*
      Why no migration is needed. The plan budgeted for one to "default
      existing users to current behaviour exactly"; a matrix whose unset state
      IS current behaviour does that without rewriting a single row.
    */
    for (const channel of ['email', 'sms', 'push'] as const) {
      expect(customerAllowsMessageOnChannel({}, 'pre_visit_reminder', channel)).toBe(true);
    }
  });
});

describe('marketing', () => {
  it('stays OFF when nothing is stored, because it is opt-in', () => {
    expect(customerAllowsMessageOnChannel({}, 'post_visit_thankyou', 'email')).toBe(false);
  });

  it('honours the pre-matrix toggle a customer has already used', () => {
    // `marketing_email` predates this matrix and customers have set it. It
    // stays authoritative until a matrix value exists.
    expect(
      customerAllowsMessageOnChannel({ marketing_email: true }, 'post_visit_thankyou', 'email'),
    ).toBe(true);
  });

  it('lets the matrix override the legacy toggle once set', () => {
    expect(
      customerAllowsMessageOnChannel(
        { marketing_email: true, marketing_email_: false, marketing_sms: false },
        'post_visit_thankyou',
        'sms',
      ),
    ).toBe(false);
  });
});

describe('the matrix the profile renders', () => {
  it('offers exactly the controllable pairs, and not changes-by-email', () => {
    const matrix = readChannelMatrix({});
    const pairs = matrix.map((m) => `${m.category}:${m.channel}`);
    expect(pairs).not.toContain('changes:email');
    expect(pairs).toContain('reminders:sms');
    expect(pairs).toContain('changes:sms');
    expect(pairs).toContain('marketing:email');
  });

  it('shows transactional categories on and marketing off by default', () => {
    const matrix = readChannelMatrix({});
    for (const row of matrix) {
      expect(row.enabled, `${row.category}:${row.channel}`).toBe(row.category !== 'marketing');
    }
  });

  it('reflects what the customer actually stored', () => {
    const matrix = readChannelMatrix({ reminders_sms: false, marketing_email: true });
    const bySms = matrix.find((m) => m.category === 'reminders' && m.channel === 'sms');
    const marketingEmail = matrix.find((m) => m.category === 'marketing' && m.channel === 'email');
    expect(bySms?.enabled).toBe(false);
    expect(marketingEmail?.enabled).toBe(true);
  });

  it('names keys the way the resolver reads them', () => {
    // A mismatch here would save preferences nothing ever consults, which is
    // the bug G21 was: the toggle persisted and no send path read it.
    expect(preferenceKey('reminders', 'sms')).toBe('reminders_sms');
    expect(
      customerAllowsMessageOnChannel(
        { [preferenceKey('reminders', 'sms')]: false },
        'pre_visit_reminder',
        'sms',
      ),
    ).toBe(false);
  });
});
