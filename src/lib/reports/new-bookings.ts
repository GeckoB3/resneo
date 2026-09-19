import type { SupabaseClient } from '@supabase/supabase-js';
import { formatYmdInTimezone, venueLocalWallTimeToUtcMs } from '@/lib/venue/venue-local-clock';
import {
  addDaysYmd,
  clampYmd,
  parseYmd,
  periodEndFor,
  periodStartFor,
  periodStartsBetween,
  type ReportGrain,
} from '@/lib/reports/report-periods';
import { selectAllPages } from '@/lib/reports/select-all-pages';

/**
 * New bookings: how many bookings were MADE in a period. Each is counted on the
 * venue-local day it was made (`bookings.created_at`), whatever date the
 * appointment itself is for. Serves Settings → Reports → New bookings, the
 * New bookings card on the dashboard home (the app's Today screen reads the
 * same payload), and the Reports Overview's Appointment activity and
 * Cancellation rate cards (`overview-bookings.ts`), so "Appointments created"
 * there is this same count.
 *
 * What counts as one booking:
 *  - A multi-service visit counts once, however many services it has and
 *    whichever days they fall on (R36: a visit is one booking). A service added
 *    to a visit later is not a new booking; the visit counts on the day its
 *    first service was made.
 *  - A standing (recurring) class reservation counts once, on the day its first
 *    session was made. The sessions the nightly job adds after that are the same
 *    reservation continuing, not new bookings.
 *  - Everything else counts per row, as the lists draw it: a single
 *    appointment, each person in a party, each class in a cart, a table, an
 *    event booking, a resource.
 *
 * Left out entirely:
 *  - Imported bookings (`source = 'import'`): history brought in, not taken here.
 *  - The copy a collective move makes at the receiving venue (its
 *    `booking_moved_in` event): the booking was taken once, where it was made.
 *  - Bookings the system cancelled because a deposit or card never arrived.
 *    Only the payment sweeps and payment-failure paths write
 *    `cancellation_actor_type = 'system'`, so the client never finished booking.
 *    These come back as `lapsed` units, counted nowhere here, so the Overview
 *    can report them beside its cancellation rate.
 *
 * Beside the total, not in it: `awaiting_payment`, bookings still Pending on a
 * deposit or a card. One joins the total once paid (or accepted unpaid), or
 * drops out if the system cancels it.
 * Inside the total: `cancelled`, bookings taken and since cancelled by the
 * client or the team.
 */

/** How the booking came in. */
export type NewBookingChannel = 'online' | 'team' | 'walk_in' | 'linked_venue';

export const NEW_BOOKING_CHANNELS: readonly NewBookingChannel[] = ['online', 'team', 'walk_in', 'linked_venue'];

/** What the Home card, the Reports tab and its CSV call each channel. */
export const NEW_BOOKING_CHANNEL_LABELS: Record<NewBookingChannel, string> = {
  online: 'Online',
  team: 'By your team',
  walk_in: 'Walk-ins',
  linked_venue: 'By a linked venue',
};

export interface NewBookingCounts {
  /** Bookings made in the period, including any since cancelled. */
  total: number;
  /** `total` split by how each booking came in. */
  by_channel: Record<NewBookingChannel, number>;
  /** Of `total`, the bookings since cancelled by the client or the team. */
  cancelled: number;
  /** Made in the period and still waiting for a deposit or a card. Not in `total`. */
  awaiting_payment: number;
}

export interface NewBookingsPeriod extends NewBookingCounts {
  /** First date of the period, YYYY-MM-DD (clamped to the requested range). */
  period_start: string;
  /** Last date of the period, YYYY-MM-DD (clamped to the requested range). */
  period_end: string;
}

export interface NewBookingsReport {
  from: string;
  to: string;
  grain: ReportGrain;
  /** Today in the venue's timezone. */
  today: string;
  periods: NewBookingsPeriod[];
  totals: NewBookingCounts;
}

/** The dashboard home card: bookings made today, this week (from Monday) and this month. */
export interface NewBookingsSummary {
  today: NewBookingCounts;
  this_week: NewBookingCounts;
  this_month: NewBookingCounts;
  /** Monday of this week, venue-local. */
  week_start: string;
  /** The 1st of this month, venue-local. */
  month_start: string;
}

