import type { SupabaseClient } from '@supabase/supabase-js';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import { resolveCdeBookingContext, type CdeBookingContext } from '@/lib/booking/cde-booking-context';
import type { BookingModel } from '@/types/booking-models';

export interface AccountGuestSafeRow {
  id: string;
  venue_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_opt_out: boolean;
  first_booked_at: string | null;
  last_booked_at: string | null;
  total_bookings_count: number;
  total_spent_minor: number;
}

export interface AccountVenueRow {
  id: string;
  name: string;
  slug: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  /** IANA timezone for the venue; defaults to Europe/London for display when missing. */
  timezone?: string | null;
}

/** One ticket tier on an event booking ("2 × Adult", etc.). */
export interface AccountTicketLine {
  label: string;
  quantity: number;
  unit_price_pence: number;
}

/**
 * Friendly, model-agnostic label for the booking's class/event/resource context plus
 * any extra detail we can show a guest (ticket tiers, session start, resource duration).
 * Assembled from the same FKs the staff detail + confirmation email use.
 */
export interface AccountCdeContext {
  inferred_model: BookingModel;
  /** Event / class / resource name. */
  title: string;
  /** e.g. "Ends 21:00", "Starts 18:30", host calendar name. */
  subtitle?: string | null;
  /** Event ticket tiers, when present. */
  ticket_lines?: AccountTicketLine[];
  /** Resource booking duration in minutes (from start/end), when derivable. */
  duration_minutes?: number | null;
}

export interface AccountBookingRow {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  booking_model: BookingModel;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  /** Present when this row was part of a class multi-session / course cart checkout. */
  group_booking_id?: string | null;
  class_instance_id?: string | null;
  experience_event_id?: string | null;
  resource_id?: string | null;
  venue: AccountVenueRow | null;
  /** CDE name + extras (event/class/resource). Null for table/appointment rows. */
  cde_context?: AccountCdeContext | null;
  manage_booking_link: string;
}

export type AccountBookingDisplayItem =
  | { kind: 'group'; group_booking_id: string; venue: AccountVenueRow | null; rows: AccountBookingRow[] }
  | { kind: 'single'; row: AccountBookingRow };

/** Columns selected from `bookings` for every account loader (kept in one place). */
const ACCOUNT_BOOKING_COLUMNS =
  'id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, booking_model, deposit_status, deposit_amount_pence, special_requests, dietary_notes, occasion, group_booking_id, class_instance_id, experience_event_id, resource_id';

type RawBookingRow = {
  id: string;
  venue_id: string;
  guest_id: string;
  booking_date: string;
  booking_time: string;
  booking_end_time?: string | null;
  party_size: number;
  status: string;
  booking_model?: BookingModel | null;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  special_requests?: string | null;
  dietary_notes?: string | null;
  occasion?: string | null;
  group_booking_id?: string | null;
  class_instance_id?: string | null;
  experience_event_id?: string | null;
  resource_id?: string | null;
};

const FRIENDLY_STATUS_LABELS: Record<string, string> = {
  'No-Show': 'Missed',
  NoShow: 'Missed',
  'No Show': 'Missed',
  Seated: 'Checked in',
  Booked: 'Confirmed',
  Pending: 'Awaiting payment',
};

/**
 * Guest-facing status wording. Raw lifecycle enums ("No-Show", "Seated") read as internal
 * jargon to a customer, so map them to friendlier copy. Unknown values pass through unchanged.
 */
export function friendlyAccountBookingStatus(status: string | null | undefined): string {
  if (!status) return 'Booked';
  return FRIENDLY_STATUS_LABELS[status] ?? status;
}

/** Resolve the display timezone for a booking (venue TZ, then caller fallback, then London). */
export function accountBookingTimeZone(
  row: Pick<AccountBookingRow, 'venue'>,
  fallbackTz?: string | null,
): string {
  const venueTz = row.venue?.timezone?.trim();
  if (venueTz) return venueTz;
  const fb = fallbackTz?.trim();
  return fb || 'Europe/London';
}

/**
 * Format a stored date + wall-clock time in the given IANA timezone.
 * Booking date/time are venue wall-clock values, so we anchor them to that zone for a
 * consistent guest-facing rendering across the list, detail and hub surfaces.
 */
export function formatAccountBookingDateTime(
  dateStr: string,
  timeStr: string | null | undefined,
  timeZone: string,
  opts?: { withWeekday?: boolean },
): { date: string; time: string | null } {
  const dParts = dateStr.split('-').map(Number);
  if (dParts.length !== 3 || dParts.some((n) => Number.isNaN(n))) {
    return { date: dateStr, time: timeStr ? String(timeStr).slice(0, 5) : null };
  }
  const [y, mo, d] = dParts;
  const tz = timeZone.trim() || 'Europe/London';

  const dateOut = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).toLocaleDateString('en-GB', {
    ...(opts?.withWeekday ? { weekday: 'long' as const } : {}),
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: tz,
  });

  return { date: dateOut, time: timeStr ? String(timeStr).slice(0, 5) : null };
}

