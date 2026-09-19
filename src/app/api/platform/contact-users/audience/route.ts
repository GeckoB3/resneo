import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { loadBroadcastAudience } from '@/lib/platform/broadcast-audience';

export const dynamic = 'force-dynamic';

/**
 * GET /api/platform/contact-users/audience
 * Every current subscriber (plus test venues, which are only sent to when picked by hand) with the
 * account-holder addresses a Contact Users email would go to.
 */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  try {
    const venues = await loadBroadcastAudience(getSupabaseAdminClient());
    return NextResponse.json({ venues }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[platform/contact-users/audience]', e);
    return NextResponse.json({ error: 'Could not load the venue list.' }, { status: 500 });
  }
}
