/**
 * P2-2a: cancelling a course is one action (Register Q-21).
 *
 * `cancelCourseForGuest` is a loop around `cancelBookingForGuest`, so the
 * things worth testing are the ones a loop gets wrong: which sessions it picks
 * up, whether it re-authorises each of them, what it reports when only some
 * succeed, and whether the whole batch shares one clock. The refund, card-hold
 * and credit behaviour belongs to the function it calls and is covered there;
 * repeating it here would test the mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  /** Rows `bookings` returns for the group read, in the order given. */
  siblings: [] as Array<{ id: string; status: string }>,
  /** The anchor booking `loadAndAuthoriseGuestBooking` resolves to. */
  anchor: { id: 'bk-1', group_booking_id: 'grp-1' } as Record<string, unknown> | null,
  /** Booking ids this actor may NOT cancel; each is refused like a stranger's. */
  refuse: new Set<string>(),
  /** Booking ids whose cancellation reports a refund. */
  refunds: new Set<string>(),
  /** Every (bookingId, now) pair `cancelBookingForGuest` was called with. */
  calls: [] as Array<{ bookingId: string; now?: string }>,
  /** Notifications each cancellation handed back, run or not. */
  sent: [] as string[],
  groupFilter: null as string | null,
  readError: null as { message: string } | null,
}));

vi.mock('./authorise', () => ({
  loadAndAuthoriseGuestBooking: async () =>
    hoisted.anchor
      ? { ok: true, data: hoisted.anchor }
      : { ok: false, status: 404, code: 'NOT_FOUND', message: 'Booking not found' },
}));

vi.mock('./cancel', () => ({
  cancelBookingForGuest: async (
    _clients: unknown,
    params: { bookingId: string; now?: string },
  ) => {
    hoisted.calls.push({ bookingId: params.bookingId, now: params.now });
    const schedule = async () => {
      hoisted.sent.push(params.bookingId);
    };
    if (hoisted.refuse.has(params.bookingId)) {
      return {
        ok: false,
        status: 404,
        code: 'NOT_FOUND',
        message: 'Booking not found',
        scheduleNotification: schedule,
      };
    }
    return {
      ok: true,
      data: { success: true, refund_eligible: hoisted.refunds.has(params.bookingId) },
      scheduleNotification: schedule,
    };
  },
}));

function clients() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.select = chain;
  builder.eq = (col: string, val: string) => {
    if (col === 'group_booking_id') hoisted.groupFilter = val;
    return builder;
  };
  builder.order = chain;
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      hoisted.readError
        ? { data: null, error: hoisted.readError }
        : { data: hoisted.siblings, error: null },
    ).then(resolve);
  return { admin: { from: () => builder } as never, session: null };
}

const actor = { kind: 'session' as const, userId: 'user-1' };

async function run(now?: string) {
  const { cancelCourseForGuest } = await import('./cancel-course');
  return cancelCourseForGuest(clients(), { bookingId: 'bk-1', actor, now });
}

beforeEach(() => {
  hoisted.anchor = { id: 'bk-1', group_booking_id: 'grp-1' };
  hoisted.siblings = [
    { id: 'bk-1', status: 'Booked' },
    { id: 'bk-2', status: 'Confirmed' },
    { id: 'bk-3', status: 'Pending' },
  ];
  hoisted.refuse = new Set();
  hoisted.refunds = new Set();
  hoisted.calls = [];
  hoisted.sent = [];
  hoisted.groupFilter = null;
  hoisted.readError = null;
});

