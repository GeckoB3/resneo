import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
} from '@/lib/booking/resource-booking-defaults';

/**
 * GET /api/venue/resources/[id] - single resource (venue-scoped).
 * Reads from unified_calendars where calendar_type='resource'.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data, error } = await admin
      .from('unified_calendars')
      .select('*')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .eq('calendar_type', 'resource')
      .maybeSingle();

    if (error) {
      console.error('GET /api/venue/resources/[id] failed:', error);
      return NextResponse.json({ error: 'Failed to fetch resource' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const row = data as Record<string, unknown>;
    return NextResponse.json({
      resource: {
        id: row.id,
        venue_id: row.venue_id,
        name: row.name,
        resource_type: row.resource_type ?? null,
        slot_interval_minutes: row.slot_interval_minutes ?? DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
        min_booking_minutes: row.min_booking_minutes ?? DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
        max_booking_minutes: row.max_booking_minutes ?? 180,
        price_per_slot_pence: row.price_per_slot_pence ?? null,
        payment_requirement: (row.payment_requirement as string) ?? 'none',
        deposit_amount_pence: row.deposit_amount_pence ?? null,
        is_active: row.is_active ?? true,
        availability_hours: row.working_hours ?? {},
        availability_exceptions: row.availability_exceptions ?? {},
        sort_order: row.sort_order ?? 0,
        created_at: row.created_at,
        display_on_calendar_id: (row.display_on_calendar_id as string | null | undefined) ?? null,
      },
    });
  } catch (err) {
    console.error('GET /api/venue/resources/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
