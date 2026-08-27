import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiErrorCode } from '@/lib/api/error-codes';

/**
 * The guest booking action service layer (AD1, P0-4).
 *
 * WHY IT EXISTS. Cancel is implemented three times in this codebase: here for
 * guests, in `PATCH /api/venue/bookings/[id]` for staff, and in
 * `cancelStaffBookingWithNotify`. The guest one lived inside a 2,050-line route
 * handler with 48 `NextResponse.json` returns interleaved through the logic, so
 * the only way to reuse it was over HTTP. `DELETE /api/v1/me/bookings/[id]` did
 * exactly that: it authenticated a session, then minted its own HMAC and POSTed
 * to `/api/confirm` against its own deployment, laundering a session-
 * authenticated request into an HMAC-authenticated one. That is the pattern
 * this module exists to remove.
 *
 * THE RULE. Nothing in `guest-actions/` may import `next/server`. A service
 * that returns a `Response` can only ever be called by an HTTP route, which is
 * how the laundering happened in the first place. Deferred work is RETURNED for
 * the adapter to schedule, so the service stays callable without a request
 * context.
 */

/**
 * Both clients, deliberately (AD1, corrected).
 *
 * An earlier draft took `admin` alone and required by convention that the
 * caller had already read the booking through `bookings_account_safe` on the
 * session client. Nothing in that signature could enforce it, so AD8's second
 * layer degraded to something a call site could simply forget. Taking both
 * means the service performs the ownership read ITSELF for session actors and
 * refuses when the row is absent.
 *
 * `session` is null for token and HMAC actors, which have no session to read
 * as. The two-client shape has precedent in
 * `cancelStaffBookingWithNotify(admin, staffDb, ...)`.
 */
export interface GuestActionClients {
  admin: SupabaseClient;
  session: SupabaseClient | null;
}

/**
 * Who is acting, and what proof they hold.
 *
 * THE SESSION ACTOR CARRIES `userId` ONLY. An earlier draft also carried
 * `guestIds`, and the Remediation Register was right to reject it: guest ids
 * are the RESULT of an authorisation decision, so accepting them means the
 * service trusts its caller to have made that decision correctly, which is the
 * same mistake as trusting a caller to have done the ownership read. The
 * service derives them from `auth.uid()` through the session client instead.
 */
export type GuestActionActor =
  | { kind: 'token'; token: string }
  | { kind: 'hmac'; hmac: string }
  | { kind: 'session'; userId: string };

/**
 * Every function returns a result, never a Response.
 *
 * `message` is the customer-facing string and is the ONLY place that copy
 * lives, so `/api/confirm`, the portal routes and `/manage` cannot drift apart.
 * `status` preserves the route's existing HTTP codes exactly, including the
 * `410` on an already-used token. `code` is drawn from P0-11's frozen union so
 * a client can branch on the outcome without matching English prose.
 *
 * `scheduleNotification` mirrors `cancelStaffBookingWithNotify`'s existing
 * shape rather than inventing a new one. It is present on BOTH variants
 * because the route defers comms at points that are not always the last thing
 * before a success return, and a type that could not express a deferred effect
 * on a failure would push the next such case back inline.
 */
export type GuestActionResult<T> =
  | { ok: true; data: T; scheduleNotification?: () => Promise<void> }
  | {
      ok: false;
      code: ApiErrorCode;
      message: string;
      status: number;
      scheduleNotification?: () => Promise<void>;
      /**
       * Extra fields the existing route returns alongside `error` on some
       * failures, carried so the adapter can reproduce today's body byte for
       * byte. P0-9's snapshots are the gate, and they include these.
       */
      extra?: Record<string, unknown>;
    };

/** Convenience constructors, so call sites read as decisions rather than object literals. */
export function actionFailure(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra?: Record<string, unknown>,
): Extract<GuestActionResult<never>, { ok: false }> {
  return { ok: false, code, message, status, ...(extra ? { extra } : {}) };
}

export function actionSuccess<T>(
  data: T,
  scheduleNotification?: () => Promise<void>,
): Extract<GuestActionResult<T>, { ok: true }> {
  return scheduleNotification ? { ok: true, data, scheduleNotification } : { ok: true, data };
}

/**
 * The booking row every guest action starts from, typed to the route's own
 * SELECT rather than left as `Record<string, unknown>`.
 *
 * The route worked from an untyped row and sprinkled `as string` casts through
 * the logic to compensate. Naming the columns once here removes those and, more
 * usefully, means a column dropped from the SELECT is a compile error instead of
 * an `undefined` that quietly changes a branch.
 */
export interface GuestActionBooking {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time: string | null;
  party_size: number;
  status: string;
  deposit_status: string | null;
  deposit_amount_pence: number | null;
  stripe_payment_intent_id: string | null;
  cancellation_deadline: string | null;
  confirm_token_hash: string | null;
  confirm_token_used_at: string | null;
  service_id: string | null;
  practitioner_id: string | null;
  appointment_service_id: string | null;
  calendar_id: string | null;
  service_item_id: string | null;
  service_variant_id: string | null;
  addons_total_duration_minutes: number | null;
  experience_event_id: string | null;
  class_instance_id: string | null;
  resource_id: string | null;
  event_session_id: string | null;
  updated_at: string | null;
  guest_attendance_confirmed_at: string | null;
}

/**
 * Turn an HTTP-shaped `(body, { status })` pair into a result.
 *
 * WHY THIS EXISTS, because it looks like a smell. The reschedule path was 1,085
 * lines with 37 `NextResponse.json` returns woven through it, and the acceptance
 * for extracting it was that P0-9's 21 snapshots do not move. Rewriting 37
 * return sites by hand is 37 chances to change a status or drop a field;
 * replacing `NextResponse.json(` with `jsonActionResult(` is one mechanical
 * substitution that cannot silently reshape a body.
 *
 * It is NOT a licence to keep writing HTTP shapes in the service layer. New
 * code calls `actionFailure`/`actionSuccess` directly with a considered code.
 *
 * `code` is taken from the body when the route already shipped one, then from
 * an explicit override, then from the status. The status-derived default is
 * deliberately coarse: it is a floor, not a substitute for naming the outcome,
 * and the sites P0-11 reserved specific codes for override it.
 */
const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_FAILED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  410: 'CONFLICT',
  412: 'STALE_RESOURCE',
  500: 'INTERNAL_ERROR',
  502: 'INTERNAL_ERROR',
  503: 'INTERNAL_ERROR',
};

export function jsonActionResult<T>(
  body: Record<string, unknown>,
  init?: { status?: number; code?: ApiErrorCode },
): GuestActionResult<T> {
  const status = init?.status ?? 200;
  if (status < 400) return { ok: true, data: body as T };

  const { error, ...rest } = body;
  const bodyCode = typeof rest.code === 'string' ? (rest.code as ApiErrorCode) : undefined;
  return {
    ok: false,
    status,
    code: bodyCode ?? init?.code ?? STATUS_CODES[status] ?? 'INTERNAL_ERROR',
    message: typeof error === 'string' ? error : 'Something went wrong.',
    ...(Object.keys(rest).length > 0 ? { extra: rest } : {}),
  };
}
