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

/**
 * What a destructive commerce action will do, stated before the customer
 * commits to it (P2-6, G13).
 *
 * These live here rather than inside each section because the sections are
 * three separate client components that had drifted into three different
 * standards: two `window.confirm` strings and, for the membership, nothing at
 * all. What they have in common is the shape of the answer a customer needs,
 * which is what stops, when it stops, what money moves, and whether it can be
 * undone. Strings rather than JSX so they can be asserted without a DOM.
 */

/**
 * Cancelling a membership at period end.
 *
 * The date is the point of it. Cancellation is SCHEDULED, not immediate, and
 * before P2-6 the only hint of that was the button label "Cancel at renewal";
 * the confirmation afterwards said "Cancellation scheduled at period end",
 * which names no period and no end.
 */
export function membershipCancellationLines(m: {
  current_period_end: string | null;
  /**
   * Only its PRESENCE is read, so it is typed as unknown rather than as the
   * section's `AllowanceStatus` union: narrowing it here would tie this copy
   * to a shape it does not look inside, and every future variant of that union
   * would have to be taught to a module that only asks "is there one".
   */
  allowance_status?: unknown;
}): string[] {
  const date = formatAccountDate(m.current_period_end);
  const lines = [
    date
      ? `Your membership stays active until ${date}, and it stops after that.`
      : 'Your membership stays active until the end of the period you have paid for, and it stops after that.',
    'You will not be charged again.',
  ];
  if (m.allowance_status) {
    lines.push(
      date
        ? `Classes included in your membership stop being available on ${date}.`
        : 'Classes included in your membership stop being available when it ends.',
    );
  }
  // Only honest since P2-6 added POST /api/account/memberships/resume. Before
  // that there was no route anywhere that could undo this, from any surface.
  lines.push(
    date
      ? `You can change your mind from this page any time before ${date}.`
      : 'You can change your mind from this page until it ends.',
  );
  return lines;
}

/**
 * Cancelling a course enrollment.
 *
 * Only ever shown for an enrollment the section has already established is
 * inside its cancellation window, which is why there is no branch for one that
 * is not: the button does not render, and if the window closes while the page
 * is open the server refuses and the error is shown. The refund is PRORATED to
 * the sessions not yet delivered and computed server-side at cancel time, so
 * this says a refund is due without naming a figure it cannot work out.
 */
export function courseCancellationEnrollmentLines(e: {
  cancel_by_date: string | null;
}): string[] {
  const by = formatAccountDate(e.cancel_by_date);
  return [
    'Your place on the course is given up, along with every session still to come.',
    by
      ? `You are inside the cancellation window, which runs until ${by}, so a refund is due.`
      : 'You are inside the cancellation window, so a refund is due.',
    // Prorated to the sessions not yet delivered, and worded so it is true
    // either way rather than warning about a shortfall that, inside the
    // window, there usually is not: the window closes before the course
    // starts, so in the normal case every session is still to come.
    'You are refunded for the sessions that have not happened yet.',
    'This cannot be undone. You would need to enrol again.',
  ];
}

/**
 * Deleting a recurring booking rule.
 *
 * Deliberately says what does NOT happen as well: bookings the rule has
 * already made stay booked, and a customer who reads "delete" as "cancel
 * everything" would otherwise turn up expecting to have been refunded.
 */
export function recurringRuleDeletionLines(r: {
  next_materialize_on: string | null;
}): string[] {
  const next = formatAccountDate(r.next_materialize_on);
  return [
    'No further bookings will be made for you automatically.',
    next
      ? `The next one would have been booked on ${next}.`
      : 'Nothing further is scheduled to be booked.',
    'Sessions already booked are NOT cancelled, and stay in your bookings.',
    'This cannot be undone. You would need to set the repeat up again.',
  ];
}

/**
 * Removing a known device.
 *
 * Not in P2-6's stated inventory, but it deletes something of the customer's,
 * which is the rule the inventory is drawn from. Short because the stakes are:
 * it is reversible from the same page.
 */
export function deviceRemovalLines(): string[] {
  return [
    'This device stops receiving notifications from ResNeo.',
    'You stay signed in on it, and you can add it again from this page.',
  ];
}
