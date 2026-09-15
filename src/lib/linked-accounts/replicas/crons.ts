/**
 * The collective engine's two crons (plan §6.16, Appendix D "The verifier").
 *
 * `collective-replicate` (every 5 minutes) leases due replica links and applies each in its own RPC,
 * so a statement timeout in one apply holds no lease on the rest. `collective-verify` (daily) reads
 * the invariant report, repairs what is convergence rather than breakage, and alerts on the rest:
 *   - I3b lag: apply;
 *   - I5 a live link whose membership ended: release the membership (idempotent);
 *   - I3 unexplained drift: `collective_repair_drift` audits the before-image, applies, and the run
 *     alerts, because drift is never ordinary lag;
 *   - collectives paused 30 days are dissolved, memberships suspended 30 days are released, and due
 *     host transfers run, retried daily and cancelled once 7 days overdue;
 *   - any other non-zero invariant alerts without repair (I21 is reported, not gated).
 *
 * Both reach the engine only through service-role functions. Everything is dark until a collective
 * is on the replicas model, so today both runs find nothing to do.
 */

export interface RpcError {
  message: string;
  code?: string;
}

/** The slice of the Supabase client the crons use. */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export interface CronCounters {
  job: string;
  results: Record<string, number>;
  errors: number;
}

const APPLY_BATCH = 50;
const REPLICATE_BUDGET_MS = 50_000;
/** The run alerts when more than this share of applies fail (§6.16). */
const FAILED_SHARE_ALERT = 0.05;

/** A SETOF uuid comes back from PostgREST as plain strings; tolerate the row-object shape too. */
function claimedIds(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (typeof row === 'string' ? row : (row as Record<string, unknown>)?.collective_claim_due_links))
    .filter((id): id is string => typeof id === 'string');
}

function jsonObject(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

function numberOf(v: unknown): number {
  return typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) || 0 : 0;
}

