import { NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { isOptionalSetupStepKey } from '@/lib/venue/setup-checklist-steps';

/**
 * POST — record that the current staff member chose "Not now" on an optional setup
 * checklist row (persists across sessions / devices, unlike the localStorage nudges).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { step_key?: unknown };
    if (!isOptionalSetupStepKey(body.step_key)) {
      return NextResponse.json({ error: 'Unknown or non-optional step key' }, { status: 400 });
    }
    const stepKey = body.step_key;

    const { data: existingRow, error: readError } = await staff.db
      .from('staff')
      .select('dashboard_setup_checklist_snoozed_keys')
      .eq('id', staff.id)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (readError) {
      console.error('[POST /api/venue/setup-checklist-snooze] read failed:', readError.message, {
        staffId: staff.id,
        venueId: staff.venue_id,
      });
      return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 });
    }

    const existing =
      (existingRow as { dashboard_setup_checklist_snoozed_keys?: string[] | null } | null)
        ?.dashboard_setup_checklist_snoozed_keys ?? [];
    const snoozedKeys = [...new Set([...existing.filter(isOptionalSetupStepKey), stepKey])];

    const { error } = await staff.db
      .from('staff')
      .update({ dashboard_setup_checklist_snoozed_keys: snoozedKeys })
      .eq('id', staff.id)
      .eq('venue_id', staff.venue_id);

    if (error) {
      console.error('[POST /api/venue/setup-checklist-snooze] update failed:', error.message, {
        staffId: staff.id,
        venueId: staff.venue_id,
        stepKey,
      });
      return NextResponse.json({ error: 'Failed to save preference' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, snoozed_keys: snoozedKeys });
  } catch (err) {
    console.error('POST /api/venue/setup-checklist-snooze failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
