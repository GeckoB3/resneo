import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { eraseGuestVenuePii } from '@/lib/guests/gdpr-erase-guest';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';

const bodySchema = z.object({
  guest_id: z.string().uuid(),
});

/**
 * POST /api/venue/gdpr/erase-guest
 * Staff-only admin. Anonymises guest PII and clears identifiable fields on related bookings.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { guest_id: guestId } = parsed.data;
    const admin = getSupabaseAdminClient();

    const { data: guest, error: guestErr } = await admin
      .from('guests')
      .select('id, venue_id')
      .eq('id', guestId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (guestErr || !guest) {
      return NextResponse.json({ error: 'Guest not found' }, { status: 404 });
    }

    try {
      await eraseGuestVenuePii(admin, staff.venue_id, guestId);
    } catch (e) {
      console.error('erase-guest: eraseGuestVenuePii failed:', e);
      return NextResponse.json({ error: 'Failed to erase guest data' }, { status: 500 });
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: guestId,
      actor_staff_id: staff.id,
      event_type: 'gdpr_erase_guest',
      metadata: {},
    });

    return NextResponse.json({ success: true, guest_id: guestId });
  } catch (err) {
    console.error('POST /api/venue/gdpr/erase-guest failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
