/**
 * A shared-services collective needs two venues (plan §6.7): when a release leaves it with fewer,
 * it ends through `collective_dissolve` with the reason `below_two`, run as the system because the
 * engine lets only the host end a collective by hand. While an invitation is still open it can get
 * back to two, so it waits, as the older reconcile does (a new collective is its host and its
 * invitations until someone accepts).
 *
 * Kept free of other collective imports so the older reconcile can use it without a cycle.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

/** End the collective if it is down to fewer than two venues. True when it ended. */
export async function endIfBelowTwo(admin: SupabaseClient, collectiveId: string): Promise<boolean> {
  const { data: remaining, error } = await admin
    .from('venue_collective_members')
    .select('status')
    .eq('collective_id', collectiveId)
    .in('status', ['active', 'invited']);
  if (error) {
    console.error('[collective] could not count venues:', error.message);
    return false;
  }
  const active = (remaining ?? []).filter((m) => m.status === 'active').length;
  const invited = (remaining ?? []).filter((m) => m.status === 'invited').length;
  if (active >= 2 || (active >= 1 && active + invited >= 2)) return false;
  const { error: dissolveError } = await admin.rpc('collective_dissolve', {
    p_collective_id: collectiveId,
    p_reason: 'below_two',
    p_actor_venue_id: null,
    p_actor_user_id: null,
  });
  if (dissolveError) {
    console.error('[collective] could not end a collective left with one venue:', dissolveError.message);
    return false;
  }
  return true;
}

/** The daily sweep: every live shared-services collective left with fewer than two venues ends. */
export async function endCollectivesBelowTwo(admin: SupabaseClient): Promise<{ ended: number; errors: number }> {
  const { data: collectives, error } = await admin
    .from('venue_collectives')
    .select('id')
    .eq('status', 'active')
    .eq('service_model', 'replicas');
  if (error) {
    console.error('[collective] could not list collectives to check:', error.message);
    return { ended: 0, errors: 1 };
  }
  let ended = 0;
  for (const c of collectives ?? []) {
    if (await endIfBelowTwo(admin, c.id as string)) ended += 1;
  }
  return { ended, errors: 0 };
}

/** The release follow-ups still waiting for a collective, so a caller can run them straight away. */
export async function pendingReleaseFollowups(admin: SupabaseClient, collectiveId: string): Promise<string[]> {
  const { data } = await admin
    .from('collective_operations')
    .select('id')
    .eq('collective_id', collectiveId)
    .eq('kind', 'release_followup')
    .eq('status', 'pending');
  return (data ?? []).map((op) => op.id as string);
}
