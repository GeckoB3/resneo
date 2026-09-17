import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { runCollectiveVerify, type RpcClient } from '@/lib/linked-accounts/replicas/crons';
import { syncMemberSuspensions } from '@/lib/linked-accounts/replicas/collective-suspension';
import { endCollectivesBelowTwo } from '@/lib/linked-accounts/replicas/below-two';
import { runAdoptionDeadlines } from '@/lib/linked-accounts/replicas/adoptions';
import { releaseExpiredDissolvedAddresses } from '@/lib/linked-accounts/replicas/dissolved-page';
import { runLifecycleReminders } from '@/lib/linked-accounts/replicas/lifecycle-reminders';
import { replicateStaleMinutes } from '@/lib/linked-accounts/replicas/replication-alerts';

/**
 * GET/POST /api/cron/collective-verify: daily, read the collective invariant report, repair lag,
 * orphaned links and drift, run the lifecycle deadlines, and alert on everything else (plan §6.16,
 * Appendix D "The verifier").
 *
 * When it cannot read the report it still answers 200 with `ok: false` and a reason, so the cron
 * platform does not retry a check that is reporting correctly (the schedule-health rule); the
 * failure still reaches Sentry through finalizeCronRun.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('collective-verify', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const supabase = getSupabaseAdminClient();
  // Subscriptions first, so the verifier's 30-day deadlines see today's suspensions (N36, N37).
  let suspension = { suspended: 0, resumed: 0, errors: 0 };
  try {
    suspension = await syncMemberSuspensions(supabase);
  } catch (err) {
    console.error('[collective] suspension sync threw:', err);
    suspension = { ...suspension, errors: 1 };
  }
  const admin = supabase as unknown as RpcClient;
  const { unreadable, ...counters } = await runCollectiveVerify(admin);
  counters.results.members_suspended = suspension.suspended;
  counters.results.members_resumed = suspension.resumed;
  counters.errors += suspension.errors;
  // Unanswered adoptions: the day-7 reminder and the day-14 "Keep mine separate" (§6.7).
  try {
    const adoptions = await runAdoptionDeadlines(supabase);
    counters.results.adoption_reminders = adoptions.reminded;
    counters.results.adoptions_defaulted = adoptions.defaulted;
    counters.errors += adoptions.errors;
  } catch (err) {
    console.error('[collective] adoption deadlines threw:', err);
    counters.errors += 1;
  }
  // The daily backstop for a replication cron that has stopped (§6.16).
  try {
    const stale = await replicateStaleMinutes(supabase, Date.now());
    if (stale !== null) {
      counters.results.replicate_minutes_since_last_run = stale;
      counters.errors += 1;
    }
  } catch (err) {
    console.error('[collective] replication staleness check threw:', err);
    counters.errors += 1;
  }
  // Reminders (N1, N20, N21, N23) and invitations closed after 30 days (N35).
  try {
    const reminders = await runLifecycleReminders(supabase);
    counters.results.lifecycle_reminders = reminders.reminders;
    counters.results.invitations_expired = reminders.invitations_expired;
    counters.errors += reminders.errors;
  } catch (err) {
    console.error('[collective] lifecycle reminders threw:', err);
    counters.errors += 1;
  }
  // An ended collective's neutral page runs for 90 days; then its address is free (D25).
  try {
    const addresses = await releaseExpiredDissolvedAddresses(supabase);
    counters.results.dissolved_addresses_released = addresses.released;
    counters.errors += addresses.errors;
  } catch (err) {
    console.error('[collective] address release threw:', err);
    counters.errors += 1;
  }
  // After the deadlines, which can leave a collective with one venue (§6.7).
  try {
    const lone = await endCollectivesBelowTwo(supabase);
    counters.results.dissolved_below_two = lone.ended;
    counters.errors += lone.errors;
  } catch (err) {
    console.error('[collective] below-two sweep threw:', err);
    counters.errors += 1;
  }
  const outcome = await finalizeCronRun(counters);
  if (unreadable) {
    return NextResponse.json({ ...outcome.body, ok: false, reason: 'unreadable', detail: unreadable }, { status: 200 });
  }
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
