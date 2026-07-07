import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { venueUsesUnifiedAppointmentServiceData } from '@/lib/booking/uses-unified-appointment-data';

const reorderSchema = z.object({
  service_ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * PUT /api/venue/appointment-services/reorder - set the display order of the venue's
 * services. Writes `sort_order = index` for each id; this order drives the service
 * lists on the public booking page and the staff booking flow.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (staff.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only venue admins can reorder services.' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const parsed = reorderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const serviceIds = parsed.data.service_ids;
    if (new Set(serviceIds).size !== serviceIds.length) {
      return NextResponse.json({ error: 'Duplicate service ids in order list.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const table = (await venueUsesUnifiedAppointmentServiceData(admin, staff.venue_id))
      ? 'service_items'
      : 'appointment_services';

    const { data: rows, error: fetchErr } = await admin
      .from(table)
      .select('id')
      .eq('venue_id', staff.venue_id)
      .in('id', serviceIds);
    if (fetchErr) {
      console.error(`PUT /api/venue/appointment-services/reorder (${table}) fetch failed:`, fetchErr);
      return NextResponse.json({ error: 'Failed to verify services' }, { status: 500 });
    }
    const ownedIds = new Set((rows ?? []).map((r) => r.id as string));
    if (serviceIds.some((id) => !ownedIds.has(id))) {
      return NextResponse.json(
        { error: 'One or more services were not found for this venue. Refresh the page and try again.' },
        { status: 400 },
      );
    }

    const results = await Promise.all(
      serviceIds.map((id, idx) =>
        admin.from(table).update({ sort_order: idx }).eq('id', id).eq('venue_id', staff.venue_id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error(`PUT /api/venue/appointment-services/reorder (${table}) update failed:`, failed.error);
      return NextResponse.json({ error: 'Failed to save the new order' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/venue/appointment-services/reorder failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
