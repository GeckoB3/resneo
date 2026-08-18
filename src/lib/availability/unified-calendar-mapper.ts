import type { Practitioner, WorkingHours } from '@/types/booking-models';

/** Map a `unified_calendars` row to the `Practitioner` shape used by the appointment engine. */
export function unifiedCalendarRowToPractitioner(uc: Record<string, unknown>): Practitioner {
  const breakRaw = uc.break_times;
  const breakTimes = Array.isArray(breakRaw) ? breakRaw : [];
  const daysOffRaw = uc.days_off;
  const daysOff = Array.isArray(daysOffRaw) ? (daysOffRaw as string[]) : [];
  const byDayRaw = uc.break_times_by_day;
  const breakTimesByDay =
    byDayRaw != null &&
    typeof byDayRaw === 'object' &&
    !Array.isArray(byDayRaw) &&
    Object.keys(byDayRaw as object).length > 0
      ? (byDayRaw as Practitioner['break_times_by_day'])
      : null;
  return {
    id: uc.id as string,
    venue_id: uc.venue_id as string,
    staff_id: (uc.staff_id as string | null | undefined) ?? null,
    name: uc.name as string,
    email: null,
    phone: null,
    working_hours: (uc.working_hours as WorkingHours) ?? {},
    break_times: breakTimes as Practitioner['break_times'],
    break_times_by_day: breakTimesByDay,
    days_off: daysOff,
    is_active: uc.is_active !== false,
    sort_order: (uc.sort_order as number) ?? 0,
    created_at: (uc.created_at as string) ?? new Date().toISOString(),
    slug: (uc.slug as string) ?? null,
    parallel_clients:
      typeof uc.parallel_clients === 'number' && uc.parallel_clients >= 1
        ? Math.min(50, Math.floor(uc.parallel_clients))
        : 1,
    /**
     * Per-date Hours and Closed overrides. This mapper dropped the column, so a resource's
     * own per-date override was honoured on the `/book` resource path (which maps the row
     * itself) and silently ignored on the unified path (which routes resource calendars
     * through the appointment engine via this mapper). Same stored setting, two answers.
     * §1.2 item 21.
     */
    availability_exceptions: (uc.availability_exceptions ?? null) as Practitioner['availability_exceptions'],
  };
}
