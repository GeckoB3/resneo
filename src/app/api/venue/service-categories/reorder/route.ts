import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';

const reorderSchema = z.object({
  category_ids: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * PUT /api/venue/service-categories/reorder: set the order categories appear in on
 * the booking pages. Writes `sort_order = index` for each id, the same idiom as
 * PUT /api/venue/appointment-services/reorder, which this mirrors.
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (staff.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only venue admins can reorder categories.' },
        { status: 403 },
      );
    }

    const parsed = reorderSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }
    const ids = parsed.data.category_ids;
    if (new Set(ids).size !== ids.length) {
      return NextResponse.json(
        { error: 'Something went wrong while saving the order. Refresh the page and try again.' },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();
    const { data: rows, error: fetchErr } = await admin
      .from('service_categories')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .in('id', ids);
    if (fetchErr) {
      console.error('PUT /api/venue/service-categories/reorder fetch failed:', fetchErr);
      return NextResponse.json({ error: 'Failed to verify categories' }, { status: 500 });
    }
    const owned = new Set((rows ?? []).map((r) => r.id as string));
    if (ids.some((id) => !owned.has(id))) {
      return NextResponse.json(
        { error: 'One or more categories were not found for this venue. Refresh the page and try again.' },
        { status: 400 },
      );
    }

    const results = await Promise.all(
      ids.map((id, idx) =>
        admin
          .from('service_categories')
          .update({ sort_order: idx, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('venue_id', staff.venue_id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      console.error('PUT /api/venue/service-categories/reorder update failed:', failed.error);
      return NextResponse.json({ error: 'Failed to save the new order' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/venue/service-categories/reorder failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