/** The columns read from `bookings`. */
export interface NewBookingRow {
  id: string;
  created_at: string;
  status: string | null;
  source: string | null;
  cancellation_actor_type?: string | null;
  created_by_staff_id?: string | null;
  created_by_linked_venue_id?: string | null;
  group_booking_id?: string | null;
  person_label?: string | null;
  class_instance_id?: string | null;
  class_recurring_reservation_id?: string | null;
  party_size?: number | null;
  client_arrived_at?: string | null;
}

/** One booking as counted: a lone row, a whole visit, or a whole standing reservation. */
export interface NewBookingUnit {
  key: string;
  /** Venue-local date the booking was made (its first row). */
  day: string;
  channel: NewBookingChannel;
  /**
   * `active` and `cancelled` are in the total; `pending` is awaiting payment;
   * `lapsed` the system cancelled for non-payment, and is in no count here.
   */
  state: 'active' | 'cancelled' | 'pending' | 'lapsed';
  /** The booking's rows made in the window. `rows[0]` is the first, which dates and channels it. */
  rows: readonly NewBookingRow[];
}

const NEW_BOOKING_SELECT =
  'id, created_at, status, source, cancellation_actor_type, created_by_staff_id, created_by_linked_venue_id, group_booking_id, person_label, class_instance_id, class_recurring_reservation_id, party_size, client_arrived_at';

/** Ids per `.in()` filter, so the request URL stays well inside PostgREST's limits. */
const IN_CHUNK = 100;

export function emptyNewBookingCounts(): NewBookingCounts {
  return {
    total: 0,
    by_channel: { online: 0, team: 0, walk_in: 0, linked_venue: 0 },
    cancelled: 0,
    awaiting_payment: 0,
  };
}

/** The unit a row belongs to. A visit or standing reservation shares one key across its rows. */
export function newBookingUnitKey(row: NewBookingRow): string {
  const recurring = row.class_recurring_reservation_id?.trim();
  if (recurring) return `recurring:${recurring}`;
  const group = row.group_booking_id?.trim();
  if (group && !row.person_label?.trim() && !row.class_instance_id) return `visit:${group}`;
  return `row:${row.id}`;
}

/**
 * How a booking came in. `phone` is what the staff booking form writes for
 * every booking the team adds that is not a walk-in, whether it came by phone,
 * in person or by message, so it reads as "by your team".
 */
export function newBookingChannel(row: NewBookingRow): NewBookingChannel {
  if (row.created_by_linked_venue_id) return 'linked_venue';
  switch (row.source) {
    case 'walk-in':
      return 'walk_in';
    case 'phone':
      return 'team';
    case 'online':
    case 'widget':
    case 'booking_page':
      return 'online';
    default:
      return row.created_by_staff_id ? 'team' : 'online';
  }
}

type RowState = NewBookingUnit['state'];

function rowState(row: NewBookingRow): RowState {
  if (row.status === 'Pending') return 'pending';
  if (row.status === 'Cancelled') return row.cancellation_actor_type === 'system' ? 'lapsed' : 'cancelled';
  return 'active';
}

/** A unit is on the books while any of its rows is; cancelled only when every row is. */
function unitState(rows: NewBookingRow[]): RowState {
  const states = new Set(rows.map(rowState));
  if (states.has('active')) return 'active';
  if (states.has('pending')) return 'pending';
  if (states.has('cancelled')) return 'cancelled';
  return 'lapsed';
}

/**
 * Rows made in a window, grouped into bookings and dated. Pure, so the counting
 * rules are unit tested without a database.
 *
 * `startedEarlier` holds the keys of visits and standing reservations that
 * already had a row before the window: their rows inside it are additions to a
 * booking taken earlier. `movedInIds` holds the ids of rows a collective move
 * created here.
 */
