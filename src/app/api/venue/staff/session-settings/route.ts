import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import {
  SESSION_TIMEOUT_DEFAULT_MINUTES,
  SESSION_TIMEOUT_MIN_MINUTES,
  normalizeSessionTimeoutMinutes,
} from '@/lib/session-timeout';

const putSchema = z.object({
  session_timeout_minutes: z
    .number()
    .int()
    .min(SESSION_TIMEOUT_MIN_MINUTES)
    .max(SESSION_TIMEOUT_DEFAULT_MINUTES),
});

/** GET /api/venue/staff/session-settings - get session timeout setting. */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data: venue } = await admin
      .from('venues')
      .select('session_timeout_minutes')
      .eq('id', staff.venue_id)
      .single();

    return NextResponse.json({
      session_timeout_minutes: normalizeSessionTimeoutMinutes(venue?.session_timeout_minutes),
    });
  } catch (err) {
    console.error('GET /api/venue/staff/session-settings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PUT /api/venue/staff/session-settings - update session timeout (admin only). */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { error: updateErr } = await admin
      .from('venues')
      .update({ session_timeout_minutes: parsed.data.session_timeout_minutes })
      .eq('id', staff.venue_id);

    if (updateErr) {
      console.error('Session settings update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update session settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('PUT /api/venue/staff/session-settings failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
