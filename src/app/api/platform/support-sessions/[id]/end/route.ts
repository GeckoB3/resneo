import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** POST /api/platform/support-sessions/[id]/end — force-end an active support session. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid session id' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('support_sessions')
    .update({ ended_at: new Date().toISOString() })
    .eq('id', id)
    .is('ended_at', null)
    .select('id, superuser_email, venue_id')
    .maybeSingle();

  if (error) {
    console.error('[platform/support-sessions end]', error.message, { sessionId: id });
    return NextResponse.json({ error: 'Failed to end session' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Session not found or already ended' }, { status: 404 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'support_session.force_end',
    targetType: 'support_session',
    targetId: id,
    summary: `Force-ended support session started by ${data.superuser_email}`,
    metadata: { venue_id: data.venue_id },
  });

  return NextResponse.json({ ok: true });
}
