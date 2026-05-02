import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { fieldKeyFromName } from '@/lib/guests/custom-field-validation';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const postSchema = z.object({
  field_name: z.string().min(1).max(120),
  field_type: z.enum(['text', 'number', 'date', 'boolean']),
});

/**
 * GET /api/venue/contacts/custom-fields — list venue definitions.
 * POST — create definition (field_key derived from name).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data, error } = await staff.db
      .from('custom_client_fields')
      .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
      .eq('venue_id', staff.venue_id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('GET custom-fields failed:', error);
      return NextResponse.json({ error: 'Failed to load custom fields' }, { status: 500 });
    }

    return NextResponse.json({ fields: data ?? [] });
  } catch (err) {
    console.error('GET /api/venue/contacts/custom-fields failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    let fieldKey = fieldKeyFromName(parsed.data.field_name);
    const baseKey = fieldKey;
    for (let i = 2; i < 50; i += 1) {
      const { data: clash } = await staff.db
        .from('custom_client_fields')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('field_key', fieldKey)
        .maybeSingle();
      if (!clash) break;
      fieldKey = `${baseKey}_${i}`;
    }

    const { data: created, error } = await staff.db
      .from('custom_client_fields')
      .insert({
        venue_id: staff.venue_id,
        field_name: parsed.data.field_name.trim(),
        field_key: fieldKey,
        field_type: parsed.data.field_type,
        is_active: true,
      })
      .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
      .single();

    if (error) {
      console.error('POST custom-fields failed:', error);
      return NextResponse.json({ error: 'Failed to create custom field' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: null,
      actor_staff_id: staff.id,
      event_type: 'custom_field_created',
      metadata: { field_id: created.id, field_key: fieldKey },
    });

    return NextResponse.json({ field: created });
  } catch (err) {
    console.error('POST /api/venue/contacts/custom-fields failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
