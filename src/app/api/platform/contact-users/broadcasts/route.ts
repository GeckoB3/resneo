import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { draftToColumns, parseDraftPayload } from '@/lib/platform/broadcast-draft';
import { BROADCAST_COLUMNS } from '@/lib/platform/broadcast-send';
import { emptyBroadcastContent } from '@/lib/platform/broadcast-email';

export const dynamic = 'force-dynamic';

/** GET /api/platform/contact-users/broadcasts: drafts and sent emails, newest first. */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { data, error } = await getSupabaseAdminClient()
    .from('platform_broadcasts')
    .select(BROADCAST_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[platform/contact-users/broadcasts GET]', error.message);
    return NextResponse.json({ error: 'Could not load emails.' }, { status: 500 });
  }
  return NextResponse.json({ broadcasts: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

/** POST /api/platform/contact-users/broadcasts: create a draft. */
export async function POST(request: Request) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const draft = parseDraftPayload(await request.json().catch(() => null));
  if (!draft) return NextResponse.json({ error: 'Invalid draft.' }, { status: 400 });

  const { data, error } = await getSupabaseAdminClient()
    .from('platform_broadcasts')
    .insert({
      status: 'draft',
      subject: '',
      content: emptyBroadcastContent(),
      ...draftToColumns(draft),
      created_by: auth.user.id,
      created_by_email: auth.user.email ?? null,
    })
    .select(BROADCAST_COLUMNS)
    .single();
  if (error) {
    console.error('[platform/contact-users/broadcasts POST]', error.message);
    return NextResponse.json({ error: 'Could not save the draft.' }, { status: 500 });
  }
  return NextResponse.json({ broadcast: data }, { status: 201 });
}
