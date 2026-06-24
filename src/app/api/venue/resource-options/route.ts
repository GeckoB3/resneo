import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';

/**
 * GET /api/venue/resource-options
 * Staff: active resources for the signed-in venue (metadata for booking UI).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const venueMode = await resolveVenueMode(admin, staff.venue_id);
    const canResource =
      venueMode.bookingModel === 'resource_booking' ||
      venueMode.enabledModels.includes('resource_booking');
    if (!canResource) {
      return NextResponse.json({ error: 'This venue does not offer resource bookings' }, { status: 403 });
    }

    const { data, error } = await admin
      .from('unified_calendars')
      .select(
        'id, name, resource_type, description, photo_url, min_booking_minutes, max_booking_minutes, slot_interval_minutes, price_per_slot_pence, payment_requirement, deposit_amount_pence, cancellation_notice_hours, sort_order',
      )
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .eq('is_active', true)
      .order('sort_order');

    if (error) {
      console.error('GET /api/venue/resource-options failed:', error);
      return NextResponse.json({ error: 'Failed to load resources' }, { status: 500 });
    }

    const resources = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
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
        payment_requirement: (r.payment_requirement as string) ?? 'none',
        deposit_amount_pence: (r.deposit_amount_pence as number | null) ?? null,
        cancellation_notice_hours:
          typeof r.cancellation_notice_hours === 'number' && Number.isFinite(r.cancellation_notice_hours)
            ? r.cancellation_notice_hours
            : 48,
      };
    });

    return NextResponse.json({ venue_id: staff.venue_id, resources });
  } catch (err) {
    console.error('GET /api/venue/resource-options failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