export function classifyNewBookings(
  rows: readonly NewBookingRow[],
  opts: { timeZone: string; startedEarlier?: ReadonlySet<string>; movedInIds?: ReadonlySet<string> },
): NewBookingUnit[] {
  const byKey = new Map<string, NewBookingRow[]>();
  for (const row of rows) {
    if (row.source === 'import') continue;
    if (opts.movedInIds?.has(row.id)) continue;
    const key = newBookingUnitKey(row);
    if (opts.startedEarlier?.has(key)) continue;
    const list = byKey.get(key);
    if (list) list.push(row);
    else byKey.set(key, [row]);
  }

  const units: NewBookingUnit[] = [];
  for (const [key, list] of byKey) {
    const state = unitState(list);
    let first = list[0]!;
    let firstMs = Date.parse(first.created_at);
    for (const row of list) {
      const ms = Date.parse(row.created_at);
      if (ms < firstMs) {
        first = row;
        firstMs = ms;
      }
    }
    if (!Number.isFinite(firstMs)) continue;
    units.push({
      key,
      day: formatYmdInTimezone(firstMs, opts.timeZone),
      channel: newBookingChannel(first),
      state,
      rows: [first, ...list.filter((row) => row !== first)],
    });
  }
  return units;
}

function addUnit(counts: NewBookingCounts, unit: NewBookingUnit): void {
  if (unit.state === 'lapsed') return;
  if (unit.state === 'pending') {
    counts.awaiting_payment += 1;
    return;
  }
  counts.total += 1;
  counts.by_channel[unit.channel] += 1;
  if (unit.state === 'cancelled') counts.cancelled += 1;
}

/** Counts for the units made between `from` and `to` inclusive. */
export function countNewBookings(units: readonly NewBookingUnit[], from: string, to: string): NewBookingCounts {
  const counts = emptyNewBookingCounts();
  for (const unit of units) {
    if (unit.day >= from && unit.day <= to) addUnit(counts, unit);
  }
  return counts;
}

