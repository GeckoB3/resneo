import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';

const createSchema = z
  .object({
    title: z.string().min(3).max(200),
    body: z.string().min(3).max(2000),
    severity: z.enum(['info', 'warning', 'critical']).default('info'),
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().nullable().optional(),
  })
  .refine(
    (d) => !d.starts_at || !d.ends_at || new Date(d.ends_at).getTime() > new Date(d.starts_at).getTime(),
    { message: 'ends_at must be after starts_at' },
  );

/** GET /api/platform/announcements — all announcements with dismissal counts. */
export async function GET() {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const admin = getSupabaseAdminClient();
  const [{ data: announcements, error }, { data: dismissals }] = await Promise.all([
    admin
      .from('platform_announcements')
      .select('id, title, body, severity, starts_at, ends_at, active, created_by_email, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    admin.from('platform_announcement_dismissals').select('announcement_id'),
  ]);

  if (error) {
    console.error('[platform/announcements GET]', error.message);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }

  const dismissCounts = new Map<string, number>();
  for (const d of (dismissals ?? []) as Array<{ announcement_id: string }>) {
    dismissCounts.set(d.announcement_id, (dismissCounts.get(d.announcement_id) ?? 0) + 1);
  }

  return NextResponse.json({
    announcements: (announcements ?? []).map((a) => ({
      ...(a as Record<string, unknown>),
      dismissal_count: dismissCounts.get((a as { id: string }).id) ?? 0,
    })),
  });
}

/** POST /api/platform/announcements — create an announcement. */
export async function POST(request: Request) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const json = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('platform_announcements')
    .insert({
      title: parsed.data.title.trim(),
      body: parsed.data.body.trim(),
      severity: parsed.data.severity,
      starts_at: parsed.data.starts_at ?? new Date().toISOString(),
      ends_at: parsed.data.ends_at ?? null,
      created_by: auth.user.id,
      created_by_email: auth.user.email ?? null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[platform/announcements POST]', error.message);
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
  }

  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'announcement.create',
    targetType: 'announcement',
    targetId: data.id,
    summary: `Created ${parsed.data.severity} announcement "${parsed.data.title.trim()}"`,
  });

  return NextResponse.json({ ok: true, id: data.id });
}
