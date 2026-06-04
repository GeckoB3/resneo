/**
 * Shared helpers for venue guest / contacts list (API + CSV export).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenueStaff } from '@/lib/venue-auth';
import { normaliseSegmentTagFilter } from '@/lib/guests/tags';

export const UPCOMING_BOOKING_STATUSES = ['Pending', 'Booked', 'Confirmed', 'Seated'] as const;

export type ContactsSegment =
  | 'all'
  | 'new'
  | 'upcoming'
  | 'visit'
  | 'marketing'
  | 'last_staff'
  | 'last_service'
  | 'tag';

export type ContactsMarketingFilter = 'subscribed' | 'not_subscribed';

export type LastServiceKind = 'appointment_service' | 'service_item';

export interface ParsedGuestListQuery {
  search: string;
  tags: string[];
  sort: string;
  filter: 'all' | 'identified' | 'anonymous';
  /** Directory segment (replaces legacy `status` when `segment` query param is sent). */
  segment: ContactsSegment;
  /** When `segment` is `tag`, filter guests whose `tags` contains this value (normalised). */
  segment_tag: string | null;
  /** Inclusive YYYY-MM-DD (venue calendar interpretation for guest fields / booking_date). */
  date_from: string | null;
  date_to: string | null;
  marketing: ContactsMarketingFilter | null;
  last_staff_id: string | null;
  last_service_kind: LastServiceKind | null;
  last_service_id: string | null;
  page: number;
  limit: number;
  /** When true, list rows include `custom_fields` JSON (heavier payload; used for CSV export). */
  include_custom_fields: boolean;
  /** Legacy `status` query key preserved for deep links; mapped into `segment` when `segment` absent. */
  legacy_status: string | null;
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
const SEGMENTS = new Set<ContactsSegment>([
  'all',
  'new',
  'upcoming',
  'visit',
  'marketing',
  'last_staff',
  'last_service',
  'tag',
]);
const LEGACY_STATUS_MAP: Record<string, ContactsSegment> = {
  upcoming: 'upcoming',
  lapsed: 'visit',
  new_this_month: 'new',
  vip: 'tag',
  all: 'all',
};

function parseOptionalISODate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function parseUuid(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(t)
  ) {
    return null;
  }
  return t;
}

export function sanitiseIlikeSearch(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/,/g, '');
}

/**
 * Build the PostgREST `.or()` group for a single search token: the token must
 * match the first name, last name, email, or phone. For digit-heavy tokens we
 * also match the phone by its digits — and, for a UK-style national number
 * (leading `0`), by the significant digits without it — so partial phone numbers
 * match the E.164-stored value regardless of formatting.
 *
 * `token` is assumed already passed through {@link sanitiseIlikeSearch} (so `%`
 * `_` `\` are escaped and commas removed); we additionally strip parentheses so
 * they can't break PostgREST's `or()` grouping.
 */
function guestSearchTokenOrGroup(token: string): string {
  const t = token.replace(/[()]/g, '');
  const conds = [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `email.ilike.%${t}%`];
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 3) {
    conds.push(`phone.ilike.%${digits}%`);
    if (digits.startsWith('0')) conds.push(`phone.ilike.%${digits.slice(1)}%`);
  } else {
    conds.push(`phone.ilike.%${t}%`);
  }
  return conds.join(',');
}

/**
 * Split a (sanitised) search string into whitespace tokens and return one
 * PostgREST `.or()` group per token. Chaining these groups as separate `.or()`
 * filters AND-s them, so every token must match *some* column — e.g. "and cour"
 * matches Andrew Courtney, while a single token still matches any one field.
 */
export function guestSearchOrGroups(search: string): string[] {
  return search
    .split(/\s+/)
    .map((t) => t.replace(/[()]/g, '').trim())
    .filter(Boolean)
    .map(guestSearchTokenOrGroup);
}

/**
 * Apply the tokenised guest search to a Supabase query builder. Each token's
 * `.or()` group is AND-ed with the others (multiple `.or()` filters combine with
 * AND), giving name/email/phone matching plus multi-token name combinations.
 */
