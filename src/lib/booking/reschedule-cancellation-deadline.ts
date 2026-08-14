/**
 * C13 — a reschedule must not launder a deposit that has already become
 * non-refundable.
 *
 * Every reschedule path re-pins `cancellation_deadline` to `newStart - noticeHours`,
 * which is right for a booking still inside its refund window: move the booking
 * later and the deadline moves with it. But it is also unconditional, and that
 * is the defect. A guest whose deadline has already passed holds a deposit that
 * a cancel would refuse to refund. If they instead reschedule to a date further
 * out, the recomputed deadline lands in the future, the deposit becomes
 * refundable again, and cancelling now returns money the cancellation policy had
 * already forfeited. `guest_self_reschedule` is default-on, the only status gate
 * is `modifiableStatuses`, and the manage link survives a modify
 * (`confirm_token_used_at` is stamped by confirm and cancel, never by modify),
 * so the whole sequence is self-service and repeatable.
 *
 * The rule: once the deadline has passed on a booking with money at stake, it is
 * fixed. A deadline still in the future re-pins as before, so ordinary
 * within-window reschedules are untouched.
 *
 * WHY IT IS SCOPED TO TWO DEPOSIT STATES. A passed deadline only means something
 * where it decides the fate of money:
 *
 *   - `Paid` — a post-deadline cancel refuses the refund. Laundering restores it.
 *   - `Card Held` — a post-deadline cancel KEEPS the hold chargeable (§9.3
 *     amended); a pre-deadline one releases it. Laundering escapes the fee.
 *
 * Everything else is either settled (`Refunded`, `Forfeited`, `Charged`) or has
 * nothing riding on it (`Not Required`, `Pending`, `Waived`, `Failed`). Those
 * re-pin freely, which also stops a depositless booking displaying a stale
 * deadline in the past for no reason.
 */

/** Deposit states where a passed deadline has a financial consequence. */
const MONEY_AT_STAKE: ReadonlySet<string> = new Set(['Paid', 'Card Held']);

export interface RescheduleCancellationDeadlineInput {
  /** The row's deadline BEFORE this reschedule. */
  previousDeadline: string | null | undefined;
  /** The row's current `deposit_status`. */
  depositStatus: string | null | undefined;
  /** What the reschedule would set, from `cancellationDeadlineHoursBefore`. */
  recomputedDeadline: string;
  /** Injectable for tests. */
  now?: Date;
}

export interface RescheduleCancellationDeadlineResult {
  /** The value to write to `cancellation_deadline`. */
  deadline: string;
  /**
   * True when the previous deadline was kept. Call sites that also rewrite
   * `cancellation_policy_snapshot` MUST skip that write when this is true:
   * the stored snapshot describes the window the preserved deadline enforces,
   * and re-pinning one without the other is what previously let a row promise a
   * 24 hour window while enforcing 48.
   */
  preserved: boolean;
}

export function resolveRescheduleCancellationDeadline(
  input: RescheduleCancellationDeadlineInput,
): RescheduleCancellationDeadlineResult {
  const { previousDeadline, depositStatus, recomputedDeadline } = input;
  const now = input.now ?? new Date();

  if (!previousDeadline || !MONEY_AT_STAKE.has(depositStatus ?? '')) {
    return { deadline: recomputedDeadline, preserved: false };
  }

  const previous = new Date(previousDeadline);
  if (Number.isNaN(previous.getTime())) {
    // An unparseable stored deadline cannot be shown to have passed, so it
    // cannot justify withholding a refund. Re-pin and let the new value stand.
    return { deadline: recomputedDeadline, preserved: false };
  }

  if (previous.getTime() > now.getTime()) {
    // Still inside the refund window: the guest has not yet earned a
    // non-refundable deposit, so a reschedule legitimately carries the deadline
    // to the new start.
    return { deadline: recomputedDeadline, preserved: false };
  }

  return { deadline: previousDeadline, preserved: true };
}
