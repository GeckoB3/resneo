import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin, invalidateCachedStaffIdentity } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';

const patchSchema = z.object({
  role: z.enum(['admin', 'staff']).optional(),
  name: z.string().max(200).optional(),
});

/** PATCH /api/venue/staff/[id] - update staff member role or name (admin only). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const { id } = await params;
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const admin = getSupabaseAdminClient();

    const { data: target } = await admin
      .from('staff')
      .select('id, venue_id, email, role, user_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (!target) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });

    if (parsed.data.role && target.id === staff.id) {
      return NextResponse.json({ error: 'You cannot change your own role' }, { status: 400 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.role !== undefined) update.role = parsed.data.role;
    if (parsed.data.name !== undefined) update.name = parsed.data.name || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const { data: updated, error: updateErr } = await admin
      .from('staff')
      .update(update)
      .eq('id', id)
      .select('id, email, name, role, created_at')
      .single();

    if (updateErr) {
      console.error('PATCH /api/venue/staff/[id] failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update staff member' }, { status: 500 });
    }

    // §16.1 #10 — a role change (e.g. admin → staff) must take effect immediately,
    // not after the 30s identity-cache TTL. Bust the cached identity for that user.
    if (parsed.data.role !== undefined && target.user_id) {
      invalidateCachedStaffIdentity(target.user_id as string);
    }

    return NextResponse.json({ staff: updated });
  } catch (err) {
    console.error('PATCH /api/venue/staff/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** DELETE /api/venue/staff/[id] - remove staff member (admin only). */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

    const { id } = await params;

    if (id === staff.id) {
      return NextResponse.json({ error: 'You cannot remove yourself' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    const { data: target } = await admin
      .from('staff')
      .select('id, venue_id, user_id')
      .eq('id', id)
      .eq('venue_id', staff.venue_id)
      .single();

    if (!target) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 });

    const { error: deleteErr } = await admin
      .from('staff')
      .delete()
      .eq('id', id);

    if (deleteErr) {
      console.error('DELETE /api/venue/staff/[id] failed:', deleteErr);
      return NextResponse.json({ error: 'Failed to remove staff member' }, { status: 500 });
    }

    // §16.1 #10 — revoke access immediately rather than after the cache TTL.
    if (target.user_id) invalidateCachedStaffIdentity(target.user_id as string);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/staff/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
