import type { SupabaseClient } from '@supabase/supabase-js';
import { createOrGetBookingShortLink } from '@/lib/booking-short-links';
import type { BookingModel } from '@/types/booking-models';

export interface AccountGuestSafeRow {
  id: string;
  venue_id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
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
  venue: AccountVenueRow | null;
  manage_booking_link: string;
}

export type AccountBookingDisplayItem =
  | { kind: 'group'; group_booking_id: string; venue: AccountVenueRow | null; rows: AccountBookingRow[] }
  | { kind: 'single'; row: AccountBookingRow };

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
      'id, venue_id, email, phone, name, marketing_consent, marketing_consent_at, marketing_opt_out, first_booked_at, last_booked_at, total_bookings_count, total_spent_minor',
    )
    .order('last_booked_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('[loadAccountSafeGuests]', error.message);
    throw new Error('Failed to load account guest relationships');
  }

  return (data ?? []) as AccountGuestSafeRow[];
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
    .select(
      'id, venue_id, guest_id, booking_date, booking_time, booking_end_time, party_size, status, booking_model, deposit_status, deposit_amount_pence, special_requests, dietary_notes, occasion, group_booking_id, class_instance_id',
    )
    .in('guest_id', guestIds)
    .order('booking_date', { ascending: false })
    .order('booking_time', { ascending: false })
    .limit(limit);

  if (bErr) {
    console.error('[loadAccountBookings] bookings:', bErr.message);
    throw new Error('Failed to load account bookings');
  }

  const venueIds = [...new Set((bookings ?? []).map((b) => b.venue_id as string))];
  const { data: venues, error: vErr } =
    venueIds.length > 0
      ? await admin.from('venues').select('id, name, slug, address, phone, email').in('id', venueIds)
      : { data: [] as AccountVenueRow[], error: null };

  if (vErr) {
    console.error('[loadAccountBookings] venues:', vErr.message);
  }

  const venueMap = new Map((venues ?? []).map((v) => [v.id, v as AccountVenueRow]));

  const rows = bookings ?? [];
  return Promise.all(
    rows.map(async (b) => ({
      id: b.id as string,
      venue_id: b.venue_id as string,
      guest_id: b.guest_id as string,
      booking_date: b.booking_date as string,
      booking_time: b.booking_time as string,
      booking_end_time: (b.booking_end_time as string | null | undefined) ?? null,
      party_size: b.party_size as number,
      status: b.status as string,
      booking_model: (b.booking_model as BookingModel | null) ?? 'table_reservation',
      deposit_status: (b.deposit_status as string | null | undefined) ?? null,
      deposit_amount_pence: (b.deposit_amount_pence as number | null | undefined) ?? null,
      special_requests: (b.special_requests as string | null | undefined) ?? null,
      dietary_notes: (b.dietary_notes as string | null | undefined) ?? null,
      occasion: (b.occasion as string | null | undefined) ?? null,
      group_booking_id: (b as { group_booking_id?: string | null }).group_booking_id ?? null,
      class_instance_id: (b as { class_instance_id?: string | null }).class_instance_id ?? null,
      venue: venueMap.get(b.venue_id as string) ?? null,
      manage_booking_link: await createOrGetBookingShortLink({
        venueId: b.venue_id as string,
        bookingId: b.id as string,
        purpose: 'manage',
      }),
    })),
  );
}

export async function loadAccountBookingById(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  bookingId: string,
): Promise<AccountBookingRow | null> {
  const bookings = await loadAccountBookings(supabase, admin, 200);
  return bookings.find((b) => b.id === bookingId) ?? null;
}
