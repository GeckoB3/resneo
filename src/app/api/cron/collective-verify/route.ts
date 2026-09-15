import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { runCollectiveVerify, type RpcClient } from '@/lib/linked-accounts/replicas/crons';

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

  const admin = getSupabaseAdminClient() as unknown as RpcClient;
  const { unreadable, ...counters } = await runCollectiveVerify(admin);
  const outcome = await finalizeCronRun(counters);
  if (unreadable) {
    return NextResponse.json({ ...outcome.body, ok: false, reason: 'unreadable', detail: unreadable }, { status: 200 });
  }
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
