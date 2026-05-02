/**
 * Shared helpers for venue guest / contacts list (API + CSV export).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueStaff } from '@/lib/venue-auth';

export const UPCOMING_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'] as const;

export type ContactsLifecycleStatus = 'all' | 'upcoming' | 'lapsed' | 'new_this_month' | 'vip';

export interface ParsedGuestListQuery {
  search: string;
  tags: string[];
  sort: string;
  filter: 'all' | 'identified' | 'anonymous';
  lifecycle: ContactsLifecycleStatus;
  page: number;
  limit: number;
  /** When true, list rows include `custom_fields` JSON (heavier payload; used for CSV export). */
  include_custom_fields: boolean;
}

const INTERNAL_SORTS = new Set([
  'name_asc',
  'name_desc',
  'last_visit_desc',
  'last_visit_asc',
  'visit_count_desc',
  'created_desc',
  'paid_deposit_desc',
]);

const SORT_ALIASES: Record<string, string> = {
  last_visit: 'last_visit_desc',
  visit_count: 'visit_count_desc',
  name: 'name_asc',
  created: 'created_desc',
  spend: 'paid_deposit_desc',
  total_spend: 'paid_deposit_desc',
};

const FILTERS = new Set(['all', 'identified', 'anonymous']);
const LIFECYCLES = new Set<ContactsLifecycleStatus>(['all', 'upcoming', 'lapsed', 'new_this_month', 'vip']);

export function sanitiseIlikeSearch(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '');
}

export function resolveGuestListSort(raw: string | null): string {
  const s = (raw ?? 'last_visit').trim();
  if (INTERNAL_SORTS.has(s)) return s;
  const mapped = SORT_ALIASES[s];
  if (mapped && INTERNAL_SORTS.has(mapped)) return mapped;
  return 'last_visit_desc';
}

