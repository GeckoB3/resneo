import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import { listActiveAreasForVenue } from '@/lib/areas/resolve-default-area';
import { isPublicOnlineBookingBlocked } from '@/lib/billing/subscription-entitlement';
import { mergePublicTableBookingRulesFromRestrictions } from '@/lib/booking/public-table-venue-booking-rules';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { mapVenueFeatureFlagsForPublic } from '@/lib/booking/venue-public-feature-flags';

/**
 * GET /api/booking/venue?slug=venue-slug
 * Public: returns venue profile for the booking page (name, cover, slug, deposit_config, booking_rules, id).
 * Does not expose stripe_connected_account_id to client.
 *
 * When the venue uses the service-based availability engine, booking_rules
 * is populated from booking_restrictions so the party size selector reflects
 * the correct limits.
 */
export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get('slug');
    if (!slug?.trim()) {
      return NextResponse.json({ error: 'Missing slug' }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();
    const { data: venue, error } = await supabase
      .from('venues')
      .select(
        'id, name, slug, cover_photo_url, logo_url, address, phone, website_url, deposit_config, booking_rules, opening_hours, timezone, booking_model, enabled_models, active_booking_models, terminology, currency, public_booking_area_mode, pricing_tier, plan_status, subscription_current_period_end, billing_access_source, feature_flags',
      )
      .eq('slug', slug.trim())
      .single();

    if (error || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const venueMode = await resolveVenueMode(supabase, venue.id);

    if (venueMode.bookingModel === 'table_reservation') {
      const usesNewEngine = venueMode.availabilityEngine === 'service';
      if (usesNewEngine) {
        venue.booking_rules = await mergePublicTableBookingRulesFromRestrictions(
          supabase,
          venue.id,
          venue.booking_rules,
        );
      }
    }

    let areas: Awaited<ReturnType<typeof listActiveAreasForVenue>> = [];
    if (venueMode.bookingModel === 'table_reservation') {
      areas = await listActiveAreasForVenue(supabase, venue.id);
    }

    const venueFlags = parseVenueFeatureFlags((venue as { feature_flags?: unknown }).feature_flags);
    const resolvedFlags = resolveAppointmentsFeatureFlags(venueFlags);
    const publicFeatureFlags = mapVenueFeatureFlagsForPublic(
      (venue as { feature_flags?: unknown }).feature_flags,
    );

    const payload: Record<string, unknown> = {
      ...venue,
      booking_model: venueMode.bookingModel,
      active_booking_models: venueMode.activeBookingModels,
      enabled_models: venueMode.enabledModels,
      terminology: venueMode.terminology,
      areas,
      feature_flags: {
        resolved: {
          any_available_practitioner: resolvedFlags.any_available_practitioner,
          guest_self_reschedule: resolvedFlags.guest_self_reschedule,
          waitlist_v2: resolvedFlags.waitlist_v2,
        },
        any_available_practitioner_config: publicFeatureFlags?.any_available_practitioner_config,
      },
    };

    if (
      isPublicOnlineBookingBlocked({
        pricing_tier: (venue as { pricing_tier?: string | null }).pricing_tier,
        plan_status: (venue as { plan_status?: string | null }).plan_status,
        subscription_current_period_end: (venue as { subscription_current_period_end?: string | null })
          .subscription_current_period_end,
        billing_access_source: (venue as { billing_access_source?: string | null }).billing_access_source,
      })
    ) {
      payload.booking_paused = true;
    }

    return NextResponse.json(payload);
  } catch (err) {
    console.error('GET /api/booking/venue failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
