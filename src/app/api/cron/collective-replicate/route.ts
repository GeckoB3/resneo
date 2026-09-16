import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { runCollectiveReplicate, type RpcClient } from '@/lib/linked-accounts/replicas/crons';
import { notifyFailingLinks } from '@/lib/linked-accounts/replicas/collective-failure-notices';
import { sendMasterChangeNotices } from '@/lib/linked-accounts/replicas/master-change-notices';
import { drainOperationNotices } from '@/lib/linked-accounts/replicas/collective-operation-notices';

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
  // The host's changes, to its members: commercial ones once a burst is quiet (N6), the rest in
  // the 18:00 digest, each member's own time (N7).
  try {
    const changes = await sendMasterChangeNotices(supabase);
    counters.results.commercial_notices = changes.commercial;
    counters.results.digests = changes.digests;
  } catch (err) {
    console.error('[collective] change notices threw:', err);
    counters.errors += 1;
  }
  // The lifecycle notices the engine queued after commit (N19 to N23).
  try {
    const queued = await drainOperationNotices(supabase);
    counters.results.lifecycle_notices = queued.sent;
    if (queued.failed > 0) counters.errors += queued.failed;
  } catch (err) {
    console.error('[collective] queued notices threw:', err);
    counters.errors += 1;
  }
  const outcome = await finalizeCronRun(counters);
  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
