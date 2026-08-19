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
