import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function utcYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/platform/venues/[id]/insights
 *
 * Per-venue usage signals for superuser monitoring: booking volume (all-time /
 * 30d / 7d), upcoming bookings, last activity, guest count, and cancellation mix.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { id } = await params;
  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid venue id' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const now = new Date();
  const todayYmd = utcYmd(now);
  const d30 = new Date(now.getTime() - 30 * 86400000).toISOString();
  const d7 = new Date(now.getTime() - 7 * 86400000).toISOString();

  try {
    const [
      allTimeRes,
      last30Res,
      last7Res,
      upcomingRes,
      cancelled30Res,
      lastBookingRes,
      guestsRes,
    ] = await Promise.all([
      admin.from('bookings').select('id', { count: 'exact', head: true }).eq('venue_id', id),
      admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', id)
        .gte('created_at', d30),
      admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', id)
        .gte('created_at', d7),
      admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', id)
        .gte('booking_date', todayYmd)
        .not('status', 'in', '("Cancelled","No-Show")'),
      admin
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('venue_id', id)
        .eq('status', 'Cancelled')
        .gte('created_at', d30),
      admin
        .from('bookings')
        .select('created_at, booking_date, source')
        .eq('venue_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from('guests').select('id', { count: 'exact', head: true }).eq('venue_id', id),
    ]);

    const lastBooking = lastBookingRes.data as
      | { created_at: string; booking_date: string; source: string }
      | null;

    return NextResponse.json({
      bookings: {
        all_time: allTimeRes.count ?? 0,
        last_30_days: last30Res.count ?? 0,
        last_7_days: last7Res.count ?? 0,
        upcoming: upcomingRes.count ?? 0,
        cancelled_last_30_days: cancelled30Res.count ?? 0,
        last_booking_created_at: lastBooking?.created_at ?? null,
        last_booking_source: lastBooking?.source ?? null,
      },
      guests: {
        total: guestsRes.count ?? 0,
      },
    });
  } catch (e) {
    console.error('[platform/venues/insights]', e instanceof Error ? e.message : e, { venueId: id });
    return NextResponse.json({ error: 'Failed to load venue insights' }, { status: 500 });
  }
}
