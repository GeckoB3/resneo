import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/platform/venues/[id]
 * Superuser venue flags. Body: { is_test?: boolean }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 });
  }

  let body: { is_test?: unknown };
  try {
    body = (await request.json()) as { is_test?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.is_test !== 'boolean') {
    return NextResponse.json({ error: 'is_test (boolean) is required' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('venues')
    .update({ is_test: body.is_test })
    .eq('id', id)
    .select('id, name, is_test')
    .maybeSingle();

  if (error) {
    console.error('[platform/venues PATCH] update failed:', error.message, { venueId: id });
    return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: body.is_test ? 'venue.mark_test' : 'venue.mark_live',
    targetType: 'venue',
    targetId: id,
    summary: `Marked venue "${(data as { name: string }).name}" as ${body.is_test ? 'test' : 'live'}`,
  });

  return NextResponse.json({ ok: true, venue: data });
}