export function applyGuestSearch<Q extends { or(filters: string): Q }>(
  query: Q,
  search: string,
): Q {
  let q = query;
  for (const group of guestSearchOrGroups(search)) {
    q = q.or(group);
  }
  return q;
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

  const segmentRaw = sp.get('segment')?.trim().toLowerCase() ?? '';
  const legacyStatusRaw = (sp.get('status') ?? 'all').trim().toLowerCase();

  let segment_tag = normaliseSegmentTagFilter(sp.get('segment_tag'));

  let segment: ContactsSegment = 'all';
  if (segmentRaw === 'vip') {
    segment = 'tag';
    if (!segment_tag) segment_tag = 'vip';
  } else if (segmentRaw && SEGMENTS.has(segmentRaw as ContactsSegment)) {
    segment = segmentRaw as ContactsSegment;
  } else if (LEGACY_STATUS_MAP[legacyStatusRaw]) {
    segment = LEGACY_STATUS_MAP[legacyStatusRaw];
    if (segment === 'tag' && legacyStatusRaw === 'vip' && !segment_tag) {
      segment_tag = 'vip';
    }
  }

  const date_from = parseOptionalISODate(sp.get('date_from'));
  const date_to = parseOptionalISODate(sp.get('date_to'));

  const marketingRaw = sp.get('marketing')?.trim().toLowerCase() ?? '';
  let marketing: ContactsMarketingFilter | null =
    marketingRaw === 'subscribed' || marketingRaw === 'not_subscribed' ? marketingRaw : null;

  const last_staff_id = parseUuid(sp.get('last_staff_id'));

  const lskRaw = sp.get('last_service_kind')?.trim().toLowerCase() ?? '';
  const last_service_kind: LastServiceKind | null =
    lskRaw === 'appointment_service' || lskRaw === 'service_item' ? lskRaw : null;
  const last_service_id = parseUuid(sp.get('last_service_id'));

  const pageRaw = Number.parseInt(sp.get('page') ?? '0', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? pageRaw : 0;
  const limitRaw = Number.parseInt(sp.get('limit') ?? '25', 10) || 25;
  const limit = Math.min(250, Math.max(1, limitRaw));
  const icf = sp.get('include_custom_fields');
  const include_custom_fields = icf === '1' || icf === 'true';

  if (segment === 'marketing' && !marketing) {
    marketing = 'subscribed';
  }

  return {
    search,
    tags,
    sort,
    filter,
    segment,
    segment_tag,
    date_from,
    date_to,
    marketing,
    last_staff_id,
    last_service_kind,
    last_service_id,
    page,
    limit,
    include_custom_fields,
    legacy_status: legacyStatusRaw,
  };
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

/** Default and legacy-bound calendar dates for segment filters (inclusive YYYY-MM-DD). */
export function resolveContactsSegmentDates(
  segment: ContactsSegment,
  date_from: string | null,
  date_to: string | null,
  today: string,
  monthStart: string,
  legacy_status: string | null,
): { from: string | null; to: string | null } {
  if (segment === 'new') {
    return { from: date_from ?? monthStart, to: date_to ?? today };
  }
  if (segment === 'upcoming') {
    return {
      from: date_from ?? today,
      to: date_to ?? addDaysCalendarDate(today, 365),
    };
  }
  if (segment === 'visit') {
    if (!date_from && !date_to && legacy_status === 'lapsed') {
      return { from: null, to: addDaysCalendarDate(today, -90) };
    }
    return { from: date_from, to: date_to };
  }
  if (segment === 'marketing' || segment === 'last_staff' || segment === 'last_service' || segment === 'tag') {
    return { from: date_from, to: date_to };
  }
  return { from: null, to: null };
}

/** Chain subset used for guest list queries (PostgrestFilterBuilder-compatible). */
export interface GuestFilterChain<Self> {
  gte(column: string, value: string): Self;
  lte(column: string, value: string): Self;
  not(column: string, operator: string, value: unknown): Self;
  eq(column: string, value: unknown): Self;
  contains(column: string, value: string[]): Self;
  in(column: string, values: string[]): Self;
}

/**
 * Applies `segment` filters that live on `guests` only.
 * Skip upcoming / last_staff / last_service (handled via id lists / special branches).
 */
export function applyGuestsDirectorySegment<Self extends GuestFilterChain<Self>>(
  q: Self,
  params: ParsedGuestListQuery,
  today: string,
  monthStart: string,
): Self {
  const bounds = resolveContactsSegmentDates(
    params.segment,
    params.date_from,
    params.date_to,
    today,
    monthStart,
    params.legacy_status,
  );

  switch (params.segment) {
    case 'all':
      return q;
    case 'new': {
      const from = bounds.from ?? monthStart;
      const to = bounds.to ?? today;
      return q.gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59.999`);
    }
    case 'visit': {
      // Past visits only: must have a recorded last_visit_date on or before venue "today".
      let out: Self = q.not('last_visit_date', 'is', null).lte('last_visit_date', today) as Self;
      if (bounds.from && bounds.to) {
        out = out.gte('last_visit_date', bounds.from).lte('last_visit_date', bounds.to) as Self;
        return out;
      }
      if (bounds.to) {
        return out.lte('last_visit_date', bounds.to) as Self;
      }
      if (bounds.from) {
        return out.gte('last_visit_date', bounds.from) as Self;
      }
      return out;
    }
    case 'marketing': {
      let out: Self = q;
      if (params.marketing === 'subscribed') {
        out = out.eq('marketing_consent', true) as Self;
      } else if (params.marketing === 'not_subscribed') {
        out = out.eq('marketing_consent', false) as Self;
      }
      if (bounds.from) {
        out = out.gte('marketing_consent_at', `${bounds.from}T00:00:00`) as Self;
      }
      if (bounds.to) {
        out = out.lte('marketing_consent_at', `${bounds.to}T23:59:59.999`) as Self;
      }
      return out;
    }
    case 'tag': {
      const t = params.segment_tag;
      if (!t) return q;
      return q.contains('tags', [t]) as Self;
    }
    case 'upcoming':
    case 'last_staff':
    case 'last_service':
      return q;
    default:
      return q;
  }
}

export async function fetchContactsLatestBookingMatchGuestIds(
  db: SupabaseClient,
  venueId: string,
  args: {
    staffColumnId: string | null;
    appointmentServiceId: string | null;
    serviceItemId: string | null;
    bookingDateFrom: string | null;
    bookingDateTo: string | null;
  },
): Promise<string[]> {
  const { data, error } = await db.rpc('contacts_filter_guest_ids_latest_booking_match', {
    p_venue_id: venueId,
    p_staff_column_id: args.staffColumnId,
    p_appointment_service_id: args.appointmentServiceId,
    p_service_item_id: args.serviceItemId,
    p_booking_date_from: args.bookingDateFrom,
    p_booking_date_to: args.bookingDateTo,
  });
  if (error) {
    console.error('[guest-contacts-list] contacts_filter_guest_ids_latest_booking_match failed:', error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as { guest_id?: string }[];
  return rows.map((r) => r.guest_id).filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export interface GuestRowBase {
  id: string;
  first_name: string | null;
  last_name: string | null;
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
  toDate: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('bookings')
    .select('guest_id, booking_date')
    .eq('venue_id', venueId)
    .not('guest_id', 'is', null)
    .gte('booking_date', fromDate)
    .lte('booking_date', toDate)
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
  nextBookingDate: Map<string, string>;
  nextBookingTime: Map<string, string>;
}> {
  const totalBookings = new Map<string, number>();
  const cancelled = new Map<string, number>();
  const upcoming = new Map<string, number>();
  const paidDepositPence = new Map<string, number>();
  const nextBookingDate = new Map<string, string>();
  const nextBookingTime = new Map<string, string>();

  if (guestIds.length === 0) {
    return { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime };
  }

  const { data, error } = await db
    .from('bookings')
    .select('guest_id, status, booking_date, booking_time, deposit_status, deposit_amount_pence')
    .eq('venue_id', venueId)
    .in('guest_id', guestIds);

  if (error) {
    console.error('[guest-contacts-list] booking aggregates failed:', error.message);
    return { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime };
  }

  for (const row of data ?? []) {
    const gid = (row as { guest_id?: string | null }).guest_id;
    if (!gid) continue;
    const status = String((row as { status?: string }).status ?? '');
    const bd = (row as { booking_date?: string | null }).booking_date;
    const bt = (row as { booking_time?: string | null }).booking_time;
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
      const existing = nextBookingDate.get(gid);
      if (!existing || bd < existing || (bd === existing && bt && bt < (nextBookingTime.get(gid) ?? ''))) {
        nextBookingDate.set(gid, bd);
        if (bt) nextBookingTime.set(gid, bt);
      }
    }
    if (depSt === 'Paid' && typeof depP === 'number' && Number.isFinite(depP)) {
      paidDepositPence.set(gid, (paidDepositPence.get(gid) ?? 0) + depP);
    }
  }

  return { totalBookings, cancelled, upcoming, paidDepositPence, nextBookingDate, nextBookingTime };
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
    q = applyGuestSearch(q, params.search);
  }

  const today = calendarDateInTimeZone(new Date(), timeZone);
  const monthStart = monthStartCalendarDateInTimeZone(new Date(), timeZone);
  const bounds = resolveContactsSegmentDates(
    params.segment,
    params.date_from,
    params.date_to,
    today,
    monthStart,
    params.legacy_status,
  );

  if (params.segment === 'upcoming') {
    const fromD = bounds.from ?? today;
    const toD = bounds.to ?? addDaysCalendarDate(today, 365);
    const orderedRaw = await fetchUpcomingGuestIdsOrdered(staff.db, staff.venue_id, fromD, toD);
    const ordered = orderedRaw.slice(0, 500);
    if (ordered.length === 0) return { ids: [], capped: orderedRaw.length > 500 };
    q = q.in('id', ordered);
  } else if (params.segment === 'last_staff') {
    if (!params.last_staff_id) return { ids: [], capped: false };
    const segIds = await fetchContactsLatestBookingMatchGuestIds(staff.db, staff.venue_id, {
      staffColumnId: params.last_staff_id,
      appointmentServiceId: null,
      serviceItemId: null,
      bookingDateFrom: bounds.from,
      bookingDateTo: bounds.to,
    });
    if (segIds.length === 0) return { ids: [], capped: false };
    q = q.in('id', segIds);
  } else if (params.segment === 'last_service') {
    if (!params.last_service_kind || !params.last_service_id) return { ids: [], capped: false };
    const segIds = await fetchContactsLatestBookingMatchGuestIds(staff.db, staff.venue_id, {
      staffColumnId: null,
      appointmentServiceId:
        params.last_service_kind === 'appointment_service' ? params.last_service_id : null,
      serviceItemId: params.last_service_kind === 'service_item' ? params.last_service_id : null,
      bookingDateFrom: bounds.from,
      bookingDateTo: bounds.to,
    });
    if (segIds.length === 0) return { ids: [], capped: false };
    q = q.in('id', segIds);
  } else {
    q = applyGuestsDirectorySegment(q, params, today, monthStart);
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
