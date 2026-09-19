import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPages } from '@/lib/reports/select-all-pages';

/**
 * No-show rate by appointment date. Serves the Reports Overview's No-show rate
 * card (`report2_no_show_series` on `GET /api/venue/reports`) and the no-show
 * figure on the Appointment performance card (`computeVenueBaselineMetrics`),
 * so the two agree for the same dates.
 *
 *  - Counted on the day the appointment is for, from the booking's current status.
 *  - A booking is due once it has an outcome: the client arrived, started or
 *    finished (`Seated`, `Completed`), or it was marked `No-Show`. Anything
 *    still booked, or cancelled, is not in the rate.
 *  - A multi-service visit counts once per day (R36): the client came that day
 *    or did not. It is a no-show only when no service that day was attended.
 *    Each person in a party and each class in a cart counts on its own.
 *  - Walk-ins are left out: nobody can fail to turn up for one.
 *
 * Until 2026-09-19 the card read report_no_show_series, which grouped bookings
 * by the UTC day they were MADE and took each status from the latest event.
 * The dashboard writes its own status audit event (`{ from, to }`) after the
 * trigger's, so every no-show the team marked read as the booking's first status.
 */

export interface NoShowSeriesRow {
  /** Appointment date, YYYY-MM-DD. */
  period_start: string;
  no_show_count: number;
  /** Bookings due that day: attended or no-show. */
  confirmed_at_time_count: number;
  /** `no_show_count` over `confirmed_at_time_count`, to 2 dp. */
  rate_pct: number;
}

/** The columns read from `bookings`. */
export interface NoShowRow {
  id: string;
  status: string | null;
  source: string | null;
  booking_date: string | null;
  group_booking_id?: string | null;
  person_label?: string | null;
  class_instance_id?: string | null;
}

const OUTCOME_STATUSES = ['Seated', 'Completed', 'No-Show'] as const;

const NO_SHOW_SELECT = 'id, status, source, booking_date, group_booking_id, person_label, class_instance_id';

/** One booking's outcome on one day: a visit's services that day share a key. */
function outcomeKey(row: NoShowRow): string {
  const group = row.group_booking_id?.trim();
  if (group && !row.person_label?.trim() && !row.class_instance_id) return `visit:${group}:${row.booking_date}`;
  return `row:${row.id}`;
}

/** Every booking with an outcome, dated by appointment. Pure, so the rules are unit tested. */
export function noShowOutcomes(rows: readonly NoShowRow[]): Array<{ day: string; noShow: boolean }> {
  const byKey = new Map<string, { day: string; attended: boolean; noShow: boolean }>();
  for (const row of rows) {
    if (row.source === 'walk-in' || !row.booking_date) continue;
    const attended = row.status === 'Seated' || row.status === 'Completed';
    const noShow = row.status === 'No-Show';
    if (!attended && !noShow) continue;
    const key = outcomeKey(row);
    const outcome = byKey.get(key) ?? { day: row.booking_date, attended: false, noShow: false };
    outcome.attended ||= attended;
    outcome.noShow ||= noShow;
    byKey.set(key, outcome);
  }
  return [...byKey.values()].map((o) => ({ day: o.day, noShow: !o.attended }));
}

/** Totals for a set of rows, as the Appointment performance card reports them. */
export function countNoShowOutcomes(rows: readonly NoShowRow[]): { no_show_count: number; eligible_count: number } {
  const outcomes = noShowOutcomes(rows);
  return { no_show_count: outcomes.filter((o) => o.noShow).length, eligible_count: outcomes.length };
}

/** One row per appointment date that had an outcome, oldest first. */
export function noShowSeriesByDay(rows: readonly NoShowRow[]): NoShowSeriesRow[] {
  const byDay = new Map<string, { noShows: number; due: number }>();
  for (const { day, noShow } of noShowOutcomes(rows)) {
    const cur = byDay.get(day) ?? { noShows: 0, due: 0 };
    cur.due += 1;
    if (noShow) cur.noShows += 1;
    byDay.set(day, cur);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, { noShows, due }]) => ({
      period_start: day,
      no_show_count: noShows,
      confirmed_at_time_count: due,
      rate_pct: Math.round((10_000 * noShows) / due) / 100,
    }));
}

/**
 * The venue's appointments from `from` to `to` (inclusive, YYYY-MM-DD) that
 * have an outcome, as a daily series. Only rows with an outcome status are read:
 * the others cannot change a day's figures.
 */
export async function loadNoShowSeries(
  db: SupabaseClient,
  params: { venueId: string; from: string; to: string },
): Promise<NoShowSeriesRow[]> {
  const rows = await selectAllPages<NoShowRow>((a, b) =>
    db
      .from('bookings')
      .select(NO_SHOW_SELECT)
      .eq('venue_id', params.venueId)
      .gte('booking_date', params.from)
      .lte('booking_date', params.to)
      .in('status', [...OUTCOME_STATUSES])
      .order('booking_date', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  );
  return noShowSeriesByDay(rows);
}
