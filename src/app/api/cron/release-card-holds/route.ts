import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';
import { isCardHoldChargeWindowExpired, normalizeEmbeddedBooking } from '@/lib/booking/card-hold-cron';
import type { CardHoldWindowBookingFields } from '@/lib/booking/card-hold-window';

/**
 * GET/POST /api/cron/release-card-holds
 * Vercel Cron uses GET; POST kept for manual triggers.
 *
 * Hold expiry backstop (design doc §12.3): releases open card holds whose
 * booking ended more than CARD_HOLD_CHARGE_WINDOW_DAYS ago, whatever the
 * booking's status (including uncharged No-Show and Completed). The charge
 * window is derived (booking end + window), never stored, so candidates are
 * loaded in bounded batches and filtered here. The release helper stamps
 * released_at / release_reason 'expired', inserts card_hold_released events,
 * and best-effort deletes the booking-scoped Stripe customer (the last open
 * hold on a shared customer deletes it; a Stripe failure is a logged cleanup
 * miss, not a security hole: the charge guard keys on released_at).
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('release-card-holds', handlePost);

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();

    // Server-side prefilter: an expired hold's booking_date is always at least
    // CARD_HOLD_CHARGE_WINDOW_DAYS in the past (the end is on booking_date or,
    // for overnight tables, the day after, and the window adds the full 14
    // days on top). Filtering on the joined booking_date keeps the 200-row
    // batch from being starved by older-but-not-yet-expired holds (for
    // example, holds on far-future bookings created long ago). The JS check
    // below stays the precise gate.
    const prefilterCutoffYmd = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: rows, error: fetchErr } = await supabase
      .from('booking_card_holds')
      .select(
        'booking_id, booking:bookings!inner(id, booking_date, booking_time, booking_end_time, estimated_end_time)',
      )
      .is('released_at', null)
      .lte('booking.booking_date', prefilterCutoffYmd)
      .order('created_at', { ascending: true })
      .limit(200);

    if (fetchErr) {
      console.error('release-card-holds fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Fetch failed' }, { status: 500 });
    }

    const nowMs = Date.now();
    const expiredBookingIds: string[] = [];
    for (const row of rows ?? []) {
      const booking = normalizeEmbeddedBooking(
        (row as { booking: unknown }).booking,
      ) as (CardHoldWindowBookingFields & { id: string }) | null;
      if (!booking) continue;
      if (isCardHoldChargeWindowExpired(booking, nowMs)) {
        expiredBookingIds.push(booking.id);
      }
    }

    let released = 0;
    if (expiredBookingIds.length > 0) {
      const result = await releaseCardHoldsForBookings(supabase, expiredBookingIds, 'expired');
      released = result.releasedBookingIds.length;
    }

    return NextResponse.json({ checked: (rows ?? []).length, released });
  } catch (err) {
    console.error('release-card-holds failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
