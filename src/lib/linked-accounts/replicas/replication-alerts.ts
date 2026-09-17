/**
 * Two of the engine's alerts (plan §6.16; W18) that need a clock rather than an invariant:
 *
 *   a replica link behind for more than 60 minutes pages ops (the host and member were told at 15,
 *   N5);
 *   the replication cron not completing for 30 minutes. Nothing runs often enough to watch it from
 *   outside, so each run checks when the previous one completed, and the daily verifier checks too.
 *   A stall is therefore reported when the cron comes back, or within a day if it does not.
 *
 * Each returns a count; the cron adds it to its errors, which reaches Sentry and the ops address
 * through finalizeCronRun.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const BEHIND_PAGE_AFTER_MS = 60 * 60 * 1000;
export const REPLICATE_STALE_AFTER_MS = 30 * 60 * 1000;

/** Live links on shared-services collectives behind for more than an hour. */
export async function countLinksBehindTooLong(admin: SupabaseClient, now: number): Promise<number> {
  const { count, error } = await admin
    .from('collective_service_replicas')
    .select('id', { count: 'exact', head: true })
    .is('released_at', null)
    .not('behind_since', 'is', null)
    .lt('behind_since', new Date(now - BEHIND_PAGE_AFTER_MS).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Minutes since the replication cron last completed, when that is more than 30; null when it is
 * recent. `before` is this run's own start, so a run does not count itself. A cron that has never
 * run (a new environment) is not an alert.
 */
export async function replicateStaleMinutes(admin: SupabaseClient, before: number): Promise<number | null> {
  const { data, error } = await admin
    .from('cron_runs')
    .select('finished_at')
    .eq('job_name', 'collective-replicate')
    .eq('ok', true)
    .lt('started_at', new Date(before).toISOString())
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.finished_at) return null;
  const gap = before - Date.parse(data.finished_at as string);
  return gap > REPLICATE_STALE_AFTER_MS ? Math.round(gap / 60000) : null;
}