export async function runCollectiveReplicate(
  client: RpcClient,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<CronCounters> {
  const clock = opts.now ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? REPLICATE_BUDGET_MS;
  const results = { claimed: 0, applied: 0, still_behind: 0, failed: 0, leases_expired: 0, errors: 0 };

  const backlog = await client.rpc('collective_replicate_backlog', {});
  if (backlog.error) {
    results.errors += 1;
    console.error('[collective-replicate] backlog read failed:', backlog.error.message);
  } else {
    results.leases_expired = numberOf(jsonObject(backlog.data).leases_expired);
  }

  while (clock() - started < budget) {
    const claim = await client.rpc('collective_claim_due_links', { p_limit: APPLY_BATCH, p_lease: '2 minutes' });
    if (claim.error) {
      results.errors += 1;
      console.error('[collective-replicate] claim failed:', claim.error.message);
      break;
    }
    const ids = claimedIds(claim.data);
    results.claimed += ids.length;
    for (const linkId of ids) {
      const applied = await client.rpc('collective_apply_replica', {
        p_link_id: linkId,
        p_actor_venue_id: null,
        p_actor_user_id: null,
        p_job: 'collective-replicate',
      });
      if (applied.error) {
        results.errors += 1;
        console.error(`[collective-replicate] apply ${linkId} failed:`, applied.error.message);
      } else if (jsonObject(applied.data).ok === true) {
        results.applied += 1;
      } else {
        results.failed += 1;
      }
    }
    if (ids.length < APPLY_BATCH) break;
  }

  const after = await client.rpc('collective_replicate_backlog', {});
  if (after.error) {
    results.errors += 1;
  } else {
    results.still_behind = numberOf(jsonObject(after.data).due);
  }

  const failedShareAlert = results.claimed > 0 && results.failed / results.claimed > FAILED_SHARE_ALERT ? 1 : 0;
  return { job: 'collective-replicate', results, errors: results.errors + failedShareAlert };
}

interface InvariantRow {
  invariant: string;
  violations: number | string;
}

/** Invariants the verifier repairs, or reports without alerting. */
const REPAIRED_OR_REPORTED = new Set(['I3b', 'I5', 'I3', 'I21']);

export type VerifyOutcome = CronCounters & { unreadable?: string };

export async function runCollectiveVerify(client: RpcClient): Promise<VerifyOutcome> {
  const results: Record<string, number> = {
    repaired_applied: 0,
    repaired_released: 0,
    drift_repaired: 0,
    dissolved_paused: 0,
    released_suspended: 0,
    transfers_done: 0,
    transfers_waiting: 0,
    transfers_cancelled: 0,
    unrepairable: 0,
    errors: 0,
  };

  const report = await client.rpc('collective_invariant_report', { p_since: null, p_collective_id: null });
  if (report.error || !Array.isArray(report.data)) {
    return {
      job: 'collective-verify',
      results,
      errors: 1,
      unreadable: report.error?.message ?? 'invariant report returned no rows',
    };
  }
  let alerts = 0;
  for (const row of report.data as InvariantRow[]) {
    const n = numberOf(row.violations);
    results[row.invariant] = n;
    if (n > 0 && !REPAIRED_OR_REPORTED.has(row.invariant)) alerts += 1;
  }

  const work = await client.rpc('collective_verifier_worklist', {});
  if (work.error) {
    return { job: 'collective-verify', results, errors: alerts + 1, unreadable: work.error.message };
  }
  const list = jsonObject(work.data);
  const ids = (key: string) => (Array.isArray(list[key]) ? (list[key] as unknown[]) : []);

  const call = async (fn: string, args: Record<string, unknown>, label: string) => {
    const res = await client.rpc(fn, args);
    if (res.error) {
      results.errors += 1;
      console.error(`[collective-verify] ${label} failed:`, res.error.message);
    }
    return res;
  };

  for (const linkId of ids('behind')) {
    const res = await call('collective_apply_replica', {
      p_link_id: linkId, p_actor_venue_id: null, p_actor_user_id: null, p_job: 'collective-verify',
    }, `apply ${String(linkId)}`);
    if (!res.error && jsonObject(res.data).ok === true) results.repaired_applied += 1;
  }

  const released = new Set<string>();
  for (const entry of ids('orphaned')) {
    const o = jsonObject(entry);
    const memberId = typeof o.member_id === 'string' ? o.member_id : null;
    const reason =
      o.member_status === 'left' ? 'left'
        : o.member_status === 'removed' ? 'removed'
          : o.collective_status === 'dissolved' ? 'dissolved'
            : null;
    if (!memberId || !reason) {
      results.unrepairable += 1;
      continue;
    }
    if (released.has(memberId)) continue;
    released.add(memberId);
    const res = await call('collective_release_member', {
      p_member_id: memberId, p_reason: reason, p_actor_venue_id: null, p_actor_user_id: null,
    }, `release ${memberId}`);
    if (!res.error) results.repaired_released += 1;
  }

  for (const linkId of ids('drifted')) {
    const res = await call('collective_repair_drift', { p_link_id: linkId, p_job: 'collective-verify' }, `drift ${String(linkId)}`);
    if (!res.error) results.drift_repaired += 1;
  }
  // A drift repair always alerts: the state is never ordinary lag.
  alerts += results.drift_repaired;

  for (const collectiveId of ids('paused_expired')) {
    const res = await call('collective_dissolve', {
      p_collective_id: collectiveId, p_reason: 'paused_expired', p_actor_venue_id: null, p_actor_user_id: null,
    }, `dissolve ${String(collectiveId)}`);
    if (!res.error) results.dissolved_paused += 1;
  }

  for (const memberId of ids('suspended_expired')) {
    const res = await call('collective_release_member', {
      p_member_id: memberId, p_reason: 'suspended_expired', p_actor_venue_id: null, p_actor_user_id: null,
    }, `release suspended ${String(memberId)}`);
    if (!res.error) results.released_suspended += 1;
  }

  for (const entry of ids('transfers_due')) {
    const t = jsonObject(entry);
    const res = await client.rpc('collective_transfer_host', {
      p_collective_id: t.collective_id, p_new_host_venue_id: t.new_host_venue_id,
      p_actor_venue_id: null, p_actor_user_id: null,
    });
    if (!res.error) {
      results.transfers_done += 1;
    } else if (res.error.message.startsWith('COLLECTIVE_LINKS_BEHIND')) {
      if (t.overdue === true) {
        const cancelled = await call('collective_cancel_host_transfer', {
          p_collective_id: t.collective_id, p_reason: 'links_behind_after_retries',
          p_actor_venue_id: null, p_actor_user_id: null, p_job: 'collective-verify',
        }, `cancel transfer ${String(t.collective_id)}`);
        if (!cancelled.error) results.transfers_cancelled += 1;
      } else {
        results.transfers_waiting += 1;
      }
    } else {
      results.errors += 1;
      console.error(`[collective-verify] transfer ${String(t.collective_id)} failed:`, res.error.message);
    }
  }

  return { job: 'collective-verify', results, errors: results.errors + results.unrepairable + alerts };
}
