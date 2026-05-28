import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { addonGroupInputSchema } from '@/lib/addons/zod-schemas';
import { upsertAddonGroup, addonGroupHasBookings } from '@/lib/venue/addon-groups';

const patchBodySchema = z.object({ group: addonGroupInputSchema });

interface RouteCtx {
  params: { id: string } | Promise<{ id: string }>;
}

async function resolveParams(ctx: RouteCtx): Promise<{ id: string }> {
  const params = await Promise.resolve(ctx.params);
  return params;
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    }
    const { id } = await resolveParams(ctx);

    const body = await request.json();
    const parsed = patchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const admin = getSupabaseAdminClient();

    // Verify the group belongs to this venue.
    const { data: existing } = await admin
      .from('addon_groups')
      .select('id, venue_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing || (existing as { venue_id?: string }).venue_id !== staff.venue_id) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const result = await upsertAddonGroup({
      admin,
      venueId: staff.venue_id,
      groupInput: parsed.data.group,
      existingId: id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({ group: result.group, addons: result.addons });
  } catch (err) {
    console.error('PATCH /api/venue/addon-groups/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/venue/addon-groups/[id]
 * Hard-delete only when there are zero booking_addons referencing the group;
 * otherwise soft-deactivate (`is_active = false`). The dashboard handles the
 * 409 by offering the "archive" path automatically.
 */
export async function DELETE(_request: NextRequest, ctx: RouteCtx) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Admin role required.' }, { status: 403 });
    }
    const { id } = await resolveParams(ctx);

    const admin = getSupabaseAdminClient();
    const { data: existing } = await admin
      .from('addon_groups')
      .select('id, venue_id, is_active')
      .eq('id', id)
      .maybeSingle();
    if (!existing || (existing as { venue_id?: string }).venue_id !== staff.venue_id) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const hasBookings = await addonGroupHasBookings(admin, id);
    if (hasBookings) {
      const { error: updErr } = await admin
        .from('addon_groups')
        .update({ is_active: false })
        .eq('id', id)
        .eq('venue_id', staff.venue_id);
      if (updErr) {
        console.error('DELETE addon-group archive failed:', updErr);
        return NextResponse.json({ error: 'Failed to archive group' }, { status: 500 });
      }
      return NextResponse.json({ archived: true });
    }

    const { error: delErr } = await admin
      .from('addon_groups')
      .delete()
      .eq('id', id)
      .eq('venue_id', staff.venue_id);
    if (delErr) {
      console.error('DELETE addon-group failed:', delErr);
      return NextResponse.json({ error: 'Failed to delete group' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/addon-groups/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
