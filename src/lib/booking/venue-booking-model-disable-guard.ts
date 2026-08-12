import type { BookingModel } from '@/types/booking-models';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatYmdInTimezone, venueLocalDateTimeToUtcMs } from '@/lib/venue/venue-local-clock';

const TERMINAL_STATUSES = new Set(['Cancelled', 'Completed', 'No-Show']);

/** DB enum values that map to the same canonical model as `unified_scheduling`. */
function dbValuesForCanonicalModel(model: BookingModel): string[] {
  if (model === 'unified_scheduling') {
    return ['unified_scheduling', 'practitioner_appointment'];
  }
  return [model];
}

function rowBookingModelToCanonical(raw: string): BookingModel | null {
  if (raw === 'practitioner_appointment') return 'unified_scheduling';
  const allowed: BookingModel[] = [
    'table_reservation',
    'unified_scheduling',
    'event_ticket',
    'class_session',
    'resource_booking',
  ];
  return (allowed as string[]).includes(raw) ? (raw as BookingModel) : null;
}

const MODEL_LABEL: Partial<Record<BookingModel, string>> = {
  table_reservation: 'Table reservations',
  unified_scheduling: 'Appointments',
  event_ticket: 'Ticketed events',
  class_session: 'Classes',
  resource_booking: 'Resource bookings',
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Fri 14 Aug 2026" from a `YYYY-MM-DD`, read at midday so no timezone can shift the day.
 *
 * Built by hand rather than through `toLocaleDateString`, whose separators vary with the
 * runtime's ICU data. This string is copy a venue owner reads, so it should not depend on
 * which Node the server happens to be running.
 */
function formatBookingDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  const at = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return `${WEEKDAY_SHORT[at.getUTCDay()]} ${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

/** "9:00am" / "2:30pm" from a `HH:mm` clock time. */
function formatBookingTime(timeHm: string): string {
  const [h, min] = timeHm.split(':').map(Number);
  if (h === undefined || Number.isNaN(h)) return timeHm;
  const suffix = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(min ?? 0).padStart(2, '0')}${suffix}`;
}

/**
 * If the venue is removing one or more active booking models, ensure there are no
 * upcoming (venue-local) bookings in a non-terminal status for any removed model.
 *
 * The refusal carries the count and the date of the next one. "You have upcoming
 * bookings" on its own sends staff hunting through the calendar for something the
 * server has already found.
 */
export async function assertCanDisableBookingModels(
  db: SupabaseClient,
  venueId: string,
  venueTimezone: string | null | undefined,
  removedModels: BookingModel[],
): Promise<void> {
  if (removedModels.length === 0) return;

  const tz = (typeof venueTimezone === 'string' && venueTimezone.trim() !== ''
    ? venueTimezone
    : 'Europe/London') as string;
  const nowMs = Date.now();
  const todayYmd = formatYmdInTimezone(nowMs, tz);

  const dbValues = [...new Set(removedModels.flatMap(dbValuesForCanonicalModel))];

  const { data: rows, error } = await db
    .from('bookings')
    .select('booking_date, booking_time, booking_model, status')
    .eq('venue_id', venueId)
    .in('booking_model', dbValues)
    .gte('booking_date', todayYmd);

  if (error) {
    throw new Error(error.message);
  }

  /**
   * Every match is tallied before anything is reported. Reporting the first row the
   * query happened to return could not name the NEXT booking, only an arbitrary one.
   */
  const upcomingByModel = new Map<BookingModel, { count: number; nextMs: number; date: string; time: string }>();

  for (const row of rows ?? []) {
    const st = typeof row.status === 'string' ? row.status : '';
    if (TERMINAL_STATUSES.has(st)) continue;

    const dateStr = row.booking_date as string;
    const timeRaw = row.booking_time as string;
    const timeHm = timeRaw.length >= 5 ? timeRaw.slice(0, 5) : timeRaw;
    const startMs = venueLocalDateTimeToUtcMs(dateStr, timeHm, tz);
    if (startMs < nowMs) continue;

    const canonical = rowBookingModelToCanonical(String(row.booking_model));
    if (!canonical || !removedModels.includes(canonical)) continue;

    const seen = upcomingByModel.get(canonical);
    if (!seen) {
      upcomingByModel.set(canonical, { count: 1, nextMs: startMs, date: dateStr, time: timeHm });
    } else {
      seen.count += 1;
      if (startMs < seen.nextMs) {
        seen.nextMs = startMs;
        seen.date = dateStr;
        seen.time = timeHm;
      }
    }
  }

  /** Iterate the caller's order, not the map's, so the same removal always names the same model. */
  for (const model of removedModels) {
    const hit = upcomingByModel.get(model);
    if (!hit) continue;

    const label = MODEL_LABEL[model] ?? model.replace(/_/g, ' ');
    const when = `${formatBookingDay(hit.date)} at ${formatBookingTime(hit.time)}`;
    const message =
      hit.count === 1
        ? `${label} cannot be turned off yet. You have 1 upcoming booking of that type, on ${when}. ` +
          'Cancel or complete it first, then try again.'
        : `${label} cannot be turned off yet. You have ${hit.count} upcoming bookings of that type, ` +
          `the next on ${when}. Cancel or complete them first, then try again.`;

    const err = new Error(message) as Error & {
      code?: string;
      model?: BookingModel;
      upcomingCount?: number;
      nextBookingDate?: string;
    };
    err.code = 'BOOKING_MODEL_HAS_FUTURE_BOOKINGS';
    err.model = model;
    err.upcomingCount = hit.count;
    err.nextBookingDate = hit.date;
    throw err;
  }
}
