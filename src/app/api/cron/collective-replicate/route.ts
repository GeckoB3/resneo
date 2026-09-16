import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { runCollectiveReplicate, type RpcClient } from '@/lib/linked-accounts/replicas/crons';
import { notifyFailingLinks } from '@/lib/linked-accounts/replicas/collective-failure-notices';

/**
 * GET/POST /api/cron/collective-replicate: every 5 minutes, apply due collective replica links
 * (plan §6.16). Dark until a collective is on the replicas model: it then finds nothing to claim.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('collective-replicate', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const supabase = getSupabaseAdminClient();
  const counters = await runCollectiveReplicate(supabase as unknown as RpcClient);
  // After the applies, so a link this run fixed is not reported (N5). A failure to notify is an
  // error in the run, never a reason to stop applying.
  try {
    const notices = await notifyFailingLinks(supabase);
    counters.results.failure_notices = notices.hostNotices;
  } catch (err) {
    console.error('[collective] failure notices threw:', err);
    counters.errors += 1;
  }
  const outcome = await finalizeCronRun(counters);
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
