import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { eraseGuestVenuePii } from '@/lib/guests/gdpr-erase-guest';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';
import { releaseCardHoldsForBookings } from '@/lib/booking/card-hold-release';

const bodySchema = z.object({
  guest_id: z.string().uuid(),
});

/**
 * POST /api/venue/gdpr/erase-guest
 * Staff-only admin. Anonymises guest PII and clears identifiable fields on related bookings.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
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

    // Spec §15 — an "erased" guest must not keep a vaulted, chargeable card:
    // release any open holds on their bookings (reason 'admin'); the helper
    // also best-effort deletes the booking-scoped Stripe customers. Runs
    // before anonymisation and fails the request on a release error so the
    // admin can retry (the whole operation is idempotent).
    try {
      const { data: guestBookings, error: gbErr } = await admin
        .from('bookings')
        .select('id')
        .eq('venue_id', staff.venue_id)
        .eq('guest_id', guestId);
      if (gbErr) throw gbErr;
      const bookingIds = (guestBookings ?? []).map((b: { id: string }) => b.id);
      if (bookingIds.length > 0) {
        await releaseCardHoldsForBookings(admin, bookingIds, 'admin');
      }
    } catch (holdErr) {
      console.error('erase-guest: card-hold release failed:', holdErr);
      return NextResponse.json({ error: 'Failed to erase guest data' }, { status: 500 });
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
