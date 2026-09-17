/**
 * A host saving a service that is on the collective page (plan Appendix E contract 4; §6.4; D50; W5).
 *
 * The save itself is the Services route's own write, unchanged. Around it:
 *   - before the writes, the master-side projection is captured;
 *   - after them, it is captured again and handed to `collective_record_master_change`, which writes
 *     the `master_changed` audit row that the 60 second undo restores. Nothing is recorded when the
 *     two match, so a save the collective does not copy (a sort order, say) offers no undo;
 *   - the members' copies are then applied inline, and the answer carries `collective_sync` with the
 *     audit row's id.
 *
 * Every step is a no-op at a venue that is not the host of a replicas-model collective, which is
 * every venue today.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyLinksInline, type CollectiveSync } from '@/lib/linked-accounts/replicas/inline-apply';

export interface MasterSaveContext {
  collectiveId: string;
  collectiveName: string;
  hostVenueName: string;
  itemId: string;
  linkIds: string[];
  /** Any live link: the projection is read through one, and the master side is the same for all. */
  probeLinkId: string | null;
}

/** The offering this service is the master of, when the caller's venue hosts it. Null otherwise. */
export async function loadMasterSaveContext(
  admin: SupabaseClient,
  serviceId: string,
  venueId: string,
): Promise<MasterSaveContext | null> {
  const { data: itemRow } = await admin
    .from('collective_service_items')
    .select('id, collective_id, venue_collectives!inner (id, name, host_venue_id, status, service_model, venues!host_venue_id (name))')
    .eq('master_service_id', serviceId)
    .eq('status', 'active')
    .maybeSingle();
  if (!itemRow) return null;
  type CollectiveJoin = {
    name?: string;
    host_venue_id?: string;
    status?: string;
    service_model?: string;
    venues?: { name?: string } | { name?: string }[] | null;
  };
  const joined = itemRow.venue_collectives as CollectiveJoin | CollectiveJoin[] | null;
  const collective = Array.isArray(joined) ? joined[0] : joined;
  if (!collective || collective.host_venue_id !== venueId || collective.status !== 'active' || collective.service_model !== 'replicas') {
    return null;
  }

  const { data: linkRows } = await admin
    .from('collective_service_replicas')
    .select('id')
    .eq('collective_service_item_id', itemRow.id as string)
    .is('released_at', null);
  const linkIds = (linkRows ?? []).map((l) => l.id as string);
  const hostVenue = Array.isArray(collective.venues) ? collective.venues[0] : collective.venues;
  return {
    collectiveId: itemRow.collective_id as string,
    collectiveName: collective.name ?? 'your collective',
    hostVenueName: hostVenue?.name ?? 'your venue',
    itemId: itemRow.id as string,
    linkIds,
    probeLinkId: linkIds[0] ?? null,
  };
}

/** What the collective copies of this service right now, for the before and after of a save. */
export async function captureMasterProjection(
  admin: SupabaseClient,
  context: MasterSaveContext | null,
): Promise<unknown | null> {
  if (!context?.probeLinkId) return null;
  const { data, error } = await admin.rpc('collective_replica_projection', {
    p_link_id: context.probeLinkId,
    p_side: 'master',
  });
  if (error) {
    console.error('[collective] could not read the master projection:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Record the change (when there is one) and bring the members up to date, within the save's budget.
 * Returns what the host is told, or null when this venue is not hosting a replicas-model collective.
 */
export async function recordMasterChangeAndApply(
  admin: SupabaseClient,
  params: {
    context: MasterSaveContext | null;
    serviceId: string;
    before: unknown | null;
    actorVenueId: string;
    actorUserId: string | null;
  },
): Promise<CollectiveSync | null> {
  const { context } = params;
  if (!context) return null;

  let auditEventId: string | null = null;
  const after = await captureMasterProjection(admin, context);
  if (params.before && after) {
    const { data, error } = await admin.rpc('collective_record_master_change', {
      p_master_service_id: params.serviceId,
      p_before: params.before,
      p_after: after,
      p_actor_venue_id: params.actorVenueId,
      p_actor_user_id: params.actorUserId,
    });
    if (error) {
      // The save itself succeeded; losing the undo must not lose the save.
      console.error('[collective] could not record the change for undo:', error.message);
    } else {
      auditEventId = (data as string | null) ?? null;
    }
  }

  const sync = await applyLinksInline(admin, context.linkIds, {
    actorVenueId: params.actorVenueId,
    actorUserId: params.actorUserId,
  });
  return { ...sync, audit_event_id: auditEventId };
}
