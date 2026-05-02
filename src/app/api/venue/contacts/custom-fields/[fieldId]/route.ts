import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const patchSchema = z.object({
  field_name: z.string().min(1).max(120).optional(),
  is_active: z.boolean().optional(),
});

/**
 * PATCH /api/venue/contacts/custom-fields/[fieldId]
 * DELETE — soft deactivate (is_active false) or hard delete; we use PATCH is_active for soft.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { fieldId } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { data: existing, error: exErr } = await staff.db
      .from('custom_client_fields')
      .select('id')
      .eq('id', fieldId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (exErr || !existing) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.field_name !== undefined) update.field_name = parsed.data.field_name.trim();
    if (parsed.data.is_active !== undefined) update.is_active = parsed.data.is_active;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No changes' }, { status: 400 });
    }

    const { data: updated, error } = await staff.db
      .from('custom_client_fields')
      .update(update)
      .eq('id', fieldId)
      .eq('venue_id', staff.venue_id)
      .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
      .single();

    if (error) {
      console.error('PATCH custom-field failed:', error);
      return NextResponse.json({ error: 'Failed to update field' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: null,
      actor_staff_id: staff.id,
      event_type: 'custom_field_updated',
      metadata: { field_id: fieldId, patch: parsed.data },
    });

    return NextResponse.json({ field: updated });
  } catch (err) {
    console.error('PATCH /api/venue/contacts/custom-fields/[fieldId] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fieldId: string }> },
) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { fieldId } = await params;

    const { error } = await staff.db
      .from('custom_client_fields')
      .delete()
      .eq('id', fieldId)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('DELETE custom-field failed:', error);
      return NextResponse.json({ error: 'Failed to delete field' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: null,
      actor_staff_id: staff.id,
      event_type: 'custom_field_deleted',
      metadata: { field_id: fieldId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/venue/contacts/custom-fields/[fieldId] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
