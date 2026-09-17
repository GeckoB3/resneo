/**
 * The reconcile on the shared-services model (plan §6.7, "reconcile off renders"; W7).
 *
 * A page render never changes membership. A link change releases, through the engine and with the
 * reason `link_ended`, each venue that lost full access, ends a collective left with one venue, and
 * leaves the notices to the engine's jobs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('./queries', () => ({ getAcceptedLinkBetween: vi.fn(), getStandingLinkBetween: vi.fn() }));
const notifications = vi.hoisted(() => ({
  notifyCollectiveDissolved: vi.fn(),
  notifyCollectiveHostTransferred: vi.fn(),
  notifyCollectiveRemoval: vi.fn(),
}));
vi.mock('./notifications', () => notifications);
const drainReleaseFollowups = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('./replicas/release-followups', () => ({ drainReleaseFollowups }));

import { getAcceptedLinkBetween, getStandingLinkBetween } from './queries';
import { reconcileCollective, reconcileCollectivesAfterLinkChange } from './collectives';

const fullLink = {
  low_grants_calendar: 'full_details',
  high_grants_calendar: 'full_details',
  low_grants_act: 'create_edit_cancel',
  high_grants_act: 'create_edit_cancel',
  low_grants_calendar_ids: null,
  high_grants_calendar_ids: null,
};

/** Host, member A and member B; the link between A and the others has ended. */
function world(activeStatuses: string[] = ['active', 'active', 'active']): Responder {
  return (call) => {
    if (call.table === 'venue_collectives') {
      return { data: { id: 'col-1', status: 'active', host_venue_id: 'host', page_mode: 'unified_catalog', service_model: 'replicas', name: 'Northside' } };
    }
    if (call.table === 'venue_collective_members') {
      const counting = call.filters.some((f) => f[0] === 'in' && f[1] === 'status');
      if (counting && call.columns === 'status') return { data: activeStatuses.map((status) => ({ status })) };
      if (call.columns === 'collective_id') return { data: [{ collective_id: 'col-1' }] };
      return {
        data: [
          { id: 'm-host', venue_id: 'host' },
          { id: 'm-a', venue_id: 'a' },
          { id: 'm-b', venue_id: 'b' },
        ],
      };
    }
    if (call.table === 'collective_operations') return { data: [{ id: 'op-a' }] };
    return undefined;
  };
}

beforeEach(() => {
  vi.mocked(getStandingLinkBetween).mockReset();
  vi.mocked(getAcceptedLinkBetween).mockReset();
  const linked = async (x: string, y: string) => (x === 'a' || y === 'a' ? null : fullLink);
  vi.mocked(getStandingLinkBetween).mockImplementation(linked as never);
  vi.mocked(getAcceptedLinkBetween).mockImplementation(linked as never);
  drainReleaseFollowups.mockClear();
  Object.values(notifications).forEach((fn) => fn.mockClear());
});

const releases = (calls: ReturnType<typeof makeRecordingDb>['calls']) =>
  calls.filter((c) => c.table === 'rpc:collective_release_member').map((c) => c.payload);
const writes = (calls: ReturnType<typeof makeRecordingDb>['calls']) =>
  calls.filter((c) => c.op === 'update' || c.op === 'insert' || c.op === 'upsert' || c.op === 'delete');

describe('reconcileCollective on the shared-services model', () => {
  it('changes nothing while a page renders', async () => {
    const recording = makeRecordingDb(world());
    const result = await reconcileCollective(recording.db as unknown as SupabaseClient, 'col-1', { fromRender: true });
    expect(result).toEqual({ removedVenueIds: [], dissolved: false, hostTransferredTo: null, engine: true });
    expect(releases(recording.calls)).toEqual([]);
    expect(writes(recording.calls)).toEqual([]);
  });

  it('releases the venue whose link ended, through the engine, and writes no row itself', async () => {
    const recording = makeRecordingDb(world());
    const result = await reconcileCollective(recording.db as unknown as SupabaseClient, 'col-1');
    expect(result).toEqual({ removedVenueIds: ['a'], dissolved: false, hostTransferredTo: null, engine: true });
    expect(releases(recording.calls)).toEqual([
      { p_member_id: 'm-a', p_reason: 'link_ended', p_actor_venue_id: null, p_actor_user_id: null },
    ]);
    expect(writes(recording.calls)).toEqual([]);
    expect(drainReleaseFollowups).toHaveBeenCalledWith(expect.anything(), { operationIds: ['op-a'] });
  });

  it('ends the collective when one venue is left', async () => {
    const recording = makeRecordingDb(world(['active']));
    const result = await reconcileCollective(recording.db as unknown as SupabaseClient, 'col-1');
    expect(result.dissolved).toBe(true);
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_dissolve').map((c) => c.payload)).toEqual([
      { p_collective_id: 'col-1', p_reason: 'below_two', p_actor_venue_id: null, p_actor_user_id: null },
    ]);
  });

  it('leaves the notices to the engine after a link change', async () => {
    const recording = makeRecordingDb(world());
    await reconcileCollectivesAfterLinkChange(recording.db as unknown as SupabaseClient, ['a']);
    expect(releases(recording.calls)).toHaveLength(1);
    expect(notifications.notifyCollectiveRemoval).not.toHaveBeenCalled();
    expect(notifications.notifyCollectiveDissolved).not.toHaveBeenCalled();
  });
});
