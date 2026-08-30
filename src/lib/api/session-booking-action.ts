import { NextResponse, after } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { apiError, NO_STORE_HEADERS, UNAUTHORISED_ERROR } from '@/lib/api/error-codes';
import type {
  GuestActionActor,
  GuestActionClients,
  GuestActionResult,
} from '@/lib/booking/guest-actions/types';

/**
 * The adapter every session-authenticated booking action route is (P2-1, AD1).
 *
 * Four routes plus their v1 aliases would otherwise be eight copies of the same
 * twenty-five lines: authenticate, build the two clients, call the service,
 * schedule the deferred comms, shape the result. Eight copies is eight chances
 * for one of them to forget `after(result.scheduleNotification)` and silently
 * stop sending a cancellation email, or to return 403 where the rest return
 * 404 and hand an id-prober a way to tell a real booking from an imaginary one.
 *
 * **The body is read inside `run`, never before it.** `account-routes-auth.test.ts`
 * asserts that no `/api/account` handler touches its body before answering an
 * anonymous caller 401, because a handler that parses first lets anyone push
 * work onto the server. Taking a callback rather than a parsed body is what
 * makes that structural instead of a rule each route has to remember.
 *
 * It does not import anything from `guest-actions/` except types, and nothing in
 * `guest-actions/` imports `next/server`. That boundary is the point of AD1:
 * a service that can return a `Response` can only be called over HTTP, which is
 * how `DELETE /api/v1/me/bookings/[id]` ended up POSTing to `/api/confirm`
 * against its own deployment.
 */
export async function runSessionBookingAction<T>(
  request: Request,
  run: (context: {
    clients: GuestActionClients;
    actor: Extract<GuestActionActor, { kind: 'session' }>;
  }) => Promise<GuestActionResult<T>>,
): Promise<NextResponse> {
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(apiError(UNAUTHORISED_ERROR, 'UNAUTHENTICATED'), {
      status: 401,
      headers: NO_STORE_HEADERS,
    });
  }

  const result = await run({
    clients: { admin: getSupabaseAdminClient(), session: supabase },
    actor: { kind: 'session', userId: user.id },
  });

  // The service hands deferred comms back rather than calling `after()` itself,
  // because nothing under `guest-actions/` may import `next/server`. Scheduled
  // before the failure branch on purpose: a failed action can still owe an
  // email, and `GuestActionResult` carries the closure on both variants for
  // exactly that reason.
  if (result.scheduleNotification) after(result.scheduleNotification);

  if (!result.ok) {
    return NextResponse.json(
      // `code` is additive here, unlike on `/api/confirm` where P0-9's
      // snapshots pin the body byte for byte. A client branches on the code
      // instead of matching English prose, which is what P0-11's union is for.
      { error: result.message, code: result.code, ...(result.extra ?? {}) },
      { status: result.status, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(result.data, { headers: NO_STORE_HEADERS });
}

/**
 * A request body, or `{}` when there is not one.
 *
 * Every action route here takes an optional body, and a customer who sends none
 * should get the action's own validation message rather than a parse error from
 * the adapter. Call it INSIDE `run`, so the 401 above still happens first.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
