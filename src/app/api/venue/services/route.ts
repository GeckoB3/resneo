import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import { detectOverlaps, formatOverlapWarning } from '@/lib/service-overlap';
import { ensureDefaultDiningAreaForVenue } from '@/lib/areas/resolve-default-area';
import {
  buildEntityNotFoundMessage,
  buildUpcomingBookingsBlockMessage,
  hasUpcomingActiveBookingsForVenueService,
} from '@/lib/venue/entity-delete-booking-guards';

const serviceSchema = z.object({
  name: z.string().min(1).max(100),
  days_of_week: z.array(z.number().int().min(0).max(6)).min(1),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  last_booking_time: z.string().regex(/^\d{2}:\d{2}$/),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  area_id: z.string().uuid().optional(),
});

async function getOverlapWarnings(venueId: string, areaId?: string | null): Promise<string[]> {
  const admin = getSupabaseAdminClient();
  let q = admin
    .from('venue_services')
    .select('name, days_of_week, start_time, end_time, is_active')
    .eq('venue_id', venueId);
  if (areaId) {
    q = q.eq('area_id', areaId);
  }
  const { data } = await q;
  if (!data || data.length < 2) return [];
  return detectOverlaps(data).map(formatOverlapWarning);
}

/** GET /api/venue/services - list services for the authenticated user's venue. Optional `area_id` filters dining areas. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const areaId = request.nextUrl.searchParams.get('area_id');

    const admin = getSupabaseAdminClient();
    let query = admin
      .from('venue_services')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .order('sort_order', { ascending: true });
    if (areaId) {
      query = query.eq('area_id', areaId);
    }
    const { data, error } = await query;

    if (error) {
      console.error('GET /api/venue/services failed:', error);
      return NextResponse.json({ error: 'Failed to fetch services' }, { status: 500 });
    }

    return NextResponse.json({ services: data });
  } catch (err) {
    console.error('GET /api/venue/services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/services - create a new service (admin only). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const parsed = serviceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { area_id: bodyAreaId, ...serviceFields } = parsed.data;
    const areaId = bodyAreaId ?? (await ensureDefaultDiningAreaForVenue(admin, staff.venue_id));
    if (!areaId) {
      return NextResponse.json({ error: 'No dining area configured for this venue' }, { status: 400 });
    }

    const { data, error } = await admin
      .from('venue_services')
      .insert({ venue_id: staff.venue_id, ...serviceFields, area_id: areaId })
      .select('*')
      .single();

    if (error) {
      console.error('POST /api/venue/services failed:', error);
      return NextResponse.json(
        { error: 'Failed to create service.', details: error.message },
        { status: 500 },
      );
    }

    const overlapWarnings = await getOverlapWarnings(staff.venue_id, areaId);
    return NextResponse.json({ service: data, overlapWarnings }, { status: 201 });
  } catch (err) {
    console.error('POST /api/venue/services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/services - update an existing service (admin only). Body must include `id`. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: 'Missing service id' }, { status: 400 });

    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from('venue_services')
      .update(fields)
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .select('*')
      .single();

    if (error) {
      console.error('PATCH /api/venue/services failed:', error);
      return NextResponse.json({ error: 'Failed to update service' }, { status: 500 });
    }

    const overlapWarnings = await getOverlapWarnings(
      staff.venue_id,
      (data as { area_id?: string | null }).area_id ?? null,
    );
    return NextResponse.json({ service: data, overlapWarnings });
  } catch (err) {
    console.error('PATCH /api/venue/services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/services - delete a service (admin only). Body must include `id`. */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'Missing service id' }, { status: 400 });

    const admin = getSupabaseAdminClient();

    const { data: existing, error: lookupErr } = await admin
      .from('venue_services')
      .select('id')
      .eq('id', body.id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (lookupErr) {
      console.error('DELETE /api/venue/services lookup failed:', lookupErr);
      return NextResponse.json(
        { error: 'Could not verify the service. Please try again.' },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { error: buildEntityNotFoundMessage('service') },
        { status: 404 },
      );
    }

    const guard = await hasUpcomingActiveBookingsForVenueService(admin, staff.venue_id, body.id);
    if (guard.error) {
      return NextResponse.json({ error: guard.error }, { status: 500 });
    }
    if (guard.blocked) {
      return NextResponse.json(
        {
          error: buildUpcomingBookingsBlockMessage('service', guard.bookingCount),
          booking_count: guard.bookingCount,
        },
        { status: 409 },
      );
    }

    const { error } = await admin
      .from('venue_services')
      .delete()
      .eq('id', body.id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE /api/venue/services failed:', error);
      return NextResponse.json(
        { error: 'Failed to delete the service. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/services failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
