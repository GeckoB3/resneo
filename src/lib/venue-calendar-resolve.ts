import type { SupabaseClient } from '@supabase/supabase-js';

/** Active host calendar column ids (`unified_calendars`, excluding resource rows). */
export async function listActiveHostCalendarIds(
  admin: SupabaseClient,
  venueId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('venue_id', venueId)
    .eq('is_active', true)
    .neq('calendar_type', 'resource');

  if (error) {
    console.error('[listActiveHostCalendarIds] failed:', error.message, { venueId });
    return [];
  }
  return (data ?? []).map((r) => (r as { id: string }).id);
}

/** Returns calendar id when it is an active host column for the venue. */
export async function requireVenueHostCalendarId(
  admin: SupabaseClient,
  venueId: string,
  calendarId: string,
): Promise<{ ok: true; id: string } | { ok: false }> {
  const { data, error } = await admin
    .from('unified_calendars')
    .select('id')
    .eq('id', calendarId)
    .eq('venue_id', venueId)
    .neq('calendar_type', 'resource')
    .maybeSingle();

  if (error) {
    console.error('[requireVenueHostCalendarId] failed:', error.message, { venueId, calendarId });
    return { ok: false };
  }
  if (!data) return { ok: false };
  return { ok: true, id: (data as { id: string }).id };
}
