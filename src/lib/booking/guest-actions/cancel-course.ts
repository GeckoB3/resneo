import { cancelBookingForGuest } from './cancel';
import { loadAndAuthoriseGuestBooking } from './authorise';
import {
  actionFailure,
  actionSuccess,
  type GuestActionActor,
  type GuestActionClients,
  type GuestActionResult,
} from './types';

/**
 * Cancel every remaining session of a course in one action (P2-2a, Register Q-21).
 *
 * WHAT A COURSE IS HERE. Several `class_session` bookings sharing one
 * `group_booking_id`, created by a single multi-session cart checkout with one
 * guest and one payment. It is NOT a `class_course_enrollments` row: those are
 * course PRODUCTS and `POST /api/account/courses/cancel` already cancels one in
 * a single action. This is the other kind, and until now the portal's own
 * footnote told the customer to cancel every session by hand.
 *
 * **It cancels through `cancelBookingForGuest`, once per session, rather than
 * issuing one bulk UPDATE.** A bulk update is the obvious implementation and it
 * would silently skip everything that makes a cancellation correct: the deposit
 * refund, the card-hold settlement, the class credit restoration, the waitlist
 * offer, the ops log and the per-booking authorisation. The enrollment route
 * does write bookings directly, but it can, because the money on a course
 * product sits on the enrollment; on a cart it sits on the bookings.
 *
 * **Every sibling is authorised individually**, not just the one the caller
 * named. The cart route documents one guest per group, but that is a property
 * of code elsewhere, and this function would be the thing that turned a
 * mistake there into somebody else's booking being cancelled. Re-authorising
 * costs one read per session and makes it a property of this function.
 *
 * **Partial success is a real outcome and is reported, not hidden.** Each
 * session may refund through Stripe, so there is no transaction spanning them:
 * five of six can succeed. Reporting six when five happened would leave a
 * customer believing they owe nothing for a session they are still booked on.
 */

export interface CancelCourseData {
  success: true;
  message: string;
  /** Sessions cancelled by this call. */
  cancelled_count: number;
  /** Of those, the ones whose deposit was refunded. */
  refunded_count: number;
  /** Sessions this call did not cancel, with the reason each was refused. */
  failed: Array<{ booking_id: string; reason: string }>;
}

/** The statuses a session can be cancelled FROM; the rest are already done. */
const CANCELLABLE = new Set(['Pending', 'Booked', 'Confirmed']);

export async function cancelCourseForGuest(
  clients: GuestActionClients,
  params: { bookingId: string; actor: GuestActionActor; now?: string },
): Promise<GuestActionResult<CancelCourseData>> {
  const { bookingId, actor } = params;

  const anchor = await loadAndAuthoriseGuestBooking(clients, bookingId, actor);
  if (!anchor.ok) return anchor;

  const groupId = (anchor.data as { group_booking_id?: string | null }).group_booking_id ?? null;
  if (!groupId) {
    return actionFailure(
      400,
      'CONFLICT',
      'This booking is not part of a course, so there is nothing else to cancel.',
    );
  }

  /*
   * Read as ADMIN, act as the ACTOR. The group is a set of ids, and finding it
   * is not an authorisation decision: cancelling each one is, and that happens
   * through `cancelBookingForGuest` below, which does its own ownership read.
   * Ordered by date so the messages and the failure list read in the order the
   * customer sees the sessions listed.
   */
  const { data: siblingRows, error: siblingErr } = await clients.admin
    .from('bookings')
    .select('id, status, booking_date, booking_time')
    .eq('group_booking_id', groupId)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true });

  if (siblingErr) {
    console.error('[cancel-course] could not load the course sessions:', siblingErr.message);
    return actionFailure(500, 'INTERNAL_ERROR', 'Could not load the rest of this course.');
  }

  const sessions = ((siblingRows ?? []) as Array<{ id: string; status: string }>).filter((s) =>
    CANCELLABLE.has(s.status),
  );

  if (sessions.length === 0) {
    return actionFailure(400, 'CONFLICT', 'Every session on this course is already cancelled.');
  }

  /*
   * ONE `now` for the whole batch. Each cancellation compares it against that
   * session's own cancellation deadline, and letting the clock advance between
   * them means a course cancelled at the exact moment a deadline passes could
   * refund one session and not the next, for no reason the customer could see.
   */
  const now = params.now ?? new Date().toISOString();

  const failed: CancelCourseData['failed'] = [];
  const notifications: Array<() => Promise<void>> = [];
  let cancelled = 0;
  let refunded = 0;

  for (const session of sessions) {
    const result = await cancelBookingForGuest(clients, {
      bookingId: session.id,
      actor,
      now,
    });
    // Present on BOTH variants: a failed cancellation can still owe an email.
    if (result.scheduleNotification) notifications.push(result.scheduleNotification);

    if (!result.ok) {
      failed.push({ booking_id: session.id, reason: result.message });
      continue;
    }
    cancelled += 1;
    if (result.data.refund_eligible) refunded += 1;
  }

  /*
   * Nothing cancelled is a failure, not a success with a count of zero. The
   * caller renders a confirmation off the back of `ok`, and "your course is
   * cancelled" over six refusals is the worst outcome available here.
   */
  if (cancelled === 0) {
    // Spread rather than passed to `actionFailure`, whose fourth argument is
    // `extra` and lands in the RESPONSE BODY: a closure put there would be
    // serialised away and never scheduled.
    return {
      ...actionFailure(
        409,
        'CONFLICT',
        failed[0]?.reason ?? 'None of these sessions could be cancelled.',
      ),
      scheduleNotification: runAll(notifications),
    };
  }

  const sessionWord = (n: number) => `${n} session${n === 1 ? '' : 's'}`;
  const message = failed.length
    ? `${sessionWord(cancelled)} cancelled. ${sessionWord(failed.length)} could not be cancelled, so please contact the venue about ${failed.length === 1 ? 'it' : 'those'}.`
    : `Your course is cancelled, all ${sessionWord(cancelled)}.`;

  return actionSuccess(
    {
      success: true as const,
      message:
        refunded > 0
          ? `${message} Refunds for ${sessionWord(refunded)} are on their way.`
          : message,
      cancelled_count: cancelled,
      refunded_count: refunded,
      failed,
    },
    runAll(notifications),
  );
}

/**
 * One closure for the adapter to schedule, because `GuestActionResult` carries
 * one. Sequential rather than `Promise.all`: these send email and SMS through
 * the venue's provider, and a course is a handful of sessions, so there is
 * nothing to gain from firing them together and a rate limit to trip.
 */
function runAll(notifications: Array<() => Promise<void>>): (() => Promise<void>) | undefined {
  if (notifications.length === 0) return undefined;
  return async () => {
    for (const send of notifications) {
      // Each already swallows its own errors; this guards the loop itself, so
      // one failure cannot stop the remaining sessions being notified.
      try {
        await send();
      } catch (err) {
        console.error('[cancel-course] a session notification failed:', err);
      }
    }
  };
}
