import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { BROADCAST_UUID_RE, draftToColumns, parseDraftPayload } from '@/lib/platform/broadcast-draft';
import { BROADCAST_COLUMNS } from '@/lib/platform/broadcast-send';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET: one email with its recipients (who got it, who did not, and why). */
export async function GET(_request: Request, { params }: Ctx) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  if (!BROADCAST_UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const admin = getSupabaseAdminClient();
  const [{ data: broadcast, error }, { data: recipients, error: rErr }] = await Promise.all([
    admin.from('platform_broadcasts').select(BROADCAST_COLUMNS).eq('id', id).maybeSingle(),
    admin
      .from('platform_broadcast_recipients')
      .select('id, email, first_name, venue_names, status, error, sent_at')
      .eq('broadcast_id', id)
      .order('email')
      .limit(5000),
  ]);
  if (error || rErr) {
    console.error('[platform/contact-users/broadcasts/:id GET]', error?.message ?? rErr?.message);
    return NextResponse.json({ error: 'Could not load the email.' }, { status: 500 });
  }
  if (!broadcast) return NextResponse.json({ error: 'Email not found.' }, { status: 404 });
  return NextResponse.json({ broadcast, recipients: recipients ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
}

/** PATCH: save changes to a draft. A sent email cannot be edited. */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  if (!BROADCAST_UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const draft = parseDraftPayload(await request.json().catch(() => null));
  if (!draft) return NextResponse.json({ error: 'Invalid draft.' }, { status: 400 });

  const { data, error } = await getSupabaseAdminClient()
    .from('platform_broadcasts')
    .update({ ...draftToColumns(draft), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'draft')
    .select(BROADCAST_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error('[platform/contact-users/broadcasts/:id PATCH]', error.message);
    return NextResponse.json({ error: 'Could not save the draft.' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'This email has already been sent, so it can no longer be edited.' }, { status: 409 });
  }
  return NextResponse.json({ broadcast: data });
}

/** DELETE: discard a draft. Sent emails stay in the history. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  if (!BROADCAST_UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });

  const { data, error } = await getSupabaseAdminClient()
    .from('platform_broadcasts')
    .delete()
    .eq('id', id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[platform/contact-users/broadcasts/:id DELETE]', error.message);
    return NextResponse.json({ error: 'Could not delete the draft.' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Only drafts can be deleted.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
