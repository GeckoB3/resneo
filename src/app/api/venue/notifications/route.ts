import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import {
  buildNotificationView,
  type LinkNotificationRow,
} from '@/lib/linked-accounts/notification-center';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const COLUMNS =
  'id, type, category, link_id, collective_id, actor_venue_id, resource_type, resource_id, payload, read_at, created_at';

/**
 * GET /api/venue/notifications — the current venue's in-app notification feed
 * (spec §17.2): latest notifications plus the unread count for the bell badge.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const staff = await getVenueStaff(supabase);
  if (!staff) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const limitParam = Number.parseInt(
    new URL(request.url).searchParams.get('limit') ?? '',
    10,
  );
  const limit = Number.isFinite(limitParam)
    ? Math.min(MAX_LIMIT, Math.max(1, limitParam))
    : DEFAULT_LIMIT;

  try {
    const { data, error } = await staff.db
      .from('account_link_notifications')
      .select(COLUMNS)
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('GET /api/venue/notifications failed:', error.message);
      return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
    }

    const { count, error: countError } = await staff.db
      .from('account_link_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', staff.venue_id)
      .is('read_at', null);
    if (countError) {
      console.error('GET /api/venue/notifications unread count failed:', countError.message);
    }

    return NextResponse.json({
      notifications: ((data ?? []) as LinkNotificationRow[]).map(buildNotificationView),
      unreadCount: count ?? 0,
      // §17 — lets the bell open a realtime subscription scoped to this venue.
      venueId: staff.venue_id,
    });
  } catch (err) {
    console.error('GET /api/venue/notifications threw:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
