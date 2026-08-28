/**
 * Customer-facing wording for the commerce sections on `/account/passes`
 * (P1-4, closes G19).
 *
 * Four database enums reached the customer raw: a membership read `past_due`,
 * a course read `pending_payment`, a repeat booking read `failed`, and a credit
 * line read `admin_adjust`. Those are lifecycle names written for the people
 * who maintain the tables, and three of them are alarming to read without that
 * context. `past_due` in particular tells a customer nothing about what to do.
 *
 * The value sets come from `supabase/migrations/20260701120000_class_commerce_foundation.sql`,
 * which is the source of truth. Each map below is typed as an exhaustive
 * `Record`, so adding a value to one of those enums without adding wording here
 * fails the build rather than shipping the raw value to a customer.
 *
 * Deliberately unlike `friendlyAccountBookingStatus`, which passes unknown
 * values through unchanged: these fall back to a plain word instead. Passing
 * through is the right call for booking statuses, where the stored spellings
 * are already close to English ("Seated", "No-Show"). It is the wrong call
 * here, where an unmapped value is by construction a snake_case identifier and
 * the whole point of this module is that customers never see one.
 */

export type MembershipStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'paused'
  | 'incomplete';

export type CourseEnrollmentStatus = 'pending_payment' | 'active' | 'cancelled' | 'completed';

export type RecurringStatus = 'active' | 'paused' | 'cancelled' | 'failed';

export type CreditLedgerReason = 'purchase' | 'redeem' | 'refund' | 'expire' | 'admin_adjust';

/*
 * The four maps are exported so the tests can compare their KEYS against the
 * migration. Comparing behaviour is not enough, and a mutation showed why: a
 * missing key falls back to a perfectly clean label, so a drift check driven
 * through the functions would report a wordless enum value as fine.
 */

export const MEMBERSHIP_LABELS: Record<MembershipStatus, string> = {
  trialing: 'Free trial',
  active: 'Active',
  // Says what happened and implies what to do, where "past due" says neither.
  past_due: 'Payment failed',
  canceled: 'Ended',
  paused: 'Paused',
  // The subscription exists but its first payment or card setup has not
  // finished. "Incomplete" reads like the customer did something wrong.
  incomplete: 'Setting up',
};

export const COURSE_LABELS: Record<CourseEnrollmentStatus, string> = {
  // Matches the booking list's wording for the same situation, so a customer
  // meets one phrase for "we are waiting on your payment" across the portal.
  pending_payment: 'Awaiting payment',
  active: 'Enrolled',
  cancelled: 'Cancelled',
  completed: 'Finished',
};

export const RECURRING_LABELS: Record<RecurringStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  // The row also shows the error itself when there is one, so this says the
  // state without pretending to explain it twice.
  failed: 'Needs attention',
};

export const CREDIT_REASON_LABELS: Record<CreditLedgerReason, string> = {
  purchase: 'Bought',
  redeem: 'Used',
  refund: 'Refunded',
  expire: 'Expired',
  admin_adjust: 'Adjusted by the venue',
};

function label<T extends string>(map: Record<T, string>, value: string | null | undefined, fallback: string): string {
  if (!value) return fallback;
  return map[value as T] ?? fallback;
}

export function friendlyMembershipStatus(status: string | null | undefined): string {
  return label(MEMBERSHIP_LABELS, status, 'Active');
}

export function friendlyCourseStatus(status: string | null | undefined): string {
  return label(COURSE_LABELS, status, 'Enrolled');
}

export function friendlyRecurringStatus(status: string | null | undefined): string {
  return label(RECURRING_LABELS, status, 'Active');
}

export function friendlyCreditReason(reason: string | null | undefined): string {
  return label(CREDIT_REASON_LABELS, reason, 'Adjusted');
}

/**
 * A date a customer can read: "4 September 2026", not "2026-09-04".
 *
 * Accepts either a bare `YYYY-MM-DD` or a full timestamp, because the sections
 * hand over both. **Formatted in UTC on purpose.** These are period boundaries
 * and renewal dates, not appointments: they carry no time and no venue, so
 * there is no zone that is more correct than any other, and formatting a bare
 * date in the viewer's local zone would show the day before to anyone west of
 * UTC. Appointments do have a venue and a zone, and are formatted by
 * `formatAccountBookingDateTime` instead.
 *
 * Returns null for anything unparseable rather than printing "Invalid Date".
 */
export function formatAccountDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const dateOnly = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The one line under a membership that says where it stands.
 *
 * It used to print the raw status, then "renews <date>", then "cancelling" if
 * the subscription was set to stop, so a membership the customer had already
 * cancelled still told them it renews. Those two facts contradict each other
 * and the customer had to work out which one won. A membership that is ending
 * says only when it ends.
 */
export function membershipStandingLine(m: {
  status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
}): string {
  const status = friendlyMembershipStatus(m.status);
  const date = formatAccountDate(m.current_period_end);
  if (!date) return status;
  if (m.cancel_at_period_end) return `${status}, ends ${date}`;
  return `${status}, renews ${date}`;
}
