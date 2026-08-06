import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';

export async function GET(request: NextRequest) {
  return POST(request);
}

/**
 * Hard-delete auth users whose 30-day account deletion grace period has elapsed.
 *
 * This is where anonymisation happens. `request_account_deletion` used to do it at
 * request time, which made the advertised "cancel deletion" impossible; since
 * migration 20270103121000 the request marks intent only and this cron is the sole
 * writer that destroys identity.
 */
export const POST = withCronRunLogging('account-hard-delete', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  const admin = getSupabaseAdminClient();
  const { data: profiles, error } = await admin
    .from('user_profiles')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null)
    .lte('deleted_at', new Date().toISOString())
    .limit(100);

  if (error) {
    console.error('[account-hard-delete] load:', error.message);
    return NextResponse.json({ error: 'Failed to load deletion queue' }, { status: 500 });
  }

  let deleted = 0;
  let skippedCancelled = 0;
  const errors: Array<{ user_id: string; error: string }> = [];

  for (const profile of profiles ?? []) {
    const userId = profile.id as string;

    // Re-read immediately before destroying anything. A batch of 100 takes a
    // while to work through, and the customer can cancel at any point in that
    // window: `cancel_account_deletion` clears `deleted_at`. Anonymisation is
    // irreversible, so a stale read is not an acceptable basis for it.
    const { data: current, error: recheckErr } = await admin
      .from('user_profiles')
      .select('deleted_at')
      .eq('id', userId)
      .maybeSingle();

    if (recheckErr) {
      console.error('[account-hard-delete] recheck:', userId, recheckErr.message);
      errors.push({ user_id: userId, error: recheckErr.message });
      continue;
    }

    const stillDue =
      current?.deleted_at != null && new Date(current.deleted_at as string) <= new Date();
    if (!stillDue) {
      skippedCancelled += 1;
      continue;
    }

    const { data: guestRows, error: guestsErr } = await admin
      .from('guests')
      .select('id')
      .eq('user_id', userId);

    if (guestsErr) {
      console.error('[account-hard-delete] list guests:', guestsErr.message);
      errors.push({ user_id: userId, error: guestsErr.message });
      continue;
    }

    let guestAnonymisationOk = true;
    for (const row of guestRows ?? []) {
      const guestId = row.id as string;
      const { error: guestUpdErr } = await admin
        .from('guests')
        .update({
          // `guests.name` was dropped in 20260810120000; writing it made every
          // run fail with PGRST204 and silently skip deleteUser, so erasure
          // never completed. This was masked only because the old
          // request_account_deletion had already nulled user_id, leaving this
          // loop with no rows to process.
          first_name: 'Deleted',
          last_name: 'User',
          email: `deleted-${userId}-${guestId}@reserveni.deleted`,
          phone: null,
          user_id: null,
          marketing_consent: false,
          marketing_consent_at: null,
          marketing_opt_out: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', guestId);

      if (guestUpdErr) {
        guestAnonymisationOk = false;
        console.error('[account-hard-delete] guest update:', guestId, guestUpdErr.message);
        errors.push({ user_id: userId, error: guestUpdErr.message });
      }
    }

    if (!guestAnonymisationOk) {
      continue;
    }

    const { error: deleteErr } = await admin.auth.admin.deleteUser(userId);
    if (deleteErr) {
      errors.push({ user_id: userId, error: deleteErr.message });
      continue;
    }
    deleted += 1;
  }

  return NextResponse.json({ deleted, skipped_cancelled: skippedCancelled, errors });
}
