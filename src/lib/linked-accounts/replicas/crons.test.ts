import { describe, expect, it } from 'vitest';
import { runCollectiveReplicate, runCollectiveVerify, type RpcClient, type RpcError } from './crons';

type Reply = { data?: unknown; error?: RpcError | null };

function fakeClient(handler: (fn: string, args: Record<string, unknown>) => Reply) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client: RpcClient = {
    rpc(fn, args = {}) {
      calls.push({ fn, args });
      const r = handler(fn, args);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  };
  return { client, calls };
}

describe('runCollectiveReplicate', () => {
  it('finds nothing to do on a database with no replicas-model collective', async () => {
    const { client, calls } = fakeClient((fn) =>
      fn === 'collective_claim_due_links' ? { data: [] } : { data: { leases_expired: 0, due: 0 } },
    );
    const run = await runCollectiveReplicate(client);
    expect(run).toEqual({
      job: 'collective-replicate',
      results: { claimed: 0, applied: 0, still_behind: 0, failed: 0, leases_expired: 0, errors: 0 },
      errors: 0,
    });
    expect(calls.map((c) => c.fn)).toEqual([
      'collective_replicate_backlog', 'collective_claim_due_links', 'collective_replicate_backlog',
    ]);
  });

  it('applies each claimed link in its own call with the cron job name, and counts outcomes', async () => {
    const { client, calls } = fakeClient((fn, args) => {
      if (fn === 'collective_replicate_backlog') return { data: { leases_expired: 2, due: 1 } };
      if (fn === 'collective_claim_due_links') return { data: ['l1', 'l2', 'l3'] };
      if (args.p_link_id === 'l2') return { data: { ok: false, error_code: 'unique_violation' } };
      if (args.p_link_id === 'l3') return { error: { message: 'statement timeout' } };
      return { data: { ok: true } };
    });
    const run = await runCollectiveReplicate(client);
    expect(run.results).toEqual({ claimed: 3, applied: 1, still_behind: 1, failed: 1, leases_expired: 2, errors: 1 });
    // One transport error, and one failed apply out of three is over the 5% alert share.
    expect(run.errors).toBe(2);
    expect(calls.filter((c) => c.fn === 'collective_apply_replica').map((c) => c.args)).toEqual([
      { p_link_id: 'l1', p_actor_venue_id: null, p_actor_user_id: null, p_job: 'collective-replicate' },
      { p_link_id: 'l2', p_actor_venue_id: null, p_actor_user_id: null, p_job: 'collective-replicate' },
      { p_link_id: 'l3', p_actor_venue_id: null, p_actor_user_id: null, p_job: 'collective-replicate' },
    ]);
  });

  it('keeps claiming full batches until the budget runs out', async () => {
    let t = 0;
    const full = Array.from({ length: 50 }, (_, i) => `l${i}`);
    const { client, calls } = fakeClient((fn) => {
      if (fn === 'collective_claim_due_links') return { data: full };
      if (fn === 'collective_apply_replica') { t += 400; return { data: { ok: true } }; }
      return { data: { leases_expired: 0, due: 7 } };
    });
    const run = await runCollectiveReplicate(client, { now: () => t, budgetMs: 25_000 });
    expect(calls.filter((c) => c.fn === 'collective_claim_due_links')).toHaveLength(2);
    expect(run.results.applied).toBe(100);
    expect(run.results.still_behind).toBe(7);
  });
});

const cleanReport = [
  { invariant: 'I1', violations: 0 },
  { invariant: 'I3b', violations: 0 },
  { invariant: 'I21', violations: 0 },
];
const emptyWork = { behind: [], orphaned: [], drifted: [], paused_expired: [], suspended_expired: [], transfers_due: [] };

describe('runCollectiveVerify', () => {
  it('reports every invariant and repairs nothing on a clean database', async () => {
    const { client, calls } = fakeClient((fn) =>
      fn === 'collective_invariant_report' ? { data: cleanReport } : { data: emptyWork },
    );
    const run = await runCollectiveVerify(client);
    expect(run.errors).toBe(0);
    expect(run.unreadable).toBeUndefined();
    expect(run.results).toMatchObject({ I1: 0, I3b: 0, I21: 0, repaired_applied: 0, drift_repaired: 0 });
    expect(calls.map((c) => c.fn)).toEqual(['collective_invariant_report', 'collective_verifier_worklist']);
  });

  it('says it could not read the report rather than claiming all is well', async () => {
    const { client } = fakeClient(() => ({ error: { message: 'permission denied' } }));
    const run = await runCollectiveVerify(client);
    expect(run.unreadable).toBe('permission denied');
    expect(run.errors).toBe(1);
  });

  it('repairs lag, orphans, drift and deadlines, and alerts on drift and gated invariants', async () => {
    const { client, calls } = fakeClient((fn, args) => {
      if (fn === 'collective_invariant_report') {
        return { data: [{ invariant: 'I3b', violations: 1 }, { invariant: 'I5', violations: 2 }, { invariant: 'I13', violations: 1 }, { invariant: 'I21', violations: 4 }] };
      }
      if (fn === 'collective_verifier_worklist') {
        return {
          data: {
            behind: ['lag1'],
            orphaned: [
              { link_id: 'o1', member_id: 'm1', member_status: 'left', collective_status: 'active' },
              { link_id: 'o2', member_id: 'm1', member_status: 'left', collective_status: 'active' },
              { link_id: 'o3', member_id: 'm2', member_status: 'active', collective_status: 'active' },
            ],
            drifted: ['d1'],
            paused_expired: ['c9'],
            suspended_expired: ['m7'],
            transfers_due: [
              { collective_id: 'ta', new_host_venue_id: 'va', overdue: false },
              { collective_id: 'tb', new_host_venue_id: 'vb', overdue: true },
              { collective_id: 'tc', new_host_venue_id: 'vc', overdue: false },
            ],
          },
        };
      }
      if (fn === 'collective_apply_replica') return { data: { ok: true } };
      if (fn === 'collective_transfer_host') {
        return args.p_collective_id === 'tc'
          ? { data: { items: 1 } }
          : { error: { message: 'COLLECTIVE_LINKS_BEHIND: copies must be up to date' } };
      }
      return { data: {} };
    });
    const run = await runCollectiveVerify(client);
    expect(run.results).toMatchObject({
      repaired_applied: 1,
      repaired_released: 1,
      unrepairable: 1,
      drift_repaired: 1,
      dissolved_paused: 1,
      released_suspended: 1,
      transfers_done: 1,
      transfers_waiting: 1,
      transfers_cancelled: 1,
      errors: 0,
    });
    // unrepairable (1) + I13 non-zero (1) + a drift repair (1). I3b, I5 and I21 do not alert.
    expect(run.errors).toBe(3);
    const released = calls.filter((c) => c.fn === 'collective_release_member').map((c) => c.args);
    expect(released).toEqual([
      { p_member_id: 'm1', p_reason: 'left', p_actor_venue_id: null, p_actor_user_id: null },
      { p_member_id: 'm7', p_reason: 'suspended_expired', p_actor_venue_id: null, p_actor_user_id: null },
    ]);
    expect(calls.find((c) => c.fn === 'collective_cancel_host_transfer')?.args).toMatchObject({
      p_collective_id: 'tb', p_reason: 'links_behind_after_retries',
    });
  });
});
