/**
 * The bulk lane: many small collective changes in one save (plan Appendix E contract 13; UX spec
 * §2 item 15; W5).
 *
 * The grid stages changes and then sends them as a list of operations, in the order the host would
 * have done them by hand. Setting up a new collective is 800 to 1,600 of these, so the route takes
 * 200 at a time and the client chunks; nothing here is transactional across operations, because a
 * failure at one venue must not undo the twelve that worked.
 *
 * Every operation goes through the same engine functions the single-service routes use, so the
 * locks, the audit rows and the revision bumps are identical whether a host changes one service or
 * forty. An operation that fails comes back as itself, with the engine's own code, and the grid
 * keeps that cell staged and selected so Retry re-sends only the failures.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectiveDbError, type CollectiveNames } from '@/lib/linked-accounts/replicas/db-errors';

export type BulkOp =
  | { op: 'offer'; service_id: string }
  | { op: 'withdraw'; service_id: string }
  | { op: 'assign'; service_id: string; venue_id: string; calendar_id: string }
  | { op: 'unassign'; service_id: string; venue_id: string; calendar_id: string }
  | { op: 'retry'; service_id: string; venue_id?: string };

export interface BulkOpResult {
  index: number;
  ok: boolean;
  code?: string;
  message?: string;
}

export interface BulkRunOutcome {
  results: BulkOpResult[];
  /** Links these operations left behind, for the applies the route runs once at the end. */
  linkIds: string[];
}

export const BULK_OPS_LIMIT = 200;

interface RunParams {
  collectiveId: string;
  actorVenueId: string;
  actorUserId: string | null;
  names: CollectiveNames;
  ops: BulkOp[];
  /** The host has seen the bookings a removal would leave behind and still wants it. */
  acknowledgeAffected?: boolean;
}

/**
 * Run the operations in order, never throwing: the answer is one row per operation, in the order
 * they were sent, so the grid can mark exactly the cells that did not go through.
 */
export async function runBulkOps(admin: SupabaseClient, params: RunParams): Promise<BulkRunOutcome> {
  const results: BulkOpResult[] = [];
  const linkIds = new Set<string>();
  /** service id -> its offering on this page, read once however many operations name it. */
  const itemByService = new Map<string, { id: string; active: boolean } | null>();

  const itemFor = async (serviceId: string) => {
    if (itemByService.has(serviceId)) return itemByService.get(serviceId) ?? null;
    const { data } = await admin
      .from('collective_service_items')
      .select('id, status')
      .eq('collective_id', params.collectiveId)
      .eq('master_service_id', serviceId)
      // A service can have been offered, withdrawn and offered again: 'active' sorts before
      // 'archived' and 'retired', so the live offering is the one that answers.
      .order('status', { ascending: true })
      .limit(1)
      .maybeSingle();
    const item = data ? { id: data.id as string, active: data.status === 'active' } : null;
    itemByService.set(serviceId, item);
    return item;
  };

  const notOnPage = (index: number): BulkOpResult => ({
    index,
    ok: false,
    code: 'COLLECTIVE_REPLICA_NOT_READY',
    message: 'That service is not on the collective page.',
  });

  for (const [index, op] of params.ops.entries()) {
    try {
      if (op.op === 'offer') {
        const { data, error } = await admin.rpc('collective_offer_service', {
          p_collective_id: params.collectiveId,
          p_master_service_id: op.service_id,
          p_actor_venue_id: params.actorVenueId,
          p_actor_user_id: params.actorUserId,
        });
        if (error) {
          results.push(failure(index, error, params.names, 'Could not put that service on the page.'));
          continue;
        }
        const offered = (data ?? {}) as { item_id?: string; links?: { link_id: string }[] };
        // The offering is new or has come back, so the map's answer for it is stale.
        itemByService.set(op.service_id, offered.item_id ? { id: offered.item_id, active: true } : null);
        for (const link of offered.links ?? []) linkIds.add(link.link_id);
        results.push({ index, ok: true });
        continue;
      }

      if (op.op === 'withdraw') {
        const item = await itemFor(op.service_id);
        if (!item) {
          results.push(notOnPage(index));
          continue;
        }
        // Read the links first: withdrawing retires the copies, and they are what must be applied.
        for (const id of await liveLinkIds(admin, item.id, null)) linkIds.add(id);
        const { error } = await admin.rpc('collective_withdraw_service', {
          p_item_id: item.id,
          p_actor_venue_id: params.actorVenueId,
          p_actor_user_id: params.actorUserId,
        });
        if (error) {
          results.push(failure(index, error, params.names, 'Could not take that service off the page.'));
          continue;
        }
        itemByService.set(op.service_id, { id: item.id, active: false });
        results.push({ index, ok: true });
        continue;
      }

      if (op.op === 'assign' || op.op === 'unassign') {
        const item = await itemFor(op.service_id);
        if (!item || !item.active) {
          results.push(notOnPage(index));
          continue;
        }
        const { data, error } = await admin.rpc('collective_set_calendar_offering', {
          p_collective_id: params.collectiveId,
          p_item_id: item.id,
          p_venue_id: op.venue_id,
          p_calendar_id: op.calendar_id,
          p_action: op.op,
          p_actor_venue_id: params.actorVenueId,
          p_actor_user_id: params.actorUserId,
          p_acknowledge_affected: params.acknowledgeAffected ?? false,
        });
        if (error) {
          results.push(
            failure(
              index,
              error,
              params.names,
              op.op === 'assign' ? 'Could not add that calendar.' : 'Could not take that calendar off.',
            ),
          );
          continue;
        }
        const result = (data ?? {}) as { written?: boolean; affected_bookings?: unknown[] };
        if (op.op === 'unassign' && result.written === false && (result.affected_bookings?.length ?? 0) > 0) {
          // The host has not seen these yet. Nothing was written, and the grid keeps the cell staged.
          results.push({
            index,
            ok: false,
            code: 'COLLECTIVE_AFFECTED_BOOKINGS',
            message: 'That calendar has bookings for this service. Open the service to see them.',
          });
          continue;
        }
        results.push({ index, ok: true });
        continue;
      }

      // Retry: bring one venue's copy of this service up to date, or every venue's.
      const item = await itemFor(op.service_id);
      if (!item) {
        results.push(notOnPage(index));
        continue;
      }
      const ids = await liveLinkIds(admin, item.id, op.venue_id ?? null);
      for (const id of ids) linkIds.add(id);
      results.push({ index, ok: true });
    } catch (err) {
      // An operation that threw is one operation's problem, not the save's.
      console.error('[collective] a bulk operation threw:', err);
      results.push({ index, ok: false, message: 'Something went wrong on our side. Please try again.' });
    }
  }

  return { results, linkIds: [...linkIds] };
}

async function liveLinkIds(
  admin: SupabaseClient,
  itemId: string,
  venueId: string | null,
): Promise<string[]> {
  let query = admin
    .from('collective_service_replicas')
    .select('id')
    .eq('collective_service_item_id', itemId)
    .is('released_at', null);
  if (venueId) query = query.eq('venue_id', venueId);
  const { data } = await query;
  return (data ?? []).map((row) => row.id as string);
}

/** An engine refusal as the grid reads it: its own code where there is one, plain words otherwise. */
function failure(
  index: number,
  error: { code?: string | null; message?: string | null },
  names: CollectiveNames,
  fallback: string,
): BulkOpResult {
  const coded = collectiveDbError(error, names);
  if (coded) return { index, ok: false, code: coded.code, message: coded.body.error };
  console.error('[collective] a bulk operation was refused:', error.code, error.message);
  return { index, ok: false, message: fallback };
}
