import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { stripe } from '@/lib/stripe';
import { purgeVenueStorage } from '@/lib/venue/venue-storage-cleanup';
import { hardDeleteVenueWithLinkedAccountNotifications } from '@/lib/linked-accounts/venue-deletion';

export async function GET(request: NextRequest) {
  return POST(request);
}

/** Hard-delete venues whose 30-day self-serve deletion grace period has elapsed. */
export const POST = withCronRunLogging('venue-hard-delete', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const { data: venues, error } = await admin
    .from('venues')
    .select('id, name, stripe_subscription_id, deletion_scheduled_at')
    .not('deletion_scheduled_at', 'is', null)
    .lte('deletion_scheduled_at', new Date().toISOString())
    .limit(50);

  if (error) {
    console.error('[venue-hard-delete] load:', error.message);
    return NextResponse.json({ error: 'Failed to load deletion queue' }, { status: 500 });
  }

  let deleted = 0;
  const errors: Array<{ venue_id: string; error: string }> = [];

  for (const venue of venues ?? []) {
    const venueId = venue.id as string;

    // 1. Purge storage FIRST. If any bucket fails, skip the DB delete and leave the venue in
    //    the queue to retry next run — otherwise the venue row is gone and the orphaned objects
    //    (guest documents, compliance files, etc.) can never be located again.
    const purge = await purgeVenueStorage(admin, venueId);
    if (purge.errors.length > 0) {
      for (const e of purge.errors) {
        errors.push({ venue_id: venueId, error: `storage[${e.bucket}]: ${e.error}` });
      }
      continue;
    }

    // 2. Cancel the Stripe subscription outright (it was already set to cancel at period end on
    //    request). Best-effort: a Stripe failure must not block erasure, and the row is about to
    //    be deleted so it won't be retried.
    const subId = (venue.stripe_subscription_id as string | null)?.trim();
    if (subId) {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (e) {
        console.error('[venue-hard-delete] stripe cancel:', subId, e instanceof Error ? e.message : e);
      }
    }

    // 3. Terminate account links + notify partners + delete the venue and all dependent rows.
    try {
      await hardDeleteVenueWithLinkedAccountNotifications(admin, venueId);
    } catch (e) {
      errors.push({ venue_id: venueId, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    deleted += 1;
  }

  return NextResponse.json({ deleted, errors });
}
