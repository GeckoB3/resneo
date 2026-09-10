import type { SupabaseClient } from '@supabase/supabase-js';
import { loadRowTotalResolver, type VisitBookingRow } from '@/lib/booking/payment-summary';
import { loadAccessibleLinkedVenueIds } from '@/lib/linked-accounts/queries';
import type { LinkGrant } from '@/lib/linked-accounts/types';

/**
 * Booked revenue by period and by calendar (Settings → Reports → Revenue).
 *
 * "Booked" is every appointment on the diary that has not been cancelled,
 * priced the way the booking panel prices it (stored total, else chosen
 * option, else the practitioner's price, else the service's list price, plus
 * add-ons). Each service of a multi-service visit is its own row with its own
 * price and status, so rows are summed directly and a visit is never counted
 * twice.
 *
 * No-shows are reported alongside rather than dropped: the default view is
 * booked revenue minus no-shows, and the caller can add them back. A future
 * date has no no-shows yet, so it reads as everything booked; a past date reads
 * as everything booked less the services marked No-Show.
 *
 * Linked venues: when a partner venue has granted this venue full calendar
 * detail with create/edit/cancel rights (the same grant the shared diary needs
 * to show and change their bookings), the partner's calendars appear as their
 * own columns, limited to the calendars the partner scoped the link to.
 */

export type BookedRevenueGrain = 'day' | 'week' | 'month';

export interface BookedRevenueColumn {
  /** Stable key for `by_calendar`: the calendar id, or `unassigned`. */
  key: string;
  calendar_id: string | null;
  name: string;
  venue_id: string;
  venue_name: string;
  /** True for a calendar belonging to a linked venue. */
  linked: boolean;
  colour: string | null;
}

export interface BookedRevenueCell {
  /** Booked revenue in pence excluding no-shows. */
  booked_pence: number;
  /** Revenue of services marked No-Show in pence. */
  no_show_pence: number;
  /** Rows that contributed to `booked_pence`. */
  booked_count: number;
  no_show_count: number;
  /** Rows (booked or no-show) that carry no price and so add nothing. */
  unpriced_count: number;
}

export interface BookedRevenuePeriod extends BookedRevenueCell {
  /** First date of the period, YYYY-MM-DD (clamped to the requested range). */
  period_start: string;
  /** Last date of the period, YYYY-MM-DD (clamped to the requested range). */
  period_end: string;
  by_calendar: Record<string, BookedRevenueCell>;
}

export interface BookedRevenueReport {
  from: string;
  to: string;
  grain: BookedRevenueGrain;
  /** Today in the venue's timezone, so presets on the client agree with the diary. */
  today: string;
  columns: BookedRevenueColumn[];
  periods: BookedRevenuePeriod[];
  totals: BookedRevenueCell & { by_calendar: Record<string, BookedRevenueCell> };
}

const UNASSIGNED_KEY = 'unassigned';

const BOOKING_SELECT =
  'id, venue_id, calendar_id, booking_date, status, group_booking_id, booking_total_price_pence, addons_total_price_pence, service_variant_id, service_item_id, appointment_service_id, practitioner_id';

type RevenueBookingRow = VisitBookingRow & {
  booking_date: string;
  status: string | null;
};

/** A partner venue whose calendars this report may include. */
export function grantAllowsRevenueReporting(grant: LinkGrant): boolean {
  return grant.calendar === 'full_details' && grant.act === 'create_edit_cancel';
}

function emptyCell(): BookedRevenueCell {
  return { booked_pence: 0, no_show_pence: 0, booked_count: 0, no_show_count: 0, unpriced_count: 0 };
}

