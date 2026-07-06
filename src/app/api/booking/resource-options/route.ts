import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { venueExposesBookingModel } from '@/lib/booking/enabled-models';
import { nextResponseIfPublicBookingBlockedForVenue } from '@/lib/booking/light-plan-public-block';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';
import { loadVenueFeatureFlags } from '@/lib/feature-flags/venue';

/**
 * GET /api/booking/resource-options?venue_id=uuid
 * Public list of bookable resources (metadata only; no per-day slots).
 */
export async function GET(request: NextRequest) {
  try {
    const venueId = request.nextUrl.searchParams.get('venue_id');
    if (!venueId) {
      return NextResponse.json({ error: 'venue_id is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const blocked = await nextResponseIfPublicBookingBlockedForVenue(supabase, venueId);
    if (blocked) return blocked;

    const venueMode = await resolveVenueMode(supabase, venueId);
    if (!venueExposesBookingModel(venueMode.bookingModel, venueMode.enabledModels, 'resource_booking')) {
      return NextResponse.json({ error: 'Resource bookings are not available for this venue' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('unified_calendars')
      .select(
        'id, name, resource_type, description, photo_url, min_booking_minutes, max_booking_minutes, slot_interval_minutes, price_per_slot_pence, payment_requirement, deposit_amount_pence, cancellation_notice_hours, sort_order',
      )
      .eq('venue_id', venueId)
      .eq('calendar_type', 'resource')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      console.error('GET /api/booking/resource-options failed:', error);
      return NextResponse.json({ error: 'Failed to load resources' }, { status: 500 });
    }

    // Card-hold passthrough (spec 6.3): 'card_hold' reaches guests only when the
    // venue flag is on AND a positive fee is configured; otherwise degrade to
    // 'none' (and drop the fee) with a warning, matching what create will do.
    const { resolved: venueFlags } = await loadVenueFeatureFlags(supabase, venueId);
    const cardHoldDepositsEnabled = venueFlags.card_hold_deposits;

    const resources = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      let paymentRequirement = (r.payment_requirement as string) ?? 'none';
      let depositAmountPence = (r.deposit_amount_pence as number | null) ?? null;
      if (paymentRequirement === 'card_hold' && (!cardHoldDepositsEnabled || (depositAmountPence ?? 0) <= 0)) {
        console.warn(
          cardHoldDepositsEnabled
            ? '[resource-options] card_hold resource has no positive fee; treating as none'
            : '[resource-options] card_hold resource configured but card_hold_deposits flag is off; treating as none',
          { resource_id: r.id },
        );
        paymentRequirement = 'none';
        depositAmountPence = null;
      }
      return {
        id: r.id as string,
        name: r.name as string,
        resource_type: (r.resource_type as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        photo_url: (r.photo_url as string | null) ?? null,
        min_booking_minutes: (r.min_booking_minutes as number | null) ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
        max_booking_minutes: (r.max_booking_minutes as number | null) ?? 180,
        slot_interval_minutes: (r.slot_interval_minutes as number | null) ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
        price_per_slot_pence: (r.price_per_slot_pence as number | null) ?? null,
        payment_requirement: paymentRequirement,
        deposit_amount_pence: depositAmountPence,
        cancellation_notice_hours:
          typeof r.cancellation_notice_hours === 'number' && Number.isFinite(r.cancellation_notice_hours)
            ? r.cancellation_notice_hours
            : 48,
      };
    });

    return NextResponse.json({ venue_id: venueId, resources });
  } catch (err) {
    console.error('GET /api/booking/resource-options failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