export function parseGuestListQuery(sp: URLSearchParams): ParsedGuestListQuery {
  const searchRaw = sp.get('search')?.trim() ?? '';
  const search = sanitiseIlikeSearch(searchRaw);
  const tagsParam = sp.get('tags')?.trim() ?? '';
  const tags = tagsParam
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const sort = resolveGuestListSort(sp.get('sort'));
  const filterRaw = (sp.get('filter') ?? 'identified').trim().toLowerCase();
  const filter = FILTERS.has(filterRaw) ? (filterRaw as ParsedGuestListQuery['filter']) : 'identified';
  const lifeRaw = (sp.get('status') ?? 'all').trim().toLowerCase();
  const lifecycle = LIFECYCLES.has(lifeRaw as ContactsLifecycleStatus)
    ? (lifeRaw as ContactsLifecycleStatus)
    : 'all';
  const pageRaw = Number.parseInt(sp.get('page') ?? '0', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0;
  const limitRaw = Number.parseInt(sp.get('limit') ?? '25', 10) || 25;
  const limit = Math.min(50, Math.max(1, limitRaw));
  const icf = sp.get('include_custom_fields');
  const include_custom_fields = icf === '1' || icf === 'true';
  return { search, tags, sort, filter, lifecycle, page, limit, include_custom_fields };
}

export async function getVenueTimeZone(db: SupabaseClient, venueId: string): Promise<string> {
  const { data, error } = await db.from('venues').select('timezone').eq('id', venueId).maybeSingle();
  if (error) {
    console.error('[guest-contacts-list] venue timezone load failed:', error.message);
  }
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return typeof tz === 'string' && tz.trim() !== '' ? tz.trim() : 'Europe/London';
}

export function calendarDateInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** YYYY-MM-DD for the first calendar day of the month containing `anchor` in `timeZone`. */
export function monthStartCalendarDateInTimeZone(anchor: Date, timeZone: string): string {
  const today = calendarDateInTimeZone(anchor, timeZone);
  const [y, m] = today.split('-');
  return `${y}-${m}-01`;
}

export function addDaysCalendarDate(calendarDate: string, deltaDays: number): string {
  const [y, mo, d] = calendarDate.split('-').map((x) => Number.parseInt(x, 10));
  const utc = Date.UTC(y, mo - 1, d + deltaDays);
  const dt = new Date(utc);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export interface GuestRowBase {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  tags?: string[];
  visit_count?: number;
  no_show_count?: number;
  last_visit_date?: string | null;
  created_at: string;
  identifiability_tier?: string;
  marketing_opt_out?: boolean;
  marketing_consent?: boolean;
  custom_fields?: Record<string, unknown>;
}

export async function fetchUpcomingGuestIdsOrdered(
  db: SupabaseClient,
  venueId: string,
  fromDate: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('bookings')
    .select('guest_id, booking_date')
    .eq('venue_id', venueId)
    .not('guest_id', 'is', null)
    .gte('booking_date', fromDate)
    .in('status', [...UPCOMING_BOOKING_STATUSES]);

  if (error) {
    console.error('[guest-contacts-list] upcoming guest ids failed:', error.message);
    return [];
  }

  const best = new Map<string, string>();
  for (const row of data ?? []) {
    const gid = (row as { guest_id?: string | null }).guest_id;
    const bd = (row as { booking_date?: string | null }).booking_date;
    if (!gid || !bd) continue;
    const prev = best.get(gid);
    if (!prev || bd > prev) best.set(gid, bd);
  }
  return [...best.keys()].sort((a, b) => (best.get(b) ?? '').localeCompare(best.get(a) ?? ''));
}

export async function aggregateBookingSignalsForGuests(
  db: SupabaseClient,
  venueId: string,
  guestIds: string[],
  todayCalendar: string,
): Promise<{
  totalBookings: Map<string, number>;
  cancelled: Map<string, number>;
  upcoming: Map<string, number>;
  paidDepositPence: Map<string, number>;
}> {
  const totalBookings = new Map<string, number>();
  const cancelled = new Map<string, number>();
  const upcoming = new Map<string, number>();
  const paidDepositPence = new Map<string, number>();

  if (guestIds.length === 0) {
    return { totalBookings, cancelled, upcoming, paidDepositPence };
  }

  const { data, error } = await db
    .from('bookings')
    .select('guest_id, status, booking_date, deposit_status, deposit_amount_pence')
    .eq('venue_id', venueId)
    .in('guest_id', guestIds);

  if (error) {
    console.error('[guest-contacts-list] booking aggregates failed:', error.message);
    return { totalBookings, cancelled, upcoming, paidDepositPence };
  }

  for (const row of data ?? []) {
    const gid = (row as { guest_id?: string | null }).guest_id;
    if (!gid) continue;
    const status = String((row as { status?: string }).status ?? '');
    const bd = (row as { booking_date?: string | null }).booking_date;
    const depSt = (row as { deposit_status?: string | null }).deposit_status;
    const depP = (row as { deposit_amount_pence?: number | null }).deposit_amount_pence;

    if (status !== 'Cancelled') {
      totalBookings.set(gid, (totalBookings.get(gid) ?? 0) + 1);
    }
    if (status === 'Cancelled') {
      cancelled.set(gid, (cancelled.get(gid) ?? 0) + 1);
    }
    if (
      bd &&
      bd >= todayCalendar &&
      UPCOMING_BOOKING_STATUSES.includes(status as (typeof UPCOMING_BOOKING_STATUSES)[number])
    ) {
      upcoming.set(gid, (upcoming.get(gid) ?? 0) + 1);
    }
    if (depSt === 'Paid' && typeof depP === 'number' && Number.isFinite(depP)) {
      paidDepositPence.set(gid, (paidDepositPence.get(gid) ?? 0) + depP);
    }
  }

  return { totalBookings, cancelled, upcoming, paidDepositPence };
}

const SPEND_SORT_MAX_IDS = 800;

/**
 * Returns guest ids matching base guest-table filters (identified tier, tags, search),
 * capped for spend sort pre-ordering.
 */
export async function fetchGuestIdsForSpendSort(
  staff: VenueStaff,
  params: ParsedGuestListQuery,
  timeZone: string,
): Promise<{ ids: string[]; capped: boolean }> {
  let q = staff.db
    .from('guests')
    .select('id')
    .eq('venue_id', staff.venue_id);

  if (params.filter === 'identified') {
    q = q.eq('identifiability_tier', 'identified');
  } else if (params.filter === 'anonymous') {
    q = q.eq('identifiability_tier', 'anonymous');
  } else {
    q = q.in('identifiability_tier', ['identified', 'named']);
  }

  if (params.tags.length) {
    q = q.contains('tags', params.tags);
  }

  if (params.search) {
    const p = `%${params.search}%`;
    q = q.or(`name.ilike.${p},email.ilike.${p},phone.ilike.${p}`);
  }

  const today = calendarDateInTimeZone(new Date(), timeZone);
  const monthStart = monthStartCalendarDateInTimeZone(new Date(), timeZone);
  const lapsedCut = addDaysCalendarDate(today, -90);

  if (params.lifecycle === 'upcoming') {
    const orderedRaw = await fetchUpcomingGuestIdsOrdered(staff.db, staff.venue_id, today);
    const ordered = orderedRaw.slice(0, 500);
    if (ordered.length === 0) return { ids: [], capped: orderedRaw.length > 500 };
    q = q.in('id', ordered);
  } else if (params.lifecycle === 'lapsed') {
    q = q.not('last_visit_date', 'is', null).lte('last_visit_date', lapsedCut);
  } else if (params.lifecycle === 'new_this_month') {
    q = q.gte('created_at', `${monthStart}T00:00:00`);
  } else if (params.lifecycle === 'vip') {
    q = q.contains('tags', ['vip']);
  }

  const { data, error } = await q.limit(SPEND_SORT_MAX_IDS + 1);
  if (error) {
    console.error('[guest-contacts-list] fetch ids for spend sort failed:', error.message);
    return { ids: [], capped: false };
  }
  const rows = (data ?? []) as { id: string }[];
  const capped = rows.length > SPEND_SORT_MAX_IDS;
  const ids = rows.slice(0, SPEND_SORT_MAX_IDS).map((r) => r.id);
  return { ids, capped };
}
