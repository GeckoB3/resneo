import type { CommunicationMessageKey } from '@/lib/communications/policies';
import type { PreferenceBag } from './notification-preferences';

export type NotificationCategory = 'reminders' | 'changes' | 'marketing';
export type NotificationChannel = 'email' | 'sms' | 'push';

/**
 * Which category each message belongs to, and `null` for the ones a customer
 * may NOT switch off.
 *
 * **The nulls are the important half.** A preference matrix that can silence
 * anything is a way for a customer to stop hearing that their deposit is due,
 * and then lose the booking for not paying it. So a message is only
 * suppressible when missing it costs the customer nothing they cannot recover:
 *
 * - **Always sent**: the receipt for something that just happened
 *   (`booking_confirmation`, `deposit_confirmation`, the `class_*` commerce
 *   messages), a request for something they must DO to keep the booking
 *   (`deposit_payment_request`, `card_hold_request`, `compliance_form_request`),
 *   a direct reply to something they asked for
 *   (`appointment_waitlist_offer`), and a human writing to them
 *   (`custom_message`).
 * - **reminders**: a second or third telling of something they already know.
 * - **changes**: what happened to a booking after it was made.
 * - **marketing**: what it says.
 */
export const MESSAGE_CATEGORY: Record<CommunicationMessageKey, NotificationCategory | null> = {
  booking_confirmation: null,
  deposit_payment_request: null,
  deposit_confirmation: null,
  card_hold_request: null,
  compliance_form_request: null,
  appointment_waitlist_offer: null,
  custom_message: null,
  class_credits_purchased: null,
  class_credits_restored: null,
  class_course_enrolled: null,
  class_course_refunded: null,
  class_membership_started: null,
  class_membership_renewed: null,
  class_membership_cancelling: null,
  class_membership_ended: null,

  confirm_or_cancel_prompt: 'reminders',
  deposit_payment_reminder: 'reminders',
  card_hold_payment_reminder: 'reminders',
  pre_visit_reminder: 'reminders',
  compliance_form_reminder: 'reminders',
  compliance_record_expiring: 'reminders',
  class_credits_expiring: 'reminders',

  booking_modification: 'changes',
  cancellation_confirmation: 'changes',
  auto_cancel_notification: 'changes',
  no_show_notification: 'changes',

  post_visit_thankyou: 'marketing',
};

/**
 * The pairs a customer is actually allowed to control.
 *
 * **`changes` over email is deliberately absent**, and that is the floor this
 * whole feature rests on. A cancellation or a moved appointment must leave a
 * record the customer can find later, and there is no way to re-send one they
 * silenced. They can stop the text message and the push, which is the noise;
 * the written record stays.
 *
 * Enforced HERE rather than by omitting a checkbox, because the preference is
 * a free-form jsonb column that a crafted PATCH can write to directly. A UI
 * that does not offer the switch is not the same as a switch that does not
 * exist.
 *
 * **PUSH IS ABSENT, and this corrects the plan.** P4-3 asks for the matrix
 * across email, SMS and push, but nothing sends push to a customer: the send
 * path is staff-only, and `user_devices.audience` records an intent that has
 * no delivery behind it yet. A toggle that saves and changes nothing is
 * exactly the defect this task exists to fix, so push is not offered until it
 * can be honoured. `NotificationChannel` still names it, so the rule is
 * already correct on the day it ships.
 */
const CONTROLLABLE: ReadonlyArray<`${NotificationCategory}:${NotificationChannel}`> = [
  'reminders:email',
  'reminders:sms',
  'changes:sms',
  'marketing:email',
  'marketing:sms',
];

export function isControllable(
  category: NotificationCategory,
  channel: NotificationChannel,
): boolean {
  return CONTROLLABLE.includes(`${category}:${channel}`);
}

/** The key a controllable pair is stored under, e.g. `reminders_sms`. */
export function preferenceKey(
  category: NotificationCategory,
  channel: NotificationChannel,
): string {
  return `${category}_${channel}`;
}

/**
 * May this message go out on this channel for this customer?
 *
 * **Absent means yes for everything except marketing**, which is how existing
 * accounts keep behaving exactly as they do today without a migration. The
 * plan budgeted for one; none is needed, because a matrix whose unset state is
 * current behaviour does not need existing rows rewritten. Marketing already
 * defaults to off and is read from the legacy `marketing_email` key when the
 * matrix has nothing to say, so the toggle customers have already used keeps
 * working.
 */
export function customerAllowsMessageOnChannel(
  prefs: PreferenceBag,
  messageKey: CommunicationMessageKey,
  channel: NotificationChannel,
): boolean {
  const category = MESSAGE_CATEGORY[messageKey];
  // Not categorised: the customer never had a way to switch this off, and must
  // not gain one by a key appearing in the column.
  if (!category) return true;
  if (!isControllable(category, channel)) return true;

  const stored = prefs[preferenceKey(category, channel)];
  if (typeof stored === 'boolean') return stored;

  if (category === 'marketing') {
    // The pre-matrix toggle, still authoritative when the matrix is silent.
    if (channel === 'email') return prefs.marketing_email === true;
    return prefs.marketing_email === true;
  }
  return true;
}

/**
 * The matrix as the profile page should render it: every controllable pair
 * with its effective value, so the UI never has to repeat these defaults.
 */
export function readChannelMatrix(
  prefs: PreferenceBag,
): Array<{ category: NotificationCategory; channel: NotificationChannel; enabled: boolean }> {
  return CONTROLLABLE.map((pair) => {
    const [category, channel] = pair.split(':') as [NotificationCategory, NotificationChannel];
    const stored = prefs[preferenceKey(category, channel)];
    const enabled =
      typeof stored === 'boolean'
        ? stored
        : category === 'marketing'
          ? prefs.marketing_email === true
          : true;
    return { category, channel, enabled };
  });
}
