import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, getLinkedPractitionerId, getStaffManagedCalendarIds } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import { normalizeToE164 } from '@/lib/phone/e164';

const patchSchema = z
  .object({
    name: z.string().max(200).optional(),
    phone: z.union([z.string().max(24), z.literal('')]).optional(),
    email: z.string().email('Valid email required').optional(),
  })
  .refine((d) => d.name !== undefined || d.phone !== undefined || d.email !== undefined, {
    message: 'Provide at least one field to update',
  });

/** GET /api/venue/staff/me - current user's staff profile (name, email, phone, role). */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data: row, error } = await staff.db
      .from('staff')
      .select('id, email, name, phone, role')
      .eq('id', staff.id)
      .single();

    if (error || !row) {
      console.error('GET /api/venue/staff/me staff row failed:', error?.message);
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    }

    const admin = getSupabaseAdminClient();
    const linked_practitioner_id = await getLinkedPractitionerId(admin, staff.venue_id, staff.id);
    const linked_calendar_ids = await getStaffManagedCalendarIds(admin, staff.venue_id, staff.id);

    return NextResponse.json({ staff: { ...row, linked_practitioner_id, linked_calendar_ids } });
  } catch (err) {
    console.error('GET /api/venue/staff/me failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/staff/me - update own display name, phone, and/or sign-in email. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      );
    }

    const { data: current, error: loadErr } = await staff.db
      .from('staff')
      .select('id, email, name, phone')
      .eq('id', staff.id)
      .single();

    if (loadErr || !current) {
      console.error('PATCH /api/venue/staff/me load failed:', loadErr?.message);
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    }

    const updates: Record<string, string | null> = {};

    if (parsed.data.name !== undefined) {
      updates.name = parsed.data.name.trim() || null;
    }
    if (parsed.data.phone !== undefined) {
      const t = parsed.data.phone.trim();
      if (!t) {
        updates.phone = null;
      } else {
        const e164 = normalizeToE164(t, 'GB');
        if (!e164) {
          return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
        }
        updates.phone = e164;
      }
    }

    if (parsed.data.email !== undefined) {
      const normalised = parsed.data.email.trim().toLowerCase();
      if (normalised !== current.email.toLowerCase()) {
        const { data: conflict } = await staff.db
          .from('staff')
          .select('id')
          .eq('venue_id', staff.venue_id)
          .eq('email', normalised)
          .neq('id', staff.id)
          .maybeSingle();

        if (conflict) {
          return NextResponse.json(
            { error: 'Another team member at this venue already uses this email' },
            { status: 409 },
          );
        }

        const { error: authErr } = await staff.db.auth.admin.updateUserById(user.id, {
          email: normalised,
          email_confirm: true,
        });

        if (authErr) {
          console.error('PATCH /api/venue/staff/me auth email update failed:', authErr.message);
          return NextResponse.json(
            { error: authErr.message ?? 'Could not update sign-in email' },
            { status: 400 },
          );
        }

        updates.email = normalised;
      }
    }

    if (Object.keys(updates).length === 0) {
      const { data: unchanged } = await staff.db
        .from('staff')
        .select('id, email, name, phone, role')
        .eq('id', staff.id)
        .single();
      return NextResponse.json({ staff: unchanged });
    }

    const { data: updated, error: updateErr } = await staff.db
      .from('staff')
      .update(updates)
      .eq('id', staff.id)
      .select('id, email, name, phone, role')
      .single();

    if (updateErr) {
      console.error('PATCH /api/venue/staff/me update failed:', updateErr);
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    return NextResponse.json({ staff: updated });
  } catch (err) {
    console.error('PATCH /api/venue/staff/me failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
