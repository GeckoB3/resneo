/** Server-side data helpers for Linked Accounts. All use the admin client. */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountLinkRow, AccountLinkView, LinkGrant } from './types';
import { normaliseGrant, orderVenuePair, viewLinkForVenue } from './permissions';

const LINK_COLUMNS =
  'id, venue_low_id, venue_high_id, requested_by_venue_id, status, ' +
  'low_grants_calendar, low_grants_pii, low_grants_act, low_grants_calendar_ids, ' +
  'high_grants_calendar, high_grants_pii, high_grants_act, high_grants_calendar_ids, ' +
  'request_message, pending_change, created_by_user_id, responded_by_user_id, ' +
  'created_at, responded_at, terminated_at, termination_reason, updated_at';

/** Load all account_links rows touching a venue (any status). */
export async function loadLinkRowsForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<AccountLinkRow[]> {
  const { data, error } = await admin
    .from('account_links')
    .select(LINK_COLUMNS)
    .or(`venue_low_id.eq.${venueId},venue_high_id.eq.${venueId}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[linked-accounts] loadLinkRowsForVenue failed:', error.message);
    return [];
  }
  return (data ?? []) as unknown as AccountLinkRow[];
}

/** Resolve link rows into the perspective of `venueId`, with venue-name lookup. */
export async function loadLinkViewsForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<AccountLinkView[]> {
  const rows = await loadLinkRowsForVenue(admin, venueId);
  if (rows.length === 0) return [];

  const otherIds = new Set<string>();
  for (const r of rows) {
    otherIds.add(r.venue_low_id === venueId ? r.venue_high_id : r.venue_low_id);
  }
  const lookup = await loadVenueLookup(admin, [...otherIds]);

  const views: AccountLinkView[] = [];
  for (const r of rows) {
    const v = viewLinkForVenue(r, venueId, lookup);
    if (v) views.push(v);
  }
  return views;
}

/** id → { name, slug } for a set of venues. */
export async function loadVenueLookup(
  admin: SupabaseClient,
  venueIds: string[],
): Promise<Record<string, { name: string; slug: string }>> {
  const lookup: Record<string, { name: string; slug: string }> = {};
  if (venueIds.length === 0) return lookup;
  const { data } = await admin
    .from('venues')
    .select('id, name, slug')
    .in('id', venueIds);
  for (const row of data ?? []) {
    lookup[row.id as string] = {
      name: (row.name as string) ?? 'Unknown venue',
      slug: (row.slug as string) ?? '',
    };
  }
  return lookup;
}

/** Any non-terminal link between two venues (pending / accepted / suspended). */
export async function findLiveLinkBetween(
  admin: SupabaseClient,
  venueAId: string,
  venueBId: string,
): Promise<AccountLinkRow | null> {
  const { low, high } = orderVenuePair(venueAId, venueBId);
  const { data } = await admin
    .from('account_links')
    .select(LINK_COLUMNS)
    .eq('venue_low_id', low)
    .eq('venue_high_id', high)
    .in('status', ['pending', 'accepted', 'suspended'])
    .maybeSingle();
  return (data as unknown as AccountLinkRow | null) ?? null;
}

/** The single accepted link between two venues, if any. */
export async function getAcceptedLinkBetween(
  admin: SupabaseClient,
  venueAId: string,
  venueBId: string,
): Promise<AccountLinkRow | null> {
  const { low, high } = orderVenuePair(venueAId, venueBId);
  const { data } = await admin
    .from('account_links')
    .select(LINK_COLUMNS)
    .eq('venue_low_id', low)
    .eq('venue_high_id', high)
    .eq('status', 'accepted')
    .maybeSingle();
  return (data as unknown as AccountLinkRow | null) ?? null;
}

/**
 * What `callerVenueId` is permitted to do to `ownerVenueId`'s data, via the
 * accepted link between them. Returns null when there is no usable access.
 */
export async function resolveCallerGrantOverVenue(
  admin: SupabaseClient,
  callerVenueId: string,
  ownerVenueId: string,
): Promise<{ linkId: string; grant: LinkGrant } | null> {
  if (callerVenueId === ownerVenueId) return null;
  const link = await getAcceptedLinkBetween(admin, callerVenueId, ownerVenueId);
  if (!link) return null;
  // The grant authored by the owner venue is the one the caller receives.
  const ownerIsLow = link.venue_low_id === ownerVenueId;
  const grant = normaliseGrant(
    ownerIsLow
      ? {
          calendar: link.low_grants_calendar,
          pii: link.low_grants_pii,
          act: link.low_grants_act,
          calendarIds: link.low_grants_calendar_ids,
        }
      : {
          calendar: link.high_grants_calendar,
          pii: link.high_grants_pii,
          act: link.high_grants_act,
          calendarIds: link.high_grants_calendar_ids,
        },
  );
  if (grant.calendar === 'none') return null;
  return { linkId: link.id, grant };
}

/** Venue ids whose calendars `venueId` can currently see (accepted links, >= time_only). */
export async function loadAccessibleLinkedVenueIds(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ venueId: string; linkId: string; grant: LinkGrant }[]> {
  const rows = await loadLinkRowsForVenue(admin, venueId);
  const out: { venueId: string; linkId: string; grant: LinkGrant }[] = [];
  for (const r of rows) {
    if (r.status !== 'accepted') continue;
    const otherId = r.venue_low_id === venueId ? r.venue_high_id : r.venue_low_id;
    const otherIsLow = r.venue_low_id === otherId;
    const grant = normaliseGrant(
      otherIsLow
        ? {
            calendar: r.low_grants_calendar,
            pii: r.low_grants_pii,
            act: r.low_grants_act,
            calendarIds: r.low_grants_calendar_ids,
          }
        : {
            calendar: r.high_grants_calendar,
            pii: r.high_grants_pii,
            act: r.high_grants_act,
            calendarIds: r.high_grants_calendar_ids,
          },
    );
    if (grant.calendar === 'none') continue;
    out.push({ venueId: otherId, linkId: r.id, grant });
  }
  return out;
}

/** Count of pending requests this venue has sent (for the §12 rate limit). */
export async function countOutgoingPendingRequests(
  admin: SupabaseClient,
  venueId: string,
): Promise<number> {
  const { count } = await admin
    .from('account_links')
    .select('id', { count: 'exact', head: true })
    .eq('requested_by_venue_id', venueId)
    .eq('status', 'pending');
  return count ?? 0;
}

/** Most recent rejected link between two venues (for the §12 cooldown). */
export async function lastRejectedLinkBetween(
  admin: SupabaseClient,
  venueAId: string,
  venueBId: string,
): Promise<AccountLinkRow | null> {
  const { low, high } = orderVenuePair(venueAId, venueBId);
  const { data } = await admin
    .from('account_links')
    .select(LINK_COLUMNS)
    .eq('venue_low_id', low)
    .eq('venue_high_id', high)
    .eq('status', 'rejected')
    .order('responded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as AccountLinkRow | null) ?? null;
}

/** Active admin staff for a venue (notification recipients). */
export async function loadActiveAdminStaff(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ id: string; email: string; name: string | null }[]> {
  const { data } = await admin
    .from('staff')
    .select('id, email, name')
    .eq('venue_id', venueId)
    .eq('role', 'admin')
    .is('revoked_at', null);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    email: (r.email as string) ?? '',
    name: (r.name as string) ?? null,
  }));
}
