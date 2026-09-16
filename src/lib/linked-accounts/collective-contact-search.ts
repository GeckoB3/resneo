/**
 * Contact search across a live collective (plan §6.5 "The contact search has to reach across
 * venues", D41; contract 16; UX spec §2 item 13, `staff.contact.ownerLine`; W7).
 *
 * Inside a live collective the staff form's contact picker searches every live member venue, and
 * each result names the venue that owns the record. The access comes from the account links, not
 * the collective: another venue's clients are searched only when that venue's link lets this venue
 * see client details. The scope itself is the collective's, so it ends with the membership, and a
 * venue outside a live collective is refused.
 *
 * Ownership never moves: a record found here belongs to its own venue.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { findStaffCollectiveForVenue, eligibleMemberVenueIds } from '@/lib/linked-accounts/collective-staff-scope';
import { resolveCallerGrantOverVenue } from '@/lib/linked-accounts/queries';
import { applyGuestSearch } from '@/lib/guests/guest-contacts-list';

export const COLLECTIVE_SEARCH_LIMIT = 25;

export interface CollectiveContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  tags: string[];
  visit_count: number;
  no_show_count: number;
  last_visit_date: string | null;
  created_at: string;
  identifiability_tier?: string;
  total_bookings: number;
  owner_venue_id: string;
  owner_venue_name: string;
  /** True for the searching venue's own clients. */
  owner_is_self: boolean;
}

type Row = Record<string, unknown>;

/** The venues whose clients `venueId` may search in its live collective, or null outside one. */
export async function collectiveContactVenues(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ collectiveId: string; venueIds: string[] } | null> {
  const scope = await findStaffCollectiveForVenue(admin, venueId);
  if (!scope) return null;
  const members = await eligibleMemberVenueIds(admin, scope.collectiveId);
  const venueIds = [venueId];
  for (const other of members) {
    if (other === venueId) continue;
    const access = await resolveCallerGrantOverVenue(admin, venueId, other);
    if (access?.grant.pii) venueIds.push(other);
  }
  return { collectiveId: scope.collectiveId, venueIds };
}

export async function searchCollectiveContacts(
  admin: SupabaseClient,
  venueId: string,
  search: string,
  limit = COLLECTIVE_SEARCH_LIMIT,
): Promise<{ ok: true; guests: CollectiveContactRow[] } | { ok: false }> {
  const scope = await collectiveContactVenues(admin, venueId);
  if (!scope) return { ok: false };
  if (!search.trim()) return { ok: true, guests: [] };

  const query = admin
    .from('guests')
    .select('id, venue_id, first_name, last_name, email, phone, tags, visit_count, no_show_count, last_visit_date, created_at, identifiability_tier')
    .in('venue_id', scope.venueIds);
  const { data, error } = await applyGuestSearch(query, search)
    .order('last_name', { ascending: true })
    .limit(Math.max(1, Math.min(limit, COLLECTIVE_SEARCH_LIMIT)));
  if (error) throw new Error(error.message);

  const { data: venues } = await admin.from('venues').select('id, name').in('id', scope.venueIds);
  const names = new Map(((venues ?? []) as Row[]).map((v) => [v.id as string, (v.name as string) ?? 'A venue']));
  return {
    ok: true,
    guests: ((data ?? []) as Row[]).map((g) => ({
      id: g.id as string,
      first_name: (g.first_name as string | null) ?? null,
      last_name: (g.last_name as string | null) ?? null,
      email: (g.email as string | null) ?? null,
      phone: (g.phone as string | null) ?? null,
      tags: Array.isArray(g.tags) ? (g.tags as string[]) : [],
      visit_count: (g.visit_count as number | null) ?? 0,
      no_show_count: (g.no_show_count as number | null) ?? 0,
      last_visit_date: (g.last_visit_date as string | null) ?? null,
      created_at: g.created_at as string,
      identifiability_tier: (g.identifiability_tier as string | undefined) ?? 'named',
      total_bookings: 0,
      owner_venue_id: g.venue_id as string,
      owner_venue_name: names.get(g.venue_id as string) ?? 'A venue',
      owner_is_self: g.venue_id === venueId,
    })),
  };
}
