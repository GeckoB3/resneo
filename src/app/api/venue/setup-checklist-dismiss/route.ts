import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';

/** POST — record that the current staff member dismissed the dashboard setup checklist (persists across sessions). */
export async function POST() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const dismissedAt = new Date().toISOString();
    const { error } = await staff.db
      .from('staff')
      .update({ dashboard_setup_checklist_dismissed_at: dismissedAt })
      .eq('id', staff.id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('[POST /api/venue/setup-checklist-dismiss] update failed:', error.message, {
        staffId: staff.id,
        venueId: staff.venue_id,
      });
      return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, dismissed_at: dismissedAt });
  } catch (err) {
    console.error('POST /api/venue/setup-checklist-dismiss failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
