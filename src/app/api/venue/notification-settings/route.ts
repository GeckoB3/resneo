import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  mergeNotificationSettingsPatch,
  parseNotificationSettings,
} from '@/lib/notifications/notification-settings';

/**
 * GET /api/venue/notification-settings
 * Returns merged `VenueNotificationSettings` for the authenticated venue.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('venues')
      .select('notification_settings')
      .eq('id', staff.venue_id)
      .maybeSingle();

    if (error) {
      console.error('[notification-settings GET] query error:', error);
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }

    return NextResponse.json(parseNotificationSettings(data?.notification_settings));
  } catch (err) {
    console.error('[notification-settings GET] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/venue/notification-settings
 * Partial update of `venues.notification_settings` (JSON). Admin only.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { data: row, error: fetchErr } = await admin
      .from('venues')
      .select('notification_settings')
      .eq('id', staff.venue_id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[notification-settings PUT] fetch error:', fetchErr);
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
    }

    const current = parseNotificationSettings(row?.notification_settings);
    const next = mergeNotificationSettingsPatch(current, body);

    const { error: updErr } = await admin
      .from('venues')
      .update({ notification_settings: next as unknown as Record<string, never> })
      .eq('id', staff.venue_id);

    if (updErr) {
      console.error('[notification-settings PUT] update error:', updErr);
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json(next);
  } catch (err) {
    console.error('[notification-settings PUT] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
