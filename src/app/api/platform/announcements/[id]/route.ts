import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const patchSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  body: z.string().min(3).max(2000).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  active: z.boolean().optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

/** PATCH /api/platform/announcements/[id] — edit / activate / deactivate. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid announcement id' }, { status: 400 });
  }

  const json = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
  if (parsed.data.body !== undefined) updates.body = parsed.data.body.trim();
  if (parsed.data.severity !== undefined) updates.severity = parsed.data.severity;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  if (parsed.data.ends_at !== undefined) updates.ends_at = parsed.data.ends_at;

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('platform_announcements')
    .update(updates)
    .eq('id', id)
    .select('id, title, active')
    .maybeSingle();

  if (error) {
    console.error('[platform/announcements PATCH]', error.message, { id });
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'announcement.update',
    targetType: 'announcement',
    targetId: id,
    summary: `Updated announcement "${data.title}"${parsed.data.active !== undefined ? ` (active: ${parsed.data.active})` : ''}`,
    metadata: { changed_fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
  });

  return NextResponse.json({ ok: true });
}

/** DELETE /api/platform/announcements/[id] — permanently remove. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid announcement id' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('platform_announcements')
    .delete()
    .eq('id', id)
    .select('id, title')
    .maybeSingle();

  if (error) {
    console.error('[platform/announcements DELETE]', error.message, { id });
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'announcement.delete',
    targetType: 'announcement',
    targetId: id,
    summary: `Deleted announcement "${data.title}"`,
  });

  return NextResponse.json({ ok: true });
}
