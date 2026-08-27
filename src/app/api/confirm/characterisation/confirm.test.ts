/**
 * P0-9 characterisation: POST /api/confirm, action=confirm. 7 rows.
 *
 * Describes the route AS IT IS. The gate for P0-4 is that it lands with zero
 * modified snapshot files; an intended difference needs its own reviewed
 * commit. See ./harness.ts for the three harness decisions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  FIXED_NOW,
  baseBooking,
  freeze,
  makeAdminDb,
  makeCallLog,
  makeRequest,
  expectFrozen,
  type RunOptions,
} from './harness';
const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('@/lib/testing/recording-supabase').makeRecordingDb> | null,
  log: null as ReturnType<typeof makeCallLog> | null,
  hmacValid: true,
  tokenValid: true,
  /**
   * P0-0's `makeAfterStub()` shape, inlined because a `vi.mock` factory is
   * hoisted above imports and cannot reference one. It RUNS the callback: a
   * bare `vi.fn()` silently swallows every deferred email, SMS and push, and
   * the suite would pass while asserting nothing. The precedent suite
   * (`route.card-hold.test.ts`) makes exactly that mistake.
   */
  afterStub: vi.fn((cb: () => unknown) => cb()),
}));

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: hoisted.afterStub,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => hoisted.db!.db,
}));
vi.mock('@/lib/confirm-token', () => ({
  verifyConfirmToken: (...args: unknown[]) => {
    hoisted.log!.record('confirm-token', 'verifyConfirmToken')(...args);
    return hoisted.tokenValid;
  },
}));
vi.mock('@/lib/short-manage-link', () => ({
  verifyBookingHmac: (...args: unknown[]) => {
    hoisted.log!.record('short-manage-link', 'verifyBookingHmac')(...args);
    return hoisted.hmacValid;
  },
}));
vi.mock('@/lib/table-management/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/table-management/lifecycle')>();
  return {
    ...actual,
    // Real transition rules: they decide status outcomes and are part of the
    // behaviour being frozen, not a collaborator to stub out.
    validateBookingStatusTransition: (...args: Parameters<typeof actual.validateBookingStatusTransition>) => {
      hoisted.log!.record('lifecycle', 'validateBookingStatusTransition')(...args);
      return actual.validateBookingStatusTransition(...args);
    },
    applyBookingLifecycleStatusEffects: (...args: unknown[]) => {
      // Second arg only: the first is the supabase client, which is not stable
      // across runs and would churn every snapshot.
      hoisted.log!.record('lifecycle', 'applyBookingLifecycleStatusEffects')(args[1]);
      return Promise.resolve();
    },
  };
});
vi.mock('@/lib/observability/booking-ops-log', () => ({
  logBookingOp: (...args: unknown[]) => hoisted.log!.record('booking-ops-log', 'logBookingOp')(...args),
}));

async function run(opts: RunOptions) {
  hoisted.db = makeAdminDb(opts);
  hoisted.log = makeCallLog();
  const { POST } = await import('../route');
  const res = await POST(makeRequest(opts));
  return freeze(res, hoisted.db, hoisted.log);
}

describe('POST /api/confirm - action=confirm (P0-9, 7 rows)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
    hoisted.hmacValid = true;
    hoisted.tokenValid = true;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('row 1: Pending is refused, deposit must be paid first', async () => {
    const frozen = await run({ booking: baseBooking({ status: 'Pending' }), action: 'confirm' });
    expectFrozen(frozen, { status: 400 });
    expect(frozen).toMatchSnapshot();
  });

  it('row 2: already Confirmed WITH a timestamp is idempotent and writes nothing', async () => {
    const frozen = await run({
      booking: baseBooking({
        status: 'Confirmed',
        guest_attendance_confirmed_at: '2026-05-31T08:00:00+00:00',
      }),
      action: 'confirm',
    });
    expectFrozen(frozen, { status: 200 });
    // The point of the row: an idempotent replay must not write.
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 3: Confirmed WITHOUT a timestamp records attendance only', async () => {
    const frozen = await run({
      booking: baseBooking({ status: 'Confirmed' }),
      action: 'confirm',
    });
    expectFrozen(frozen, { status: 200 });
    // Attendance is stamped; status is NOT re-transitioned and the token is
    // NOT consumed on this path.
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    expect(Object.keys(update?.payload as Record<string, unknown>).sort()).toEqual([
      'guest_attendance_confirmed_at',
      'updated_at',
    ]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 4: Booked confirms, stamps the token, and fires lifecycle effects', async () => {
    const frozen = await run({ booking: baseBooking(), action: 'confirm' });
    expectFrozen(frozen, { status: 200 });
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    expect(Object.keys(update?.payload as Record<string, unknown>).sort()).toEqual([
      'confirm_token_used_at',
      'guest_attendance_confirmed_at',
      'status',
      'updated_at',
    ]);
    // The token IS consumed on this path (route.ts stamps confirm_token_used_at).
    expect((update?.payload as Record<string, unknown>).confirm_token_used_at).toBe(FIXED_NOW);
    expect(
      frozen.externalCalls.some(
        (c) => c.module === 'lifecycle' && c.fn === 'applyBookingLifecycleStatusEffects',
      ),
    ).toBe(true);
    expect(frozen).toMatchSnapshot();
  });

  it('row 5: an invalid transition is refused', async () => {
    const frozen = await run({ booking: baseBooking({ status: 'Cancelled' }), action: 'confirm' });
    expectFrozen(frozen, { status: 400 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 6: a used token is 410 before any status check', async () => {
    const frozen = await run({
      booking: baseBooking({ confirm_token_used_at: '2026-05-31T08:00:00+00:00' }),
      action: 'confirm',
      auth: { token: 'raw-confirm-token' },
    });
    expectFrozen(frozen, { status: 410 });
    expect(frozen.dbWrites).toEqual([]);
    expect(frozen).toMatchSnapshot();
  });

  it('row 7: HMAC on the same fixture confirms AND consumes the token (contradicts the plan)', async () => {
    // FINDING. The plan's matrix says "HMAC on the same fixture to 200 with the
    // token not consumed". That is not what the route does: the standard
    // Booked -> Confirmed write stamps `confirm_token_used_at` unconditionally
    // (route.ts:513-522), whichever credential authorised the request. So an
    // HMAC confirm burns the single-use token the emailed link depends on, and
    // a customer confirming from the portal invalidates their own email link.
    //
    // This row freezes what IS, which is the whole point of characterisation.
    // The risk it removes is real: anyone implementing P0-4 to match the plan's
    // description would CHANGE behaviour while believing they preserved it.
    // Whether the current behaviour is desirable is a separate question for
    // P0-4's owner, and needs its own reviewed commit either way.
    const frozen = await run({
      booking: baseBooking(),
      action: 'confirm',
      auth: { hmac: '9999999999.signature' },
    });
    expectFrozen(frozen, { status: 200 });
    const update = frozen.dbWrites.find((w) => w.op === 'update');
    const payload = update?.payload as Record<string, unknown>;
    expect(payload.confirm_token_used_at, 'the HMAC path consumes the token today').toBe(FIXED_NOW);
    expect(
      frozen.externalCalls.some((c) => c.fn === 'verifyBookingHmac'),
      'the HMAC path must be the one exercised',
    ).toBe(true);
    expect(
      frozen.externalCalls.some((c) => c.fn === 'verifyConfirmToken'),
      'the token verifier must not run when an hmac was supplied',
    ).toBe(false);
    expect(frozen).toMatchSnapshot();
  });
});
