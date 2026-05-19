import { NextRequest, NextResponse } from 'next/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import {
  mergeVenueFeatureFlagsPatch,
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlags,
  venueFeatureFlagsForStorage,
} from '@/lib/feature-flags/resolve';
import { venueFeatureFlagsSchema } from '@/lib/feature-flags/types';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { listVenueCalendarSortOrder } from '@/lib/availability/appointment-any-practitioner';
import { parseAnyAvailablePractitionerConfig } from '@/lib/feature-flags/any-available-practitioner-config';

const patchSchema = venueFeatureFlagsSchema.partial();

interface CalendarRowForSettings {
  id: string;
  name: string;
}

async function loadVenueCalendarsForSettings(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  venueId: string,
  sortOrder: string[],
): Promise<CalendarRowForSettings[]> {
  const { data: unified } = await supabase
    .from('unified_calendars')
    .select('id, name, sort_order')
    .eq('venue_id', venueId)
    .eq('is_active', true);
  const rows: CalendarRowForSettings[] =
    unified && unified.length > 0
      ? (unified as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name }))
      : (
          (
            await supabase
              .from('practitioners')
              .select('id, name, sort_order')
              .eq('venue_id', venueId)
              .eq('is_active', true)
          ).data ?? []
        ).map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name }));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered: CalendarRowForSettings[] = [];
  for (const id of sortOrder) {
    const row = byId.get(id);
    if (row) {
      ordered.push(row);
      byId.delete(id);
    }
  }
  for (const row of rows) {
    if (byId.has(row.id)) ordered.push(row);
  }
  return ordered;
}

/** GET /api/venue/feature-flags — resolved flags for the authenticated venue. */
export async function GET() {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }

    const { data, error } = await staff.db
      .from('venues')
      .select('feature_flags')
      .eq('id', staff.venue_id)
      .single();

    if (error || !data) {
      console.error('GET /api/venue/feature-flags failed:', error?.message);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const raw = parseVenueFeatureFlags((data as { feature_flags?: unknown }).feature_flags);
    const admin = getSupabaseAdminClient();
    const calendarOrder = await listVenueCalendarSortOrder(admin, staff.venue_id);
    const calendars = await loadVenueCalendarsForSettings(admin, staff.venue_id, calendarOrder);
    return NextResponse.json({
      raw,
      resolved: resolveAppointmentsFeatureFlags(raw),
      any_available_practitioner_config: parseAnyAvailablePractitionerConfig(raw),
      calendars,
    });
  } catch (err) {
    console.error('GET /api/venue/feature-flags failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/venue/feature-flags — admin-only per-venue overrides. */
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { data: currentRow, error: loadErr } = await staff.db
      .from('venues')
      .select('feature_flags')
      .eq('id', staff.venue_id)
      .single();

    if (loadErr || !currentRow) {
      console.error('PATCH /api/venue/feature-flags load failed:', loadErr?.message);
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    }

    const current = parseVenueFeatureFlags((currentRow as { feature_flags?: unknown }).feature_flags);
    const merged = mergeVenueFeatureFlagsPatch(current, parsed.data);
    const stored = venueFeatureFlagsForStorage(merged);

    const { error: updateErr } = await staff.db
      .from('venues')
      .update({ feature_flags: stored })
      .eq('id', staff.venue_id);

    if (updateErr) {
      console.error('PATCH /api/venue/feature-flags update failed:', updateErr.message);
      return NextResponse.json({ error: 'Failed to update feature flags' }, { status: 500 });
    }

    const admin = getSupabaseAdminClient();
    const calendarOrder = await listVenueCalendarSortOrder(admin, staff.venue_id);
    const calendars = await loadVenueCalendarsForSettings(admin, staff.venue_id, calendarOrder);
    return NextResponse.json({
      raw: merged,
      resolved: resolveAppointmentsFeatureFlags(merged),
      any_available_practitioner_config: parseAnyAvailablePractitionerConfig(merged),
      calendars,
    });
  } catch (err) {
    console.error('PATCH /api/venue/feature-flags failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
