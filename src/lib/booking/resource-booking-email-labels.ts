import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resource name plus host calendar column name (`display_on_calendar_id` → `unified_calendars.name`).
 * The host name is shown as "With …" in appointment-style emails; it must not be the booking end time.
 */
export async function getResourceBookingEmailLabels(
  supabase: Pick<SupabaseClient, 'from'>,
  resourceId: string,
): Promise<{ resourceName: string | null; hostCalendarName: string | null }> {
  const { data: vr } = await supabase
    .from('unified_calendars')
    .select('name, display_on_calendar_id')
    .eq('id', resourceId)
    .maybeSingle();

  const resourceName =
    typeof vr?.name === 'string' && vr.name.trim() !== '' ? vr.name.trim() : null;
  const hostId =
    typeof vr?.display_on_calendar_id === 'string' && vr.display_on_calendar_id.trim() !== ''
      ? vr.display_on_calendar_id.trim()
      : null;

  if (!hostId) {
    return { resourceName, hostCalendarName: null };
  }

  const { data: cal } = await supabase
    .from('unified_calendars')
    .select('name')
    .eq('id', hostId)
    .maybeSingle();

  const hostCalendarName =
    typeof cal?.name === 'string' && cal.name.trim() !== '' ? cal.name.trim() : null;

  return { resourceName, hostCalendarName };
}