function addToCell(cell: BookedRevenueCell, pence: number | null, noShow: boolean): void {
  if (pence == null) {
    cell.unpriced_count += 1;
    if (noShow) cell.no_show_count += 1;
    else cell.booked_count += 1;
    return;
  }
  if (noShow) {
    cell.no_show_pence += pence;
    cell.no_show_count += 1;
  } else {
    cell.booked_pence += pence;
    cell.booked_count += 1;
  }
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(ymd: string, delta: number): string {
  const d = parseYmd(ymd);
  d.setUTCDate(d.getUTCDate() + delta);
  return toYmd(d);
}

/**
 * The start of the period a date falls in. Weeks start on Monday; months on
 * the 1st. Pure date arithmetic on the booking's own date, so the venue's
 * timezone never shifts a booking into a neighbouring day.
 */
export function periodStartFor(ymd: string, grain: BookedRevenueGrain): string {
  if (grain === 'day') return ymd;
  const d = parseYmd(ymd);
  if (grain === 'week') {
    const dow = d.getUTCDay(); // 0 = Sunday
    const back = (dow + 6) % 7;
    d.setUTCDate(d.getUTCDate() - back);
    return toYmd(d);
  }
  d.setUTCDate(1);
  return toYmd(d);
}

function periodEndFor(start: string, grain: BookedRevenueGrain): string {
  if (grain === 'day') return start;
  if (grain === 'week') return addDays(start, 6);
  const d = parseYmd(start);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toYmd(d);
}

/** Every period start between `from` and `to`, so quiet periods still appear as zero rows. */
export function periodStartsBetween(from: string, to: string, grain: BookedRevenueGrain): string[] {
  const out: string[] = [];
  let cursor = periodStartFor(from, grain);
  let guard = 0;
  while (cursor <= to && guard < 4000) {
    out.push(cursor);
    cursor = addDays(periodEndFor(cursor, grain), 1);
    guard += 1;
  }
  return out;
}

export const BOOKED_REVENUE_PRESETS = ['today', 'this_week', 'this_month', 'last_30', 'next_30'] as const;
export type BookedRevenuePreset = (typeof BOOKED_REVENUE_PRESETS)[number];

/**
 * A preset's date range, from the venue's own "today" so that "This week" on
 * the report is the same week the diary is showing.
 */
export function resolvePresetRange(preset: BookedRevenuePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'this_week': {
      const from = periodStartFor(today, 'week');
      return { from, to: addDays(from, 6) };
    }
    case 'this_month': {
      const from = periodStartFor(today, 'month');
      return { from, to: periodEndFor(from, 'month') };
    }
    case 'last_30':
      return { from: addDays(today, -29), to: today };
    case 'next_30':
      return { from: today, to: addDays(today, 29) };
  }
}

