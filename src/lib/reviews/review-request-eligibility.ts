/**
 * How often a guest may be asked for a Google review.
 *
 * Fixed rather than configurable, deliberately: it is one fewer setting to explain, and a venue
 * that wants to ask every regular after every visit is a venue heading for complaints and ignored
 * emails. Six months is long enough that the ask still feels like an occasion.
 *
 * The cap suppresses the review block only. The thank-you email itself always sends, so nothing a
 * venue relies on disappears because someone visits often.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueEmailData } from '@/lib/emails/types';
import { hasUsableGoogleReviewLink } from '@/lib/reviews/google-review-link';

export const REVIEW_REQUEST_INTERVAL_DAYS = 182;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure half: is `lastAskedAt` far enough in the past to ask again? */
export function reviewRequestIntervalElapsed(
  lastAskedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastAskedAt) return true;
  const then = new Date(lastAskedAt).getTime();
  if (Number.isNaN(then)) return true;
  return nowMs - then >= REVIEW_REQUEST_INTERVAL_DAYS * DAY_MS;
}

/** True when this send should carry the review block. */
export async function shouldIncludeReviewRequest(
  supabase: SupabaseClient,
  opts: { venue: VenueEmailData; guestId?: string | null; nowMs?: number },
): Promise<boolean> {
  if (!opts.venue.review_request_enabled) return false;
  if (!hasUsableGoogleReviewLink(opts.venue.google_review_url)) return false;
  // No guest record means no way to honour the cap, so we do not ask rather than risk asking every
  // visit. Walk-ins without a contact record are the main case, and they have no inbox anyway.
  if (!opts.guestId) return false;

  const { data } = await supabase
    .from('guests')
    .select('last_review_request_at')
    .eq('id', opts.guestId)
    .maybeSingle();

  return reviewRequestIntervalElapsed(
    (data as { last_review_request_at?: string | null } | null)?.last_review_request_at ?? null,
    opts.nowMs ?? Date.now(),
  );
}

/** Record that we asked, so the cap holds. Failure here is logged, never thrown: a missed stamp
 *  means one extra ask later, whereas a throw would lose an email that has already been sent. */
export async function markReviewRequestSent(
  supabase: SupabaseClient,
  guestId: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const { error } = await supabase
    .from('guests')
    .update({ last_review_request_at: nowIso })
    .eq('id', guestId);
  if (error) {
    console.error('[review-request] could not stamp last_review_request_at:', guestId, error.message);
  }
}

/** Venue payload with the review block forced off, for a send that is inside the cap. */
export function venueWithoutReviewRequest(venue: VenueEmailData): VenueEmailData {
  return { ...venue, review_request_enabled: false };
}
