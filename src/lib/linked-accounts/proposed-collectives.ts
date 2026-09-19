/**
 * The collective that rides on a link request, and what a host still has to do once the other venue
 * is in (Docs/link-and-collective-setup-wizard-plan.md, L7, L8 and L11).
 *
 * Nothing is stored to tie a request to a collective. The invitation is the `venue_collective_members`
 * row with `status = 'invited'` whose collective is hosted by the venue that sent the request, which
 * is exactly what the setup flow creates and what the Create dialog creates too. Both feeds derive it
 * the same way, so a collective proposed by either path is shown the same way.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { dissolvedCollectiveSlug } from '@/lib/linked-accounts/collectives';
import { drainReleaseFollowups } from '@/lib/linked-accounts/replicas/release-followups';
import { pendingReleaseFollowups } from '@/lib/linked-accounts/replicas/below-two';

type Row = Record<string, unknown>;

export interface ProposedCollective {
  id: string;
  name: string;
  slug: string;
  hostVenueId: string;
  /** This venue's invitation row. */
  memberId: string;
  serviceModel: string;
}

/** Every open invitation to `venueId`, keyed by the host venue that sent it. */
export async function loadInvitationsByHost(
  admin: SupabaseClient,
  venueId: string,
): Promise<Map<string, ProposedCollective>> {
  const out = new Map<string, ProposedCollective>();
  const { data: invitations } = await admin
    .from('venue_collective_members')
    .select('id, collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'invited');
  const rows = (invitations ?? []) as Row[];
  if (rows.length === 0) return out;
  const { data: collectives } = await admin
    .from('venue_collectives')
    .select('id, name, slug, host_venue_id, status, service_model')
    .in('id', rows.map((r) => r.collective_id as string))
    .eq('status', 'active');
  for (const c of (collectives ?? []) as Row[]) {
    const invitation = rows.find((r) => r.collective_id === c.id);
    if (!invitation) continue;
    out.set(c.host_venue_id as string, {
      id: c.id as string,
      name: c.name as string,
      slug: c.slug as string,
      hostVenueId: c.host_venue_id as string,
      memberId: invitation.id as string,
      serviceModel: (c.service_model as string | null) ?? 'legacy_copies',
    });
  }
  return out;
}

/** The open invitations `hostVenueId` has sent from the collective it hosts, keyed by invitee. */
export async function loadInvitationsSentByHost(
  admin: SupabaseClient,
  hostVenueId: string,
): Promise<Map<string, { id: string; name: string; slug: string }>> {
  const out = new Map<string, { id: string; name: string; slug: string }>();
  const { data: hosted } = await admin
    .from('venue_collectives')
    .select('id, name, slug')
    .eq('host_venue_id', hostVenueId)
    .eq('status', 'active');
  const collectives = (hosted ?? []) as Row[];
  if (collectives.length === 0) return out;
  const { data: invitations } = await admin
    .from('venue_collective_members')
    .select('venue_id, collective_id')
    .in('collective_id', collectives.map((c) => c.id as string))
    .eq('status', 'invited');
  for (const row of (invitations ?? []) as Row[]) {
    const c = collectives.find((x) => x.id === row.collective_id);
    if (c) out.set(row.venue_id as string, { id: c.id as string, name: c.name as string, slug: c.slug as string });
  }
  return out;
}

/** Whether at least one calendar offers at least one service on the page: the page can take a booking. */
async function collectiveHasBookableService(admin: SupabaseClient, collectiveId: string): Promise<boolean> {
  const { data: items } = await admin
    .from('collective_service_items')
    .select('id, master_service_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const masterIds = ((items ?? []) as Row[]).map((i) => i.master_service_id as string | null).filter((id): id is string => Boolean(id));
  if (masterIds.length === 0) return false;
  const { data: replicas } = await admin
    .from('collective_service_replicas')
    .select('replica_service_id')
    .eq('collective_id', collectiveId)
    .is('released_at', null);
  const serviceIds = [
    ...masterIds,
    ...((replicas ?? []) as Row[]).map((r) => r.replica_service_id as string | null).filter((id): id is string => Boolean(id)),
  ];
  const { data: assignments } = await admin
    .from('calendar_service_assignments')
    .select('id')
    .in('service_item_id', serviceIds)
    .limit(1);
  return (assignments ?? []).length > 0;
}

export interface MemberWaiting {
  collectiveId: string;
  name: string;
  hostName: string;
}

/**
 * The collectives `venueId` has joined as a member whose page is not live yet: the host is still
 * putting services and calendars on it, and nothing is needed from the member (plan §4).
 */
export async function loadMemberWaiting(admin: SupabaseClient, venueId: string): Promise<MemberWaiting[]> {
  const { data: memberships } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  const ids = ((memberships ?? []) as Row[]).map((m) => m.collective_id as string);
  if (ids.length === 0) return [];
  const { data: collectives } = await admin
    .from('venue_collectives')
    .select('id, name, host_venue_id, status, service_model')
    .in('id', ids)
    .eq('status', 'active')
    .eq('service_model', 'replicas')
    .neq('host_venue_id', venueId);
  const out: MemberWaiting[] = [];
  for (const c of (collectives ?? []) as Row[]) {
    if (await collectiveHasBookableService(admin, c.id as string)) continue;
    const { data: host } = await admin.from('venues').select('name').eq('id', c.host_venue_id as string).maybeSingle();
    out.push({ collectiveId: c.id as string, name: c.name as string, hostName: ((host as Row | null)?.name as string | null) ?? 'The host' });
  }
  return out;
}

/** The invitation from `hostVenueId` to `inviteeVenueId`, if one is open. */
export async function loadInvitationForLink(
  admin: SupabaseClient,
  pair: { hostVenueId: string; inviteeVenueId: string },
): Promise<ProposedCollective | null> {
  const byHost = await loadInvitationsByHost(admin, pair.inviteeVenueId);
  return byHost.get(pair.hostVenueId) ?? null;
}

export interface CollectiveSetupNeed {
  collectiveId: string;
  name: string;
  slug: string;
  /** The venues in besides the host. */
  memberNames: string[];
  reason: 'no_services' | 'no_calendars';
}

/**
 * The collectives `venueId` hosts that have two venues in and are not live yet: nothing on the page,
 * or nothing on the page that any calendar offers. Once one calendar offers one service the page is
 * live and the Collective area's "What needs you" takes over.
 */
export async function loadCollectiveSetupNeeds(admin: SupabaseClient, venueId: string): Promise<CollectiveSetupNeed[]> {
  const { data: hosted } = await admin
    .from('venue_collectives')
    .select('id, name, slug')
    .eq('host_venue_id', venueId)
    .eq('status', 'active')
    .eq('service_model', 'replicas');
  const out: CollectiveSetupNeed[] = [];
  for (const c of (hosted ?? []) as Row[]) {
    const collectiveId = c.id as string;
    const { data: members } = await admin
      .from('venue_collective_members')
      .select('venue_id')
      .eq('collective_id', collectiveId)
      .eq('status', 'active');
    const otherIds = ((members ?? []) as Row[]).map((m) => m.venue_id as string).filter((id) => id !== venueId);
    if (otherIds.length === 0) continue;

    const { data: items } = await admin
      .from('collective_service_items')
      .select('id, master_service_id')
      .eq('collective_id', collectiveId)
      .eq('status', 'active');
    const masterIds = ((items ?? []) as Row[]).map((i) => i.master_service_id as string | null).filter((id): id is string => Boolean(id));

    let reason: CollectiveSetupNeed['reason'] | null = null;
    if (masterIds.length === 0) {
      reason = 'no_services';
    } else {
      const { data: replicas } = await admin
        .from('collective_service_replicas')
        .select('replica_service_id')
        .eq('collective_id', collectiveId)
        .is('released_at', null);
      const serviceIds = [
        ...masterIds,
        ...((replicas ?? []) as Row[]).map((r) => r.replica_service_id as string | null).filter((id): id is string => Boolean(id)),
      ];
      const { data: assignments } = await admin
        .from('calendar_service_assignments')
        .select('id')
        .in('service_item_id', serviceIds)
        .limit(1);
      if ((assignments ?? []).length === 0) reason = 'no_calendars';
    }
    if (!reason) continue;

    const { data: venues } = await admin.from('venues').select('id, name').in('id', otherIds);
    out.push({
      collectiveId,
      name: c.name as string,
      slug: c.slug as string,
      memberNames: ((venues ?? []) as Row[]).map((v) => (v.name as string | null) ?? 'A venue'),
      reason,
    });
  }
  return out;
}

export type InvitationCloseReason = 'declined' | 'cancelled' | 'expired';

export interface InvitationCloseResult {
  closed: boolean;
  dissolved: boolean;
  collectiveName: string | null;
}

/**
 * A link request ends without a link (declined, cancelled or expired), so the invitation that rode on
 * it closes too. If the collective is then the host alone, it is dissolved (`below_two`) so the host
 * can start again (L7). Returns what happened, so the caller can say it in the notice.
 */
export async function closeInvitationForLink(
  admin: SupabaseClient,
  input: {
    hostVenueId: string;
    inviteeVenueId: string;
    reason: InvitationCloseReason;
    actorVenueId: string | null;
    actorUserId: string | null;
  },
): Promise<InvitationCloseResult> {
  const invitation = await loadInvitationForLink(admin, input);
  if (!invitation) return { closed: false, dissolved: false, collectiveName: null };
  const now = new Date().toISOString();
  const engine = invitation.serviceModel === 'replicas';

  if (engine && input.reason !== 'declined') {
    // The engine audits a withdrawn or expired invitation so History shows it (§6.7).
    const { error } = await admin.rpc('collective_close_invitation', {
      p_member_id: invitation.memberId,
      p_reason: input.reason === 'cancelled' ? 'withdrawn' : 'expired',
      p_actor_venue_id: input.actorVenueId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) {
      await admin.from('venue_collective_members').update({ status: 'removed', left_at: now }).eq('id', invitation.memberId);
    }
  } else {
    // A decline is the same row change the members route makes for "Decline".
    await admin.from('venue_collective_members').update({ status: 'removed', left_at: now }).eq('id', invitation.memberId);
  }

  const { data: remaining } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', invitation.id)
    .in('status', ['invited', 'active'])
    .neq('venue_id', input.hostVenueId);
  if ((remaining ?? []).length > 0) return { closed: true, dissolved: false, collectiveName: invitation.name };

  if (engine) {
    const { error } = await admin.rpc('collective_dissolve', {
      p_collective_id: invitation.id,
      p_reason: 'below_two',
      p_actor_venue_id: input.actorVenueId,
      p_actor_user_id: input.actorUserId,
    });
    if (error) {
      console.error('closeInvitationForLink dissolve failed:', error.message);
      return { closed: true, dissolved: false, collectiveName: invitation.name };
    }
    await drainReleaseFollowups(admin, { operationIds: await pendingReleaseFollowups(admin, invitation.id) });
  } else {
    await admin
      .from('venue_collectives')
      .update({ status: 'dissolved', slug: dissolvedCollectiveSlug(invitation.id) })
      .eq('id', invitation.id);
    await admin
      .from('venue_collective_members')
      .update({ status: 'left', left_at: now })
      .eq('collective_id', invitation.id)
      .in('status', ['invited', 'active']);
  }
  return { closed: true, dissolved: true, collectiveName: invitation.name };
}
