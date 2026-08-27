import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * Writing portal metrics (P0-10, enables §5B and §5A's revert thresholds).
 *
 * FAIL-SOFT BY CONSTRUCTION. Every emitter swallows its own errors and returns
 * void. Metrics must never be able to break the flow they measure: a customer
 * signing in must not see a 500 because an analytics insert failed. Callers
 * therefore need no try/catch, and there is deliberately no way to await a
 * result that could tempt one into being added.
 *
 * The vocabulary is a closed union, not free strings. §5A reads revert
 * thresholds off these names, so a typo in an event type is a threshold that
 * silently never fires. Adding a member is a deliberate act with a matching
 * read query in ./portal-metrics.ts.
 */

export const PORTAL_EVENT_TYPES = [
  /** A customer arrived at the portal. `route` says how. */
  'portal_entry',
  /** They reached an authenticated portal page: the funnel completed. */
  'portal_signin_completed',
  /**
   * A one-click portal token failed to verify. Reserved now, emitted by P3-4a
   * when verifyPortalToken is wired to it. §5A reads a revert threshold off
   * this event, so the name is fixed before anything depends on it.
   */
  'portal_token_verify_failed',
  /** A booking was cancelled. `surface` distinguishes portal from token page. */
  'portal_booking_cancelled',
  /** A booking was rescheduled. `surface` as above. */
  'portal_booking_rescheduled',
] as const;

export type PortalEventType = (typeof PORTAL_EVENT_TYPES)[number];

/** How a customer reached the portal. Split per §5B. */
export type PortalEntryRoute = 'one_click_token' | 'magic_link' | 'direct_sign_in';

/** Where an action happened: the portal, or the emailed token page. */
export type PortalActionSurface = 'portal' | 'token_link';

export interface PortalEventInput {
  eventType: PortalEventType;
  /** Null before (or without) authentication: a failed entry has no user. */
  userId?: string | null;
  /** Null for cross-venue events; the portal is not venue-scoped. */
  venueId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Record one portal event. Never throws, never rejects: a failure is logged
 * and dropped.
 */
export async function recordPortalEvent(input: PortalEventInput): Promise<void> {
  try {
    const admin = getSupabaseAdminClient();
    const { error } = await admin.from('portal_events').insert({
      event_type: input.eventType,
      user_id: input.userId ?? null,
      venue_id: input.venueId ?? null,
      payload: input.payload ?? {},
    });
    if (error) {
      console.error('[portal-events] insert failed', input.eventType, error.message);
    }
  } catch (err) {
    console.error('[portal-events] emit threw', input.eventType, err);
  }
}

/** A customer arrived at the portal, by `route`. */
export async function recordPortalEntry(params: {
  route: PortalEntryRoute;
  userId?: string | null;
  venueId?: string | null;
}): Promise<void> {
  await recordPortalEvent({
    eventType: 'portal_entry',
    userId: params.userId,
    venueId: params.venueId,
    payload: { route: params.route },
  });
}

/**
 * The customer reached an authenticated portal page. Paired with the entry
 * event by `user_id` to give §5B's completion rate.
 */
export async function recordPortalSignInCompleted(params: {
  userId: string;
  route?: PortalEntryRoute;
}): Promise<void> {
  await recordPortalEvent({
    eventType: 'portal_signin_completed',
    userId: params.userId,
    payload: params.route ? { route: params.route } : {},
  });
}

/**
 * A one-click token failed to verify, with the reason. Reserved for P3-4a.
 * The `reason` is free text on purpose: it is diagnostic, and §5A's threshold
 * counts the events rather than grouping by reason.
 */
export async function recordPortalTokenVerifyFailed(params: {
  reason: string;
  venueId?: string | null;
}): Promise<void> {
  await recordPortalEvent({
    eventType: 'portal_token_verify_failed',
    venueId: params.venueId,
    payload: { reason: params.reason },
  });
}

/** A cancel or reschedule, tagged with the surface it happened on. */
export async function recordPortalBookingAction(params: {
  action: 'cancelled' | 'rescheduled';
  surface: PortalActionSurface;
  bookingId: string;
  userId?: string | null;
  venueId?: string | null;
}): Promise<void> {
  await recordPortalEvent({
    eventType:
      params.action === 'cancelled' ? 'portal_booking_cancelled' : 'portal_booking_rescheduled',
    userId: params.userId,
    venueId: params.venueId,
    payload: { surface: params.surface, booking_id: params.bookingId },
  });
}
