import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Turning off a staff permission box clears the values calendars stored under it (D6, D56).
 *
 * Since D56 a calendar's stored value applies only while its flag is on, so an unticked box
 * already stops a stored price charging. Clearing it as well is what stops an old price coming back
 * unnoticed the next time an admin ticks the box (TERMS-02: turning the flag back on must not
 * resurrect a cleared price or deposit).
 *
 * D6 names price, deposit, length and buffer. A calendar's own name, description and colour are
 * kept: they are cosmetic, and they stop showing while the box is off anyway.
 */
export const CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF = [
  { flag: 'staff_may_customize_price', column: 'custom_price_pence', label: 'price' },
  { flag: 'staff_may_customize_deposit', column: 'custom_deposit_pence', label: 'deposit' },
  { flag: 'staff_may_customize_duration', column: 'custom_duration_minutes', label: 'length' },
  { flag: 'staff_may_customize_buffer', column: 'custom_buffer_minutes', label: 'buffer' },
] as const;

export type ClearedCalendarValueLabel = (typeof CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF)[number]['label'];

/** The fields whose box was on before the save and is off after it. */
export function calendarValueFieldsTurnedOff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<(typeof CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF)[number]> {
  return CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF.filter((f) => before[f.flag] === true && after[f.flag] !== true);
}

export interface ClearedCalendarValues {
  calendar_id: string;
  fields: ClearedCalendarValueLabel[];
}

/**
 * Clear the stored values for the boxes this save turned off, on every calendar of the service.
 * Returns what was cleared, per calendar, for the save response. Best effort per field: a failure
 * is logged and the rest still clears, because the values are already inert under D56.
 */
export async function clearCalendarValuesForFlagsTurnedOff(
  admin: SupabaseClient,
  params: { serviceItemId: string; before: Record<string, unknown>; after: Record<string, unknown> },
): Promise<ClearedCalendarValues[]> {
  const turnedOff = calendarValueFieldsTurnedOff(params.before, params.after);
  if (turnedOff.length === 0) return [];

  const byCalendar = new Map<string, Set<ClearedCalendarValueLabel>>();
  for (const field of turnedOff) {
    const { data, error } = await admin
      .from('calendar_service_assignments')
      .update({ [field.column]: null })
      .eq('service_item_id', params.serviceItemId)
      .not(field.column, 'is', null)
      .select('calendar_id');
    if (error) {
      console.error('[calendar-values-flag-off] clearing failed:', field.column, error.message, {
        serviceItemId: params.serviceItemId,
      });
      continue;
    }
    for (const row of (data ?? []) as Array<{ calendar_id: string }>) {
      const set = byCalendar.get(row.calendar_id) ?? new Set<ClearedCalendarValueLabel>();
      set.add(field.label);
      byCalendar.set(row.calendar_id, set);
    }
  }
  return [...byCalendar.entries()].map(([calendar_id, fields]) => ({ calendar_id, fields: [...fields] }));
}

/** Service flags as the Services form and GET payload name them. */
type FlagRecord = Partial<Record<(typeof CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF)[number]['flag'], boolean | null | undefined>>;

/** A calendar's stored values, as `GET /api/venue/appointment-services` returns them. */
interface LinkValues {
  practitioner_id: string;
  custom_price_pence?: number | null;
  custom_deposit_pence?: number | null;
  custom_duration_minutes?: number | null;
  custom_buffer_minutes?: number | null;
}

/**
 * What a save would clear, for the confirmation shown before it: each calendar of the service that
 * holds its own value under a box the admin is turning off. Pure, so the Services page can ask
 * before it saves. `links` are that service's calendar rows; values are present in them only while
 * the box is on, which is exactly when turning it off can clear something.
 */
export function calendarValuesClearedByFlagChange(params: {
  before: FlagRecord;
  after: FlagRecord;
  links: LinkValues[];
  calendarName: (calendarId: string) => string;
}): Array<{ calendarId: string; calendarName: string; fields: ClearedCalendarValueLabel[] }> {
  const turnedOff = CALENDAR_VALUES_CLEARED_WHEN_FLAG_OFF.filter(
    (f) => params.before[f.flag] === true && params.after[f.flag] !== true,
  );
  if (turnedOff.length === 0) return [];
  const out: Array<{ calendarId: string; calendarName: string; fields: ClearedCalendarValueLabel[] }> = [];
  for (const link of params.links) {
    const fields = turnedOff
      .filter((f) => {
        const v = (link as unknown as Record<string, unknown>)[f.column];
        return typeof v === 'number' && Number.isFinite(v);
      })
      .map((f) => f.label);
    if (fields.length > 0) {
      out.push({ calendarId: link.practitioner_id, calendarName: params.calendarName(link.practitioner_id), fields });
    }
  }
  return out;
}
