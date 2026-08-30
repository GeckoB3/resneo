import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';

/**
 * GET/POST /api/cron/portal-events-prune
 * Vercel Cron uses GET; POST kept for manual triggers, matching the other 23.
 *
 * Deletes `portal_events` older than 13 months (P0-10).
 *
 * This is a NEW route rather than a step in an existing job because none of
 * the 23 existing crons performs data-retention pruning: an earlier draft of
 * the plan said "prune in the existing cron", and there is no such cron.
 *
 * Why 13 months: §5B compares a period against the same period a year earlier,
 * so twelve months is the working set and the extra month is the margin that
 * keeps a year-on-year comparison whole while a prune runs.
 *
 * Portal events carry a `user_id` and no other personal data, so this is
 * retention hygiene rather than a deletion obligation; account deletion is
 * handled by `account-hard-delete`, and the FK is ON DELETE SET NULL so a
 * deleted user's rows survive as anonymous counts rather than vanishing from
 * the metrics.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('portal-events-prune', handlePost);

/** 13 months, as a UTC instant. */
function retentionCutoffIso(now = new Date()): string {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
  return cutoff.toISOString();
}

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const cutoff = retentionCutoffIso();

    const { error, count } = await supabase
      .from('portal_events')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);

    if (error) {
      console.error('[portal-events-prune] delete failed:', error.message);
      return NextResponse.json({ error: 'Prune failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, cutoff, pruned: count ?? 0 });
  } catch (err) {
    console.error('[portal-events-prune] failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export { retentionCutoffIso };
