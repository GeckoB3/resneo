/**
 * Leaving and removal on the shared-services model (plan §6.7; contract 7).
 *
 * One engine release per action; a collective left with fewer than two venues ends through the
 * engine as the system, unless an invitation could still bring it back to two; the follow-ups run
 * straight away; and a member that left gets its review back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

const drainReleaseFollowups = vi.fn(async () => ({ done: 0, retrying: 0, failed: 0, photos_copied: 0, photos_failed: 0 }));
vi.mock('@/lib/linked-accounts/replicas/release-followups', () => ({
  drainReleaseFollowups: (...args: unknown[]) => drainReleaseFollowups(...(args as [])),
}));
const loadReleaseReview = vi.fn(async () => ({ collective_id: 'collective-1' }));
vi.mock('@/lib/linked-accounts/replicas/release-review', () => ({
  loadReleaseReview: (...args: unknown[]) => loadReleaseReview(...(args as [])),
}));

import { runReleaseAction, type ReleaseContext } from './release-actions';
import { endCollectivesBelowTwo, endIfBelowTwo } from './below-two';

function world(statuses: string[], extra: Responder = () => undefined): Responder {
  return (call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'rpc:collective_release_member') return { data: { operation_id: 'op-release' } };
    if (call.table === 'venue_collective_members') return { data: statuses.map((status) => ({ status })) };
    if (call.table === 'collective_operations') return { data: [{ id: 'op-release' }, { id: 'op-host' }] };
    if (call.table === 'venue_collectives') return { data: [{ id: 'collective-1' }, { id: 'collective-2' }] };
    return undefined;
  };
}

const context = (responder: Responder) => {
  const recording = makeRecordingDb(responder);
  const ctx: ReleaseContext = {
    admin: recording.db as unknown as SupabaseClient,
    collectiveId: 'collective-1',
    collectiveName: 'Northside',
    hostVenueId: 'host',
    venueId: 'member',
    venueName: 'Zen Studio',
    userId: 'user-1',
  };
  return { ctx, calls: recording.calls };
};

const rpcs = (calls: ReturnType<typeof makeRecordingDb>['calls'], fn: string) =>
  calls.filter((c) => c.table === `rpc:${fn}`).map((c) => c.payload);

beforeEach(() => {
  drainReleaseFollowups.mockClear();
  loadReleaseReview.mockClear();
});

describe('runReleaseAction', () => {
  it("releases a member that leaves, runs its follow-up and returns its review", async () => {
    const { ctx, calls } = context(world(['active', 'active']));
    const result = await runReleaseAction(ctx, 'leave', { id: 'membership-1', venueId: 'member' });
    expect(result).toEqual({ ok: true, dissolved: false, review: { collective_id: 'collective-1' } });
    expect(rpcs(calls, 'collective_release_member')).toEqual([
      { p_member_id: 'membership-1', p_reason: 'left', p_actor_venue_id: 'member', p_actor_user_id: 'user-1' },
    ]);
    expect(rpcs(calls, 'collective_dissolve')).toEqual([]);
    expect(drainReleaseFollowups).toHaveBeenCalledWith(expect.anything(), { operationIds: ['op-release'] });
  });

  it('removes with its own reason and no review for the host', async () => {
    const { ctx, calls } = context(world(['active', 'active']));
    const result = await runReleaseAction({ ...ctx, venueId: 'host' }, 'remove', { id: 'membership-2', venueId: 'member' });
    expect(result).toMatchObject({ ok: true, review: null });
    expect(rpcs(calls, 'collective_release_member')[0]).toMatchObject({ p_reason: 'removed', p_actor_venue_id: 'host' });
    expect(loadReleaseReview).not.toHaveBeenCalled();
  });

  it('ends a collective left with one venue, as the system, and follows up every release', async () => {
    const { ctx, calls } = context(world(['active']));
    const result = await runReleaseAction(ctx, 'leave', { id: 'membership-1', venueId: 'member' });
    expect(result).toMatchObject({ ok: true, dissolved: true });
    expect(rpcs(calls, 'collective_dissolve')).toEqual([
      { p_collective_id: 'collective-1', p_reason: 'below_two', p_actor_venue_id: null, p_actor_user_id: null },
    ]);
    expect(drainReleaseFollowups).toHaveBeenCalledWith(expect.anything(), { operationIds: ['op-release', 'op-host'] });
  });

  it('says why when the engine refuses', async () => {
    const { ctx, calls } = context(
      world(['active', 'active'], (call) =>
        call.table === 'rpc:collective_release_member'
          ? { error: { code: 'P0001', message: 'COLLECTIVE_LEGACY_MODEL: not on the replicas model' } }
          : undefined,
      ),
    );
    const result = await runReleaseAction(ctx, 'leave', { id: 'membership-1', venueId: 'member' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(409);
    expect(rpcs(calls, 'collective_dissolve')).toEqual([]);
    expect(drainReleaseFollowups).not.toHaveBeenCalled();
  });
});

describe('endIfBelowTwo', () => {
  const ends = async (statuses: string[]) => {
    const recording = makeRecordingDb(world(statuses));
    const ended = await endIfBelowTwo(recording.db as unknown as SupabaseClient, 'collective-1');
    return { ended, dissolves: rpcs(recording.calls, 'collective_dissolve').length };
  };

  it('ends a collective with one venue or none', async () => {
    expect(await ends(['active'])).toEqual({ ended: true, dissolves: 1 });
    expect(await ends([])).toEqual({ ended: true, dissolves: 1 });
  });

  it('waits while an invitation could bring it back to two', async () => {
    expect(await ends(['active', 'invited'])).toEqual({ ended: false, dissolves: 0 });
  });

  it('leaves a collective of two alone', async () => {
    expect(await ends(['active', 'active'])).toEqual({ ended: false, dissolves: 0 });
  });
});

describe('endCollectivesBelowTwo', () => {
  it('checks every live shared-services collective', async () => {
    const recording = makeRecordingDb(world(['active']));
    expect(await endCollectivesBelowTwo(recording.db as unknown as SupabaseClient)).toEqual({ ended: 2, errors: 0 });
    const list = recording.calls.find((c) => c.table === 'venue_collectives')!;
    expect(list.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'active'],
        ['eq', 'service_model', 'replicas'],
      ]),
    );
  });
});
