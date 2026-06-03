import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff } from '@/lib/venue-auth';
import { requireCompliancePlan } from '@/lib/compliance/auth';
import { loadBookingComplianceFlags } from '@/lib/compliance/booking-flags';

const bodySchema = z.object({
  booking_ids: z.array(z.string().uuid()).max(500),
});

/**
 * POST /api/venue/compliance/booking-flags — per-booking compliance status for the
 * visible calendar / list, so staff get an at-a-glance indicator on each bar without
 * opening anything. Body: `{ booking_ids }`. Returns `{ flags: { [id]: {...} } }`,
 * omitting bookings that carry no requirement.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const gate = await requireCompliancePlan(staff);
    if (!gate.ok) return gate.response;

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'booking_ids (array of uuids) is required.' }, { status: 400 });
    }
    if (parsed.data.booking_ids.length === 0) {
      return NextResponse.json({ flags: {} });
    }

    const flags = await loadBookingComplianceFlags(staff.db, staff.venue_id, parsed.data.booking_ids);
    return NextResponse.json({ flags });
  } catch (err) {
    console.error('POST /api/venue/compliance/booking-flags failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
