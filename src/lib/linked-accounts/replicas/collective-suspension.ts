/**
 * Following each venue's subscription in its collective (plan §6.7 "suspended_at"; UX spec N36,
 * N37, N23; W7).
 *
 * Once a day, before the verifier checks its 30-day deadlines, every active membership of a
 * shared-services collective is compared with its venue's subscription, using the same rule the
 * account links use (a failed payment or a fully expired plan blocks it; a trial, a paid-through
 * cancellation or a comped account does not). A venue that has lapsed is suspended, and one that
 * has come back is resumed, each through the engine, which audits it, hides or shows its
 * calendars, tells the venue, and pauses the page when the venue is the host.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateLinkEligibility, type LinkEligibilityVenue } from '@/lib/linked-accounts/eligibility';

export interface SuspensionOutcome {
  suspended: number;
  resumed: number;
  errors: number;
}

export async function syncMemberSuspensions(
  admin: SupabaseClient,
  opts: { now?: () => number } = {},
): Promise<SuspensionOutcome> {
  const now = (opts.now ?? Date.now)();
  const outcome: SuspensionOutcome = { suspended: 0, resumed: 0, errors: 0 };

  const { data: collectives } = await admin
    .from('venue_collectives')
    .select('id')
    .eq('status', 'active')
    .eq('service_model', 'replicas');
  const ids = (collectives ?? []).map((c) => c.id as string);
  if (ids.length === 0) return outcome;

  const { data: members } = await admin
    .from('venue_collective_members')
    .select('id, venue_id, suspended_at')
    .in('collective_id', ids)
    .eq('status', 'active');
  if (!members || members.length === 0) return outcome;

  const venueIds = [...new Set(members.map((m) => m.venue_id as string))];
  const { data: venues } = await admin
    .from('venues')
    .select('id, name, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source')
    .in('id', venueIds);
  const byId = new Map((venues ?? []).map((v) => [v.id as string, v as unknown as LinkEligibilityVenue]));

  for (const member of members) {
    const venue = byId.get(member.venue_id as string);
    // A venue we cannot read is left as it is: suspending on missing data would hide a paying venue.
    if (!venue) continue;
    const lapsed = !evaluateLinkEligibility(venue, now).canCreate;
    const suspended = member.suspended_at != null;
    if (lapsed === suspended) continue;

    const { data, error } = await admin.rpc('collective_set_member_suspended', {
      p_member_id: member.id as string,
      p_suspended: lapsed,
    });
    if (error) {
      console.error('[collective] could not update a suspension:', member.id, error.message);
      outcome.errors += 1;
      continue;
    }
    if ((data as { changed?: boolean } | null)?.changed) {
      if (lapsed) outcome.suspended += 1;
      else outcome.resumed += 1;
    }
  }
  return outcome;
}
