import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';

export async function GET(request: NextRequest) {
  return POST(request);
}

/** Hard-delete auth users whose 30-day account deletion grace period has elapsed. */
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
  const errors: Array<{ user_id: string; error: string }> = [];

  for (const profile of profiles ?? []) {
    const userId = profile.id as string;
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
          name: 'Deleted User',
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

  return NextResponse.json({ deleted, errors });
}
