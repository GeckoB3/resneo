import { NextResponse } from 'next/server';
import type { ScheduleReadFailure } from '@/lib/availability/availability-read-failure';

/**
 * The third state, for guest-facing availability routes (Stage 7, decision (J)).
 *
 * Until now every such route had two answers: a slot list, or a 500. A schedule read that
 * failed open produced neither, because the engine substituted an empty result and carried
 * on: the guest saw a confident, wrong list built on data nobody could read. This is the
 * missing answer, "I do not know", and it is deliberately NOT an error.
 *
 * 503 with `Retry-After`, not 500: this is temporary and retrying is the right move, which
 * is exactly what 503 means and 500 does not. The body carries `unavailable: true` so a
 * client can render a retry card rather than a generic failure.
 *
 * The operator's reasoning, recorded so the trade is not silently reversed later: a wrong
 * booking costs staff time and goodwill to untangle, while a retry message costs one
 * refresh. Refusing to answer is cheaper than answering wrongly.
 *
 * GUEST PATHS ONLY. Staff write-path validators keep failing open, consistently with each
 * other, because stopping staff from scheduling anything during a database wobble is a
 * different trade with a different answer.
 */

/** Seconds a client should wait before retrying. Short: these failures are usually blips. */
const RETRY_AFTER_SECONDS = 15;

export function scheduleUnavailableResponse(failures: readonly ScheduleReadFailure[]): NextResponse {
  return NextResponse.json(
    {
      unavailable: true,
      error: 'Availability is temporarily unavailable. Please try again in a moment.',
      retry_after_seconds: RETRY_AFTER_SECONDS,
      // Which tables failed, for support and for the Sentry event that already fired.
      // Deliberately no venue or calendar ids: this reaches an unauthenticated guest.
      tables: [...new Set(failures.map((f) => f.table))],
    },
    {
      status: 503,
      headers: {
        'Retry-After': String(RETRY_AFTER_SECONDS),
        // Never cache a temporary failure, at any layer.
        'Cache-Control': 'no-store',
      },
    },
  );
}

/**
 * Runs a guest-facing route handler and converts a KNOWN-INCOMPLETE success into a 503.
 *
 * Five routes were each carrying their own copy of this three-line rule, which is exactly
 * the shape that produced the six working-hours implementations Stage 5 collapsed: identical
 * by coincidence, free to drift, and testable only by exercising every route. Two of those
 * routes (`class-instances`, `resource-calendar`) cannot reach a successful response on any
 * venue without classes or resources configured, so per-route proof was not available for
 * them at all. One shared helper is provable once and cannot drift.
 *
 * The rule, and why each half matters:
 *   - **failures and a success** -> 503. The body was built without one of its inputs.
 *   - **failures and a 4xx** -> leave it. A 400 is already a correct answer about the
 *     request itself and says nothing about schedule data; replacing it would turn "you
 *     asked for something invalid" into "come back later", which is worse advice and hides
 *     a client bug.
 *   - **no failures** -> leave it, whatever it is.
 *
 * **NEVER wrap a handler that opens its own `withScheduleReadContext` per item.** The
 * collector reads `AsyncLocalStorage.getStore()`, which returns the INNERMOST store, so a
 * per-item context shadows this one: every failure it captures is invisible here, and this
 * wrapper returns a clean 200 having protected nothing. Failures from reads OUTSIDE that
 * loop are still converted, so the result is partial and unpredictable rather than simply
 * inert, and a handler-level injection fixture cannot tell the two apart. `venue/waitlist`
 * degrades per entry for that reason and must stay unwrapped; `schedule-read-context.test.ts`
 * pins the nesting behaviour and `schedule-fail-closed-coverage.test.ts` guards the route.
 *
 * **A wrapper is also inert on a path that reports nothing.** It converts a success only
 * when a failure was REPORTED, so a route whose reads discard `error` gains an appearance
 * of protection and no protection. `getCalendarGrid` was exactly that until it was
 * instrumented. Check the path reports before wrapping it.
 */
export async function withScheduleFailClosed(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const { withScheduleReadContext } = await import('@/lib/availability/schedule-read-context');
  const { result, failures } = await withScheduleReadContext(handler);
  if (failures.length > 0 && result.status < 400) return scheduleUnavailableResponse(failures);
  return result;
}