function minutesBetween(start: string | null | undefined, end: string | null | undefined): number | null {
  const s = (start ?? '').slice(0, 5);
  const e = (end ?? '').slice(0, 5);
  if (!s || !e) return null;
  const sm = parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
  const em = parseInt(e.slice(0, 2), 10) * 60 + parseInt(e.slice(3, 5), 10);
  if (!Number.isFinite(sm) || !Number.isFinite(em)) return null;
  const diff = em - sm;
  return diff > 0 ? diff : null;
}

/**
 * Build the guest-facing CDE context for a single booking row, reusing the shared
 * `resolveCdeBookingContext` resolver and adding event ticket tiers / resource duration.
 * Returns null for table/appointment rows (no CDE FK).
 */
async function buildAccountCdeContext(
  admin: Pick<SupabaseClient, 'from'>,
  row: RawBookingRow,
): Promise<AccountCdeContext | null> {
  const base: CdeBookingContext | null = await resolveCdeBookingContext(admin, {
    experience_event_id: row.experience_event_id ?? null,
    class_instance_id: row.class_instance_id ?? null,
    resource_id: row.resource_id ?? null,
    booking_end_time: row.booking_end_time ?? null,
  });
  if (!base) return null;

  const ctx: AccountCdeContext = {
    inferred_model: base.inferred_model,
    title: base.title,
    subtitle: base.subtitle ?? null,
  };

  if (row.experience_event_id) {
    const { data: lines } = await admin
      .from('booking_ticket_lines')
      .select('label, quantity, unit_price_pence')
      .eq('booking_id', row.id);
    const ticketLines = (lines ?? [])
      .map((l) => ({
        label: (l as { label?: string }).label ?? 'Ticket',
        quantity: (l as { quantity?: number }).quantity ?? 0,
        unit_price_pence: (l as { unit_price_pence?: number }).unit_price_pence ?? 0,
      }))
      .filter((l) => l.quantity > 0);
    if (ticketLines.length > 0) ctx.ticket_lines = ticketLines;
  }

  if (row.resource_id) {
    ctx.duration_minutes = minutesBetween(row.booking_time, row.booking_end_time);
  }

  return ctx;
}

/**
 * Collapses multi-session class rows that share `group_booking_id` into one list entry for the account UI.
 */
export function buildAccountBookingDisplayList(rows: AccountBookingRow[]): AccountBookingDisplayItem[] {
  const groupMap = new Map<string, AccountBookingRow[]>();
  for (const r of rows) {
    if (r.booking_model === 'class_session' && r.group_booking_id) {
      const g = r.group_booking_id;
      const arr = groupMap.get(g) ?? [];
      arr.push(r);
      groupMap.set(g, arr);
    }
  }

  const usedGroups = new Set<string>();
  const out: AccountBookingDisplayItem[] = [];

  for (const r of rows) {
    if (r.booking_model === 'class_session' && r.group_booking_id) {
      const g = r.group_booking_id;
      if (usedGroups.has(g)) continue;
      usedGroups.add(g);
      const members = groupMap.get(g) ?? [r];
      if (members.length > 1) {
        const sorted = [...members].sort(
          (a, b) =>
            a.booking_date.localeCompare(b.booking_date) ||
            String(a.booking_time).localeCompare(String(b.booking_time)),
        );
        out.push({ kind: 'group', group_booking_id: g, venue: r.venue, rows: sorted });
      } else {
        out.push({ kind: 'single', row: r });
      }
      continue;
    }
    out.push({ kind: 'single', row: r });
  }

  return out;
}

export async function loadAccountSafeGuests(
  supabase: SupabaseClient,
): Promise<AccountGuestSafeRow[]> {
  const { data, error } = await supabase
    .from('guests_account_safe')
    .select(
      'id, venue_id, email, phone, first_name, last_name, marketing_consent, marketing_consent_at, marketing_opt_out, first_booked_at, last_booked_at, total_bookings_count, total_spent_minor',
    )
    .order('last_booked_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[loadAccountSafeGuests]', error.message);
    throw new Error('Failed to load account guest relationships');
  }

  return (data ?? []) as AccountGuestSafeRow[];
}

async function loadVenueMap(
  admin: SupabaseClient,
  venueIds: string[],
): Promise<Map<string, AccountVenueRow>> {
  if (venueIds.length === 0) return new Map();
  const { data: venues, error } = await admin
    .from('venues')
    .select('id, name, slug, address, phone, email, timezone')
    .in('id', venueIds);
  if (error) {
    console.error('[loadAccountBookings] venues:', error.message);
  }
  return new Map((venues ?? []).map((v) => [v.id, v as AccountVenueRow]));
}

