import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { runCollectiveVerify, type RpcClient } from '@/lib/linked-accounts/replicas/crons';
import { syncMemberSuspensions } from '@/lib/linked-accounts/replicas/collective-suspension';
import { endCollectivesBelowTwo } from '@/lib/linked-accounts/replicas/below-two';

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