describe('cancelCourseForGuest', () => {
  it('cancels every remaining session of the course, not just the one named', async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    expect(hoisted.calls.map((c) => c.bookingId)).toEqual(['bk-1', 'bk-2', 'bk-3']);
    expect(result.ok && result.data.cancelled_count).toBe(3);
  });

  it('scopes the group read to the anchor booking’s own course', async () => {
    // A missing filter would load every booking in the table and cancel the
    // lot. The read is done as ADMIN, so nothing downstream would stop it
    // except the per-session authorisation, which is a thin place to rely on.
    await run();
    expect(hoisted.groupFilter).toBe('grp-1');
  });

  it('leaves sessions that are already cancelled alone', async () => {
    hoisted.siblings = [
      { id: 'bk-1', status: 'Booked' },
      { id: 'bk-2', status: 'Cancelled' },
      { id: 'bk-3', status: 'Completed' },
    ];
    const result = await run();
    expect(hoisted.calls.map((c) => c.bookingId)).toEqual(['bk-1']);
    expect(result.ok && result.data.cancelled_count).toBe(1);
  });

  it('gives every session in the batch the SAME clock', async () => {
    // Each cancellation compares `now` against its own deadline. Letting the
    // clock advance between them means a course cancelled on the stroke of a
    // deadline could refund one session and not the next.
    await run('2026-06-01T09:00:00.000Z');
    expect(new Set(hoisted.calls.map((c) => c.now))).toEqual(
      new Set(['2026-06-01T09:00:00.000Z']),
    );
  });

  it('defaults that clock rather than leaving it unset', async () => {
    // The vacuity guard on the row above: `undefined` everywhere would also be
    // one distinct value, and would let each cancellation read its own clock.
    await run();
    expect(hoisted.calls.every((c) => typeof c.now === 'string' && c.now !== '')).toBe(true);
    expect(new Set(hoisted.calls.map((c) => c.now)).size).toBe(1);
  });

  it('reports a partial cancellation instead of claiming the course is gone', async () => {
    // There is no transaction across the sessions, because each may refund
    // through Stripe. Five of six is a real state and the customer has to be
    // told, or they believe they owe nothing for a session they are still on.
    hoisted.refuse = new Set(['bk-3']);
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.cancelled_count).toBe(2);
    expect(result.ok && result.data.failed).toEqual([
      { booking_id: 'bk-3', reason: 'Booking not found' },
    ]);
    expect(result.ok && result.data.message).toMatch(/could not be cancelled/i);
    expect(result.ok && result.data.message).not.toMatch(/your course is cancelled/i);
  });

  it('says the course is cancelled only when all of it was', async () => {
    const result = await run();
    expect(result.ok && result.data.message).toMatch(/your course is cancelled/i);
    expect(result.ok && result.data.failed).toEqual([]);
  });

  it('fails rather than succeeding with a count of zero', async () => {
    // The caller renders a confirmation off the back of `ok`. "Your course is
    // cancelled" over three refusals is the worst outcome available here.
    hoisted.refuse = new Set(['bk-1', 'bk-2', 'bk-3']);
    const result = await run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(409);
  });

  it('still sends what the refused sessions owed', async () => {
    // `scheduleNotification` is on BOTH result variants for this reason: a
    // cancellation that failed can still owe an email.
    hoisted.refuse = new Set(['bk-1', 'bk-2', 'bk-3']);
    const result = await run();
    await result.scheduleNotification?.();
    expect(hoisted.sent).toEqual(['bk-1', 'bk-2', 'bk-3']);
  });

  it('hands back one notification closure covering every session', async () => {
    const result = await run();
    expect(hoisted.sent, 'notifications fired during the action, not after it').toEqual([]);
    await result.scheduleNotification?.();
    expect(hoisted.sent).toEqual(['bk-1', 'bk-2', 'bk-3']);
  });

  it('counts the refunds it actually got', async () => {
    hoisted.refunds = new Set(['bk-1', 'bk-2']);
    const result = await run();
    expect(result.ok && result.data.refunded_count).toBe(2);
    expect(result.ok && result.data.message).toMatch(/refunds for 2 sessions/i);
  });

  it('says nothing about refunds when there were none', async () => {
    const result = await run();
    expect(result.ok && result.data.message).not.toMatch(/refund/i);
  });

  it('refuses a booking that is not part of a course', async () => {
    hoisted.anchor = { id: 'bk-1', group_booking_id: null };
    const result = await run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(400);
    expect(!result.ok && result.message).toMatch(/not part of a course/i);
    expect(hoisted.calls, 'it cancelled something anyway').toEqual([]);
  });

  it('passes the anchor’s authorisation failure straight through', async () => {
    // Somebody else's booking is a 404 here exactly as it is on a single
    // cancel, so an id-prober learns nothing from asking for a course.
    hoisted.anchor = null;
    const result = await run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(404);
    expect(hoisted.calls).toEqual([]);
  });

  it('does not cancel half a course when the group read fails', async () => {
    hoisted.readError = { message: 'connection reset' };
    const result = await run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(500);
    expect(hoisted.calls).toEqual([]);
  });

  it('refuses when every session is already cancelled', async () => {
    hoisted.siblings = [
      { id: 'bk-1', status: 'Cancelled' },
      { id: 'bk-2', status: 'Cancelled' },
    ];
    const result = await run();
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/already cancelled/i);
  });
});