/** Hydrate a raw bookings row into an AccountBookingRow (venue + CDE context + manage link). */
async function hydrateAccountBookingRow(
  admin: SupabaseClient,
  b: RawBookingRow,
  venueMap: Map<string, AccountVenueRow>,
): Promise<AccountBookingRow> {
  const [cde_context, manage_booking_link] = await Promise.all([
    buildAccountCdeContext(admin, b),
    createOrGetBookingShortLink({ venueId: b.venue_id, bookingId: b.id, purpose: 'manage' }),
  ]);

  return {
    id: b.id,
    venue_id: b.venue_id,
    guest_id: b.guest_id,
    booking_date: b.booking_date,
    booking_time: b.booking_time,
    booking_end_time: b.booking_end_time ?? null,
    party_size: b.party_size,
    status: b.status,
    booking_model: (b.booking_model as BookingModel | null) ?? 'table_reservation',
    deposit_status: b.deposit_status ?? null,
    deposit_amount_pence: b.deposit_amount_pence ?? null,
    special_requests: b.special_requests ?? null,
    dietary_notes: b.dietary_notes ?? null,
    occasion: b.occasion ?? null,
    group_booking_id: b.group_booking_id ?? null,
    class_instance_id: b.class_instance_id ?? null,
    experience_event_id: b.experience_event_id ?? null,
    resource_id: b.resource_id ?? null,
    venue: venueMap.get(b.venue_id) ?? null,
    cde_context,
    manage_booking_link,
  };
}

export async function loadAccountBookings(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  limit = 100,
): Promise<AccountBookingRow[]> {
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return [];

  const { data: bookings, error: bErr } = await admin
    .from('bookings')
    .select(ACCOUNT_BOOKING_COLUMNS)
    .in('guest_id', guestIds)
    .order('booking_date', { ascending: false })
    .order('booking_time', { ascending: false })
    .limit(limit);

  if (bErr) {
    console.error('[loadAccountBookings] bookings:', bErr.message);
    throw new Error('Failed to load account bookings');
  }

  const rows = (bookings ?? []) as RawBookingRow[];
  const venueIds = [...new Set(rows.map((b) => b.venue_id))];
  const venueMap = await loadVenueMap(admin, venueIds);

  return Promise.all(rows.map((b) => hydrateAccountBookingRow(admin, b, venueMap)));
}

/**
 * Load upcoming bookings of a single CDE model for the per-model hub pages
 * (/account/events, /account/resources). Ordered soonest-first, future dates only.
 */
export async function loadAccountUpcomingBookingsByModel(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  model: Extract<BookingModel, 'event_ticket' | 'resource_booking'>,
  todayUtcDate: string,
  limit = 50,
): Promise<AccountBookingRow[]> {
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return [];

  const fkColumn = model === 'event_ticket' ? 'experience_event_id' : 'resource_id';

  const { data: bookings, error: bErr } = await admin
    .from('bookings')
    .select(ACCOUNT_BOOKING_COLUMNS)
    .in('guest_id', guestIds)
    .eq('booking_model', model)
    .gte('booking_date', todayUtcDate)
    .not(fkColumn, 'is', null)
    .order('booking_date', { ascending: true })
    .order('booking_time', { ascending: true })
    .limit(limit);

  if (bErr) {
    console.error(`[loadAccountUpcomingBookingsByModel:${model}]`, bErr.message);
    throw new Error('Failed to load account bookings');
  }

  const rows = ((bookings ?? []) as RawBookingRow[]).filter(
    (b) => b.status !== 'Cancelled',
  );
  const venueIds = [...new Set(rows.map((b) => b.venue_id))];
  const venueMap = await loadVenueMap(admin, venueIds);

  return Promise.all(rows.map((b) => hydrateAccountBookingRow(admin, b, venueMap)));
}

export async function loadAccountBookingById(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  bookingId: string,
): Promise<AccountBookingRow | null> {
  // Only the caller's own bookings are visible: scope to guest ids derived from the
  // authenticated session's account-safe guest view, then load the single row directly.
  const guests = await loadAccountSafeGuests(supabase);
  const guestIds = guests.map((g) => g.id);
  if (guestIds.length === 0) return null;

  const { data: booking, error } = await admin
    .from('bookings')
    .select(ACCOUNT_BOOKING_COLUMNS)
    .eq('id', bookingId)
    .in('guest_id', guestIds)
    .maybeSingle();

  if (error) {
    console.error('[loadAccountBookingById]', error.message);
    throw new Error('Failed to load booking');
  }
  if (!booking) return null;

  const raw = booking as RawBookingRow;
  const venueMap = await loadVenueMap(admin, [raw.venue_id]);
  return hydrateAccountBookingRow(admin, raw, venueMap);
}
