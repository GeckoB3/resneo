import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import {
  getStaffDisplayName,
  listVenueAdminEmails,
  startSupportSession,
} from '@/lib/support-session-core';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { setSupportSessionCookie } from '@/lib/support-session-server';
import { sendSupportSessionStartedEmails } from '@/lib/support-session-email';

const postBodySchema = z.object({
  staff_id: z.string().uuid(),
  reason: z.string().min(3).max(2000),
});

/** GET /api/platform/support-sessions — recent sessions (active first) for the audit page. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isPlatformSuperuser(user)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = getSupabaseAdminClient();
  const { data: sessions, error } = await admin
    .from('support_sessions')
    .select(
      'id, superuser_email, superuser_display_name, venue_id, apparent_staff_id, reason, started_at, expires_at, ended_at',
    )
    .order('started_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[platform/support-sessions GET]', error.message);
    return NextResponse.json({ error: 'Failed to load sessions' }, { status: 500 });
  }

  const rows = (sessions ?? []) as Array<{
    id: string;
    superuser_email: string;
    superuser_display_name: string | null;
    venue_id: string;
    apparent_staff_id: string;
    reason: string;
    started_at: string;
    expires_at: string;
    ended_at: string | null;
  }>;

  const venueIds = [...new Set(rows.map((s) => s.venue_id))];
  const venueNameById = new Map<string, string>();
  if (venueIds.length) {
    const { data: venues } = await admin.from('venues').select('id, name').in('id', venueIds);
    for (const v of (venues ?? []) as Array<{ id: string; name: string }>) {
      venueNameById.set(v.id, v.name);
    }
  }

  const nowIso = new Date().toISOString();
  return NextResponse.json({
    sessions: rows.map((s) => ({
      ...s,
      venue_name: venueNameById.get(s.venue_id) ?? s.venue_id,
      active: !s.ended_at && s.expires_at > nowIso,
    })),
  });
}

/** POST /api/platform/support-sessions — start support session with selected staff permissions (superuser only). */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = postBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const started = await startSupportSession({
      superuser: user,
      staffId: parsed.data.staff_id,
      reason: parsed.data.reason,
    });

    if (!started.ok) {
      return NextResponse.json({ error: started.error }, { status: started.status });
    }

    await setSupportSessionCookie(started.session.id);

    const admin = getSupabaseAdminClient();
    const { data: venue } = await admin
      .from('venues')
      .select('name')
      .eq('id', started.session.venue_id)
      .maybeSingle();
    const venueName = (venue as { name?: string } | null)?.name?.trim() || 'Your venue';

    const adminEmails = await listVenueAdminEmails(admin, started.session.venue_id);
    const apparentLabel =
      (await getStaffDisplayName(admin, started.session.apparent_staff_id)) ??
      started.session.apparent_staff_id;

    await sendSupportSessionStartedEmails({
      toEmails: adminEmails.length > 0 ? adminEmails : [],
      venueName,
      superuserDisplayName:
        started.session.superuser_display_name?.trim() ||
        (user.email ?? 'ResNeo support'),
      apparentStaffLabel: apparentLabel,
      reason: parsed.data.reason.trim(),
      expiresAtIso: started.session.expires_at,
    });

    return NextResponse.json({
      session_id: started.session.id,
      venue_id: started.session.venue_id,
      apparent_staff_id: started.session.apparent_staff_id,
      expires_at: started.session.expires_at,
    });
  } catch (err) {
    console.error('[platform/support-sessions] POST:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
