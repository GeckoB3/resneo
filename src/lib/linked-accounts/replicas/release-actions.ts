/**
 * Leaving and removal on the shared-services model (plan §6.7 "Leave, removal"; contract 7; UX spec
 * J7 and J8; W7).
 *
 * The older routes changed the membership row, sent the older notices and then ran the page's
 * reconcile, which could end the collective or move its hosting by writing the rows directly. On
 * this model all of that belongs to the engine: one release call hands the venue its services, and
 * when fewer than two venues are left the collective ends through `collective_dissolve`, so every
 * venue is released the same way and told once. The notices and photo copies then run from the
 * release's own job, straight away where the time allows and from the cron otherwise.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { engineErrorResponse } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { endIfBelowTwo, pendingReleaseFollowups } from '@/lib/linked-accounts/replicas/below-two';
import { drainReleaseFollowups } from '@/lib/linked-accounts/replicas/release-followups';
import { loadReleaseReview, type ReleaseReview } from '@/lib/linked-accounts/replicas/release-review';

export interface ReleaseContext {
  admin: SupabaseClient;
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
  /** The venue making the change. */
  venueId: string;
  venueName: string;
  userId: string | null;
}

export type ReleaseActionResult =
  | { ok: true; dissolved: boolean; review: ReleaseReview | null }
  | { ok: false; response: NextResponse };

/**
 * Release one membership. `leave` is the member's own; `remove` is the host's. An open invitation
 * being withdrawn is not a release and stays with the older route.
 */
export async function runReleaseAction(
  ctx: ReleaseContext,
  action: 'leave' | 'remove',
  member: { id: string; venueId: string },
): Promise<ReleaseActionResult> {
  const { data: released, error } = await ctx.admin.rpc('collective_release_member', {
    p_member_id: member.id,
    p_reason: action === 'leave' ? 'left' : 'removed',
    p_actor_venue_id: ctx.venueId,
    p_actor_user_id: ctx.userId,
  });
  if (error) {
    return {
      ok: false,
      response: engineErrorResponse(
        error,
        { collective: ctx.collectiveName },
        action === 'leave' ? 'Could not leave. Please try again.' : 'Could not remove that venue. Please try again.',
      ),
    };
  }
  const operationIds: string[] = [];
  const operationId = (released as { operation_id?: string | null } | null)?.operation_id;
  if (operationId) operationIds.push(operationId);

  // A collective needs two venues (§6.7): below that, it ends, through the one path.
  const dissolved = await endIfBelowTwo(ctx.admin, ctx.collectiveId);
  for (const id of dissolved ? await pendingReleaseFollowups(ctx.admin, ctx.collectiveId) : []) {
    if (!operationIds.includes(id)) operationIds.push(id);
  }

  try {
    await drainReleaseFollowups(ctx.admin, { operationIds });
  } catch (err) {
    // The cron picks up whatever did not finish.
    console.error('[collective] release follow-up after the action failed:', err);
  }

  const review = action === 'leave' ? await loadReleaseReview(ctx.admin, member.venueId) : null;
  return { ok: true, dissolved, review };
}