/** Per-period rows and totals. Quiet periods appear as zero rows. */
export function aggregateNewBookings(input: {
  units: readonly NewBookingUnit[];
  from: string;
  to: string;
  grain: ReportGrain;
  today: string;
}): NewBookingsReport {
  const { units, from, to, grain, today } = input;
  const periods = new Map<string, NewBookingsPeriod>();
  for (const start of periodStartsBetween(from, to, grain)) {
    periods.set(start, {
      period_start: clampYmd(start, from, to),
      period_end: clampYmd(periodEndFor(start, grain), from, to),
      ...emptyNewBookingCounts(),
    });
  }
  const totals = emptyNewBookingCounts();
  for (const unit of units) {
    if (unit.day < from || unit.day > to) continue;
    const period = periods.get(periodStartFor(unit.day, grain));
    if (period) addUnit(period, unit);
    addUnit(totals, unit);
  }
  return { from, to, grain, today, periods: [...periods.values()], totals };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The UTC instants bounding venue-local days `from` to `to` inclusive, as ISO strings. */
export function localDayWindowUtc(from: string, to: string, timeZone: string): { startIso: string; endIso: string } {
  return {
    startIso: new Date(venueLocalWallTimeToUtcMs(from, '00:00', timeZone)).toISOString(),
    endIso: new Date(venueLocalWallTimeToUtcMs(addDaysYmd(to, 1), '00:00', timeZone)).toISOString(),
  };
}

/**
 * Loads the bookings made at `venueId` on venue-local days `from` to `to`, and
 * the two lookups the counting rules need, then classifies them.
 * `db` must be able to read the venue's bookings and events (the service-role
 * client, scoped here by `venueId`).
 */
export async function loadNewBookingUnits(
  db: SupabaseClient,
  params: { venueId: string; timeZone: string; from: string; to: string },
): Promise<NewBookingUnit[]> {
  const { venueId, timeZone, from, to } = params;
  const { startIso, endIso } = localDayWindowUtc(from, to, timeZone);

  const [rows, movedIn] = await Promise.all([
    selectAllPages<NewBookingRow>((a, b) =>
      db
        .from('bookings')
        .select(NEW_BOOKING_SELECT)
        .eq('venue_id', venueId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    ),
    selectAllPages<{ booking_id: string | null }>((a, b) =>
      db
        .from('events')
        .select('booking_id')
        .eq('venue_id', venueId)
        .eq('event_type', 'booking_moved_in')
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .order('created_at', { ascending: true })
        .range(a, b),
    ),
  ]);

  const visitIds = new Set<string>();
  const recurringIds = new Set<string>();
  for (const row of rows) {
    const key = newBookingUnitKey(row);
    if (key.startsWith('visit:')) visitIds.add(key.slice('visit:'.length));
    else if (key.startsWith('recurring:')) recurringIds.add(key.slice('recurring:'.length));
  }

  const startedEarlier = new Set<string>();
  const earlierLookups: Array<Promise<void>> = [];
  for (const ids of chunk([...visitIds], IN_CHUNK)) {
    earlierLookups.push(
      selectAllPages<{ group_booking_id: string | null }>((a, b) =>
        db
          .from('bookings')
          .select('group_booking_id')
          .eq('venue_id', venueId)
          .in('group_booking_id', ids)
          .lt('created_at', startIso)
          .order('id', { ascending: true })
          .range(a, b),
      ).then((earlier) => {
        for (const r of earlier) if (r.group_booking_id) startedEarlier.add(`visit:${r.group_booking_id.trim()}`);
      }),
    );
  }
  for (const ids of chunk([...recurringIds], IN_CHUNK)) {
    earlierLookups.push(
      selectAllPages<{ class_recurring_reservation_id: string | null }>((a, b) =>
        db
          .from('bookings')
          .select('class_recurring_reservation_id')
          .eq('venue_id', venueId)
          .in('class_recurring_reservation_id', ids)
          .lt('created_at', startIso)
          .order('id', { ascending: true })
          .range(a, b),
      ).then((earlier) => {
        for (const r of earlier) {
          if (r.class_recurring_reservation_id) {
            startedEarlier.add(`recurring:${r.class_recurring_reservation_id.trim()}`);
          }
        }
      }),
    );
  }
  await Promise.all(earlierLookups);

  const movedInIds = new Set(movedIn.map((e) => e.booking_id).filter((id): id is string => Boolean(id)));
  return classifyNewBookings(rows, { timeZone, startedEarlier, movedInIds });
}

export async function buildNewBookingsReport(
  db: SupabaseClient,
  params: { venueId: string; timeZone: string; from: string; to: string; grain: ReportGrain; today: string },
): Promise<NewBookingsReport> {
  const units = await loadNewBookingUnits(db, params);
  return aggregateNewBookings({ units, from: params.from, to: params.to, grain: params.grain, today: params.today });
}

/** Today, this week (from Monday) and this month, in one load. */
export async function buildNewBookingsSummary(
  db: SupabaseClient,
  params: { venueId: string; timeZone: string; today: string },
): Promise<NewBookingsSummary> {
  const { today } = params;
  const weekStart = periodStartFor(today, 'week');
  const monthStart = periodStartFor(today, 'month');
  const units = await loadNewBookingUnits(db, {
    venueId: params.venueId,
    timeZone: params.timeZone,
    from: weekStart < monthStart ? weekStart : monthStart,
    to: today,
  });
  return {
    today: countNewBookings(units, today, today),
    this_week: countNewBookings(units, weekStart, today),
    this_month: countNewBookings(units, monthStart, today),
    week_start: weekStart,
    month_start: monthStart,
  };
}

export const NEW_BOOKINGS_PRESETS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
] as const;
export type NewBookingsPreset = (typeof NEW_BOOKINGS_PRESETS)[number];

/**
 * A preset's dates from the venue's own "today". Bookings cannot be made in
 * the future, so the current week and month run to today rather than to their
 * last day.
 */
export function resolveNewBookingsPreset(preset: NewBookingsPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDaysYmd(today, -1);
      return { from: day, to: day };
    }
    case 'this_week':
      return { from: periodStartFor(today, 'week'), to: today };
    case 'last_week': {
      const from = addDaysYmd(periodStartFor(today, 'week'), -7);
      return { from, to: periodEndFor(from, 'week') };
    }
    case 'this_month':
      return { from: periodStartFor(today, 'month'), to: today };
    case 'last_month': {
      const from = periodStartFor(addDaysYmd(periodStartFor(today, 'month'), -1), 'month');
      return { from, to: periodEndFor(from, 'month') };
    }
  }
}

/** Whole days from `from` to `to`, for the route's range cap. */
export function daysSpanned(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000) + 1;
}
