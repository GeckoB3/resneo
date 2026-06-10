import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { finalizeCronRun } from '@/lib/cron/finalize-cron-run';
import { processExpiredWaitlistOffers } from '@/lib/booking/process-expired-waitlist-offers';
import { syncStaffChooseWaitlistOpportunitiesCron } from '@/lib/booking/sync-staff-choose-waitlist-opportunities';

/**
 * GET/POST /api/cron/expire-waitlist-offers
 * Expires notify_in_order waitlist offers after 30 minutes and notifies the next guest.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('expire-waitlist-offers', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const admin = getSupabaseAdminClient();
    const results = await processExpiredWaitlistOffers(admin);
    const staffChooseSync = await syncStaffChooseWaitlistOpportunitiesCron(admin);
    const outcome = await finalizeCronRun({
      job: 'expire-waitlist-offers',
      results: {
        scanned: results.scanned,
        expired: results.expired,
        cascaded: results.cascaded,
        filled: results.filled,
        staff_choose_venues_scanned: staffChooseSync.venues_scanned,
        staff_choose_venues_synced: staffChooseSync.venues_synced,
      },
      errors: results.errors + staffChooseSync.errors,
    });
    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  } catch (err) {
    console.error('[cron/expire-waitlist-offers] failed:', err);
    const outcome = await finalizeCronRun({
      job: 'expire-waitlist-offers',
      results: {},
      errors: 1,
    });
    return NextResponse.json(outcome.body, { status: outcome.httpStatus });
  }
}
