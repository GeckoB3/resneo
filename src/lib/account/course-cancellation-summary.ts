import type { AccountBookingRow } from '@/lib/account/account-bookings';

/**
 * What cancelling a whole course will do, stated before the customer confirms
 * it (P2-2a acceptance, Register Q-21).
 *
 * **It mirrors `cancelBookingForGuest`'s own refund test rather than inventing
 * one**: a deposit comes back when the booking is cancelled on or before its
 * `cancellation_deadline` and its `deposit_status` is `Paid`. A course is
 * several sessions with several deadlines, so some of it can be refundable and
 * some not, which is exactly the thing a single sentence cannot say and the
 * reason this is computed rather than described.
 *
 * **It deliberately says LESS than the action knows.** The real test also
 * requires a live `stripe_payment_intent_id`, which the account list's row does
 * not carry, so a session counted refundable here can still turn out to have no
 * intent to refund against. Every number below is therefore framed as the
 * DEADLINE having passed or not, which is the half the customer controls and
 * the half that differs between sessions. Promising money back from a row that
 * cannot see the payment would be the one mistake worth avoiding here.
 */

export interface CourseCancellationSummary {
  /** Sessions this cancellation would act on. */
  remaining: number;
  /** Of those, still on or before their free-cancellation deadline. */
  beforeDeadline: number;
  /** Of those, past it. */
  afterDeadline: number;
  /** Deposit total on the sessions still before their deadline, in pence. */
  refundablePence: number;
  /** Deposit total on the sessions past their deadline, in pence. */
  atRiskPence: number;
  /** Sessions already cancelled or completed, which this leaves alone. */
  untouched: number;
}

/** Matches the service's own list, so the preview counts what the action acts on. */
const CANCELLABLE = new Set(['Pending', 'Booked', 'Confirmed']);

export function summariseCourseCancellation(
  rows: AccountBookingRow[],
  nowIso: string,
): CourseCancellationSummary {
  const now = new Date(nowIso).getTime();
  const summary: CourseCancellationSummary = {
    remaining: 0,
    beforeDeadline: 0,
    afterDeadline: 0,
    refundablePence: 0,
    atRiskPence: 0,
    untouched: 0,
  };

  for (const row of rows) {
    if (!CANCELLABLE.has(row.status)) {
      summary.untouched += 1;
      continue;
    }
    summary.remaining += 1;

    /*
     * A session with NO deadline recorded is counted as past one. The action
     * treats a null deadline as not refundable (`deadline && now <= deadline`),
     * and a preview that guessed the friendlier reading would promise a refund
     * the cancellation then would not make.
     */
    const deadline = row.cancellation_deadline ? new Date(row.cancellation_deadline).getTime() : null;
    const inTime = deadline !== null && Number.isFinite(deadline) && now <= deadline;
    const deposit = row.deposit_status === 'Paid' ? (row.deposit_amount_pence ?? 0) : 0;

    if (inTime) {
      summary.beforeDeadline += 1;
      summary.refundablePence += deposit;
    } else {
      summary.afterDeadline += 1;
      summary.atRiskPence += deposit;
    }
  }

  return summary;
}

/** "£12.50", the one place this course copy formats money. */
export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * The consequence lines the dialog shows, in the order a customer needs them:
 * what stops, what comes back, what does not.
 *
 * Returned as strings rather than rendered here so the copy can be asserted
 * without a DOM, and so the dialog stays a layout concern.
 */
export function courseCancellationLines(summary: CourseCancellationSummary): string[] {
  const sessions = (n: number) => `${n} session${n === 1 ? '' : 's'}`;
  const lines: string[] = [
    `${sessions(summary.remaining)} will be cancelled.`,
  ];

  if (summary.untouched > 0) {
    lines.push(`${sessions(summary.untouched)} already cancelled or finished, left as ${summary.untouched === 1 ? 'it is' : 'they are'}.`);
  }

  if (summary.refundablePence > 0) {
    lines.push(
      `${formatPence(summary.refundablePence)} of deposits should come back, across ${sessions(summary.beforeDeadline)} still inside the free-cancellation window.`,
    );
  } else if (summary.beforeDeadline > 0) {
    lines.push(`${sessions(summary.beforeDeadline)} are still inside the free-cancellation window.`);
  }

  if (summary.atRiskPence > 0) {
    lines.push(
      `${formatPence(summary.atRiskPence)} of deposits will NOT come back, on ${sessions(summary.afterDeadline)} past the cancellation deadline.`,
    );
  } else if (summary.afterDeadline > 0) {
    lines.push(`${sessions(summary.afterDeadline)} are past the cancellation deadline.`);
  }

  lines.push('This cannot be undone. You would need to book again.');
  return lines;
}
