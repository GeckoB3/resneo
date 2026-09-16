import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { listSupportCollectives } from '@/lib/platform/collective-support';

/** GET /api/platform/collectives: every collective, its model and how up to date it is (plan §6.16). */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  try {
    const collectives = await listSupportCollectives(getSupabaseAdminClient());
    return NextResponse.json({ collectives }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[platform/collectives GET]', err);
    return NextResponse.json({ error: 'Failed to load collectives' }, { status: 500 });
  }
}