function clampYmd(value: string, min: string, max: string): string {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Pure aggregation, separated from the loads so it can be unit tested. */
export function aggregateBookedRevenue(input: {
  from: string;
  to: string;
  grain: BookedRevenueGrain;
  today: string;
  columns: BookedRevenueColumn[];
  /** Priced rows: `pence` null when the booking cannot be priced. */
  rows: Array<{
    booking_date: string;
    status: string | null;
    calendar_id: string | null;
    venue_id: string | null;
    pence: number | null;
  }>;
}): BookedRevenueReport {
  const { from, to, grain, today, columns } = input;
  const columnByCalendar = new Map<string, BookedRevenueColumn>();
  for (const col of columns) if (col.calendar_id) columnByCalendar.set(col.calendar_id, col);
  const hasUnassigned = columns.some((c) => c.key === UNASSIGNED_KEY);
  const ownVenueId = columns.find((c) => !c.linked)?.venue_id ?? null;

  const periods = new Map<string, BookedRevenuePeriod>();
  for (const start of periodStartsBetween(from, to, grain)) {
    periods.set(start, {
      period_start: clampYmd(start, from, to),
      period_end: clampYmd(periodEndFor(start, grain), from, to),
      ...emptyCell(),
      by_calendar: {},
    });
  }
  const totals: BookedRevenueReport['totals'] = { ...emptyCell(), by_calendar: {} };
  for (const col of columns) totals.by_calendar[col.key] = emptyCell();

  for (const row of input.rows) {
    if (row.status === 'Cancelled') continue;
    if (row.booking_date < from || row.booking_date > to) continue;
    let key: string | null = null;
    if (row.calendar_id && columnByCalendar.has(row.calendar_id)) key = row.calendar_id;
    else if (hasUnassigned && row.venue_id === ownVenueId) key = UNASSIGNED_KEY;
    // A partner's booking on a calendar outside the link's scope is not ours to see.
    if (!key) continue;

    const period = periods.get(periodStartFor(row.booking_date, grain));
    if (!period) continue;
    const noShow = row.status === 'No-Show';
    addToCell(period, row.pence, noShow);
    period.by_calendar[key] ??= emptyCell();
    addToCell(period.by_calendar[key]!, row.pence, noShow);
    addToCell(totals, row.pence, noShow);
    addToCell(totals.by_calendar[key]!, row.pence, noShow);
  }

  return { from, to, grain, today, columns, periods: [...periods.values()], totals };
}

async function loadCalendarColumns(
  admin: SupabaseClient,
  venueId: string,
  venueName: string,
  opts: { linked: boolean; scopeIds?: string[] | null },
): Promise<BookedRevenueColumn[]> {
  let q = admin
    .from('unified_calendars')
    .select('id, name, colour, calendar_type, is_active, sort_order')
    .eq('venue_id', venueId)
    .order('sort_order', { ascending: true });
  // §18: a partner may have scoped the link to some of their calendars.
  if (opts.scopeIds && opts.scopeIds.length > 0) q = q.in('id', opts.scopeIds);
  const { data, error } = await q;
  if (error) {
    console.error('[booked-revenue] calendar load failed:', error.message, { venueId });
    return [];
  }
  return (data ?? [])
    .filter((c) => (c.calendar_type as string | null) !== 'resource')
    .map((c) => ({
      key: c.id as string,
      calendar_id: c.id as string,
      name: ((c.name as string | null) ?? 'Calendar') + (c.is_active === false ? ' (inactive)' : ''),
      venue_id: venueId,
      venue_name: venueName,
      linked: opts.linked,
      colour: (c.colour as string | null) ?? null,
    }));
}

async function loadPricedRows(
  admin: SupabaseClient,
  venueId: string,
  from: string,
  to: string,
): Promise<Array<{ booking_date: string; status: string | null; calendar_id: string | null; venue_id: string | null; pence: number | null }>> {
  const { data, error } = await admin
    .from('bookings')
    .select(BOOKING_SELECT)
    .eq('venue_id', venueId)
    .neq('status', 'Cancelled')
    .gte('booking_date', from)
    .lte('booking_date', to);
  if (error) {
    console.error('[booked-revenue] bookings load failed:', error.message, { venueId });
    throw error;
  }
  const rows = (data ?? []) as unknown as RevenueBookingRow[];
  if (rows.length === 0) return [];
  const { rowTotal } = await loadRowTotalResolver(admin, rows, { venueId });
  return rows.map((r) => ({
    booking_date: r.booking_date,
    status: r.status ?? null,
    calendar_id: r.calendar_id ?? null,
    venue_id: r.venue_id ?? null,
    pence: rowTotal(r),
  }));
}

export async function buildBookedRevenueReport(
  admin: SupabaseClient,
  input: { venueId: string; venueName: string; from: string; to: string; grain: BookedRevenueGrain; today: string },
): Promise<BookedRevenueReport> {
  const { venueId, venueName, from, to, grain, today } = input;

  const accessible = await loadAccessibleLinkedVenueIds(admin, venueId);
  const partners = accessible.filter((a) => grantAllowsRevenueReporting(a.grant));
  const partnerNames = new Map<string, string>();
  if (partners.length > 0) {
    const { data } = await admin
      .from('venues')
      .select('id, name')
      .in(
        'id',
        partners.map((p) => p.venueId),
      );
    for (const v of data ?? []) partnerNames.set(v.id as string, (v.name as string | null) ?? 'Linked venue');
  }

  const [ownColumns, ownRows, ...partnerResults] = await Promise.all([
    loadCalendarColumns(admin, venueId, venueName, { linked: false }),
    loadPricedRows(admin, venueId, from, to),
    ...partners.map(async (p) => {
      const name = partnerNames.get(p.venueId) ?? 'Linked venue';
      const [columns, rows] = await Promise.all([
        loadCalendarColumns(admin, p.venueId, name, { linked: true, scopeIds: p.grant.calendarIds ?? null }),
        loadPricedRows(admin, p.venueId, from, to),
      ]);
      return { columns, rows };
    }),
  ]);

  const columns: BookedRevenueColumn[] = [...ownColumns];
  // Bookings with no calendar (or on a calendar since deleted) still count for the venue.
  const ownRowsUnassigned = ownRows.some((r) => !r.calendar_id || !ownColumns.some((c) => c.calendar_id === r.calendar_id));
  if (ownRowsUnassigned) {
    columns.push({
      key: UNASSIGNED_KEY,
      calendar_id: null,
      name: 'No calendar',
      venue_id: venueId,
      venue_name: venueName,
      linked: false,
      colour: null,
    });
  }
  const rows = [...ownRows];
  for (const partner of partnerResults) {
    columns.push(...partner.columns);
    rows.push(...partner.rows);
  }

  return aggregateBookedRevenue({ from, to, grain, today, columns, rows });
}
