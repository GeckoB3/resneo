/**
 * Which calendar the availability screen should have selected after a data reload.
 *
 * Extracted from `AppointmentAvailabilitySettings` because it is where a real bug lived,
 * and an inline `setState` callback inside a fetch handler is not somewhere a bug can be
 * pinned.
 *
 * THE BUG (decision (K), step 5, caught on staging 2026-08-19). This runs again after every
 * save. While the candidate pool excluded resource calendars, a selected RESOURCE failed the
 * "is the previous selection still valid" test and the selection fell back to the first
 * staff calendar. Nothing in the UI announced it. The next edit therefore landed on that
 * staff calendar instead, so saving what appeared to be Room 1's Friday hours silently
 * rewrote Andrew's. It was caught by reading the PATCH body, not by looking at the screen,
 * which stayed entirely plausible throughout.
 *
 * The rule is two-part and the halves are easy to conflate:
 *   - KEEPING a selection considers every calendar, resources included;
 *   - choosing a FRESH one still prefers a staff calendar, which is what someone opening
 *     this screen expects to land on.
 */

export interface SelectableCalendar {
  id: string;
  calendar_type?: string | null;
  /** Staff ids linked to this calendar, used to prefer the viewer's own. */
  staffIds?: readonly string[];
}

function isResource(calendar: SelectableCalendar): boolean {
  return (calendar.calendar_type ?? 'practitioner') === 'resource';
}

export function pickScheduleCalendarId(params: {
  previous: string | null | undefined;
  calendars: readonly SelectableCalendar[];
  currentStaffId?: string | null;
}): string {
  const { previous, calendars, currentStaffId } = params;

  // Any calendar may be kept, including a resource.
  if (previous && calendars.some((c) => c.id === previous)) return previous;

  const staffPool = calendars.filter((c) => !isResource(c));
  const own = currentStaffId
    ? staffPool.find((c) => (c.staffIds ?? []).includes(currentStaffId))
    : undefined;

  return own?.id ?? staffPool[0]?.id ?? calendars[0]?.id ?? '';
}
