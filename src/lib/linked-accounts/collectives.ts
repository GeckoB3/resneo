/** Venue collective types and server helpers (Phase 2, §7). */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAcceptedLinkBetween } from './queries';

export type CollectiveStatus = 'active' | 'dissolved';
export type CollectiveMemberStatus = 'invited' | 'active' | 'left' | 'removed';
export type ServiceGrouping = 'by_practitioner' | 'by_service_type';

export interface CollectiveBranding {
  logo_url?: string | null;
  primary_colour?: string | null;
  description?: string | null;
}

export interface VenueCollectiveRow {
  id: string;
  slug: string;
  name: string;
  host_venue_id: string;
  branding: CollectiveBranding;
  service_grouping: ServiceGrouping;
  allow_any_practitioner: boolean;
  status: CollectiveStatus;
  created_at: string;
  updated_at: string;
}

export interface CollectiveMemberRow {
  id: string;
  collective_id: string;
  venue_id: string;
  status: CollectiveMemberStatus;
  display_order: number;
  visible_practitioner_ids: string[];
  visible_service_ids: string[];
  allow_any_practitioner_substitution: boolean;
  joined_at: string | null;
  left_at: string | null;
}

export interface CollectiveView {
  id: string;
  slug: string;
  name: string;
  status: CollectiveStatus;
  branding: CollectiveBranding;
  serviceGrouping: ServiceGrouping;
  allowAnyPractitioner: boolean;
  isHost: boolean;
  /** This venue's membership status, if it is a member. */
  myMembershipStatus: CollectiveMemberStatus | null;
  members: {
    venueId: string;
    venueName: string;
    status: CollectiveMemberStatus;
    displayOrder: number;
  }[];
  activeMemberCount: number;
}

const COLLECTIVE_COLUMNS =
  'id, slug, name, host_venue_id, branding, service_grouping, allow_any_practitioner, status, created_at, updated_at';

/**
 * True when `venueId` holds an accepted link with full_details visibility in
 * BOTH directions with every venue in `otherVenueIds` (§7.2).
 */
export async function hasFullMutualLinks(
  admin: SupabaseClient,
  venueId: string,
  otherVenueIds: string[],
): Promise<boolean> {
  for (const otherId of otherVenueIds) {
    if (otherId === venueId) continue;
    const link = await getAcceptedLinkBetween(admin, venueId, otherId);
    if (!link) return false;
    if (
      link.low_grants_calendar !== 'full_details' ||
      link.high_grants_calendar !== 'full_details'
    ) {
      return false;
    }
  }
  return true;
}

/** Load every collective `venueId` hosts or is a member of, as views. */
export async function loadCollectiveViewsForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<CollectiveView[]> {
  const { data: hosted } = await admin
    .from('venue_collectives')
    .select(COLLECTIVE_COLUMNS)
    .eq('host_venue_id', venueId);

  const { data: memberships } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .in('status', ['invited', 'active']);

  const collectiveIds = new Set<string>();
  for (const c of hosted ?? []) collectiveIds.add(c.id as string);
  for (const m of memberships ?? []) collectiveIds.add(m.collective_id as string);
  if (collectiveIds.size === 0) return [];

  const { data: collectives } = await admin
    .from('venue_collectives')
    .select(COLLECTIVE_COLUMNS)
    .in('id', [...collectiveIds]);

  const { data: allMembers } = await admin
    .from('venue_collective_members')
    .select('collective_id, venue_id, status, display_order')
    .in('collective_id', [...collectiveIds])
    .in('status', ['invited', 'active']);

  const memberVenueIds = new Set<string>();
  for (const m of allMembers ?? []) memberVenueIds.add(m.venue_id as string);
  const venueNames: Record<string, string> = {};
  if (memberVenueIds.size > 0) {
    const { data: venues } = await admin
      .from('venues')
      .select('id, name')
      .in('id', [...memberVenueIds]);
    for (const v of venues ?? []) venueNames[v.id as string] = (v.name as string) ?? 'Venue';
  }

  return (collectives ?? []).map((c) => {
    const row = c as VenueCollectiveRow;
    const members = (allMembers ?? [])
      .filter((m) => m.collective_id === row.id)
      .map((m) => ({
        venueId: m.venue_id as string,
        venueName: venueNames[m.venue_id as string] ?? 'Venue',
        status: m.status as CollectiveMemberStatus,
        displayOrder: (m.display_order as number) ?? 0,
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const mine = members.find((m) => m.venueId === venueId);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      branding: row.branding ?? {},
      serviceGrouping: row.service_grouping,
      allowAnyPractitioner: row.allow_any_practitioner,
      isHost: row.host_venue_id === venueId,
      myMembershipStatus: mine?.status ?? null,
      members,
      activeMemberCount: members.filter((m) => m.status === 'active').length,
    };
  });
}

/**
 * Re-verify a collective still satisfies its membership rules and dissolve /
 * trim it where it does not (§7.5). Returns the venues that were removed.
 */
export async function reconcileCollective(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<{ removedVenueIds: string[]; dissolved: boolean }> {
  const removedVenueIds: string[] = [];
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, status, host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.status !== 'active') {
    return { removedVenueIds, dissolved: false };
  }

  const { data: members } = await admin
    .from('venue_collective_members')
    .select('id, venue_id, status')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const active = (members ?? []).map((m) => ({
    id: m.id as string,
    venueId: m.venue_id as string,
  }));

  // Each active member must still hold full mutual links with all other actives.
  for (const member of active) {
    const others = active.filter((m) => m.venueId !== member.venueId).map((m) => m.venueId);
    const ok = await hasFullMutualLinks(admin, member.venueId, others);
    if (!ok) {
      await admin
        .from('venue_collective_members')
        .update({ status: 'removed', left_at: new Date().toISOString() })
        .eq('id', member.id);
      removedVenueIds.push(member.venueId);
    }
  }

  const remaining = active.length - removedVenueIds.length;
  if (remaining < 2) {
    await admin
      .from('venue_collectives')
      .update({ status: 'dissolved' })
      .eq('id', collectiveId);
    return { removedVenueIds, dissolved: true };
  }
  return { removedVenueIds, dissolved: false };
}

export interface PublicCollectiveMember {
  venueId: string;
  venueName: string;
  venueSlug: string;
  practitioners: { id: string; name: string; slug: string | null }[];
  services: { id: string; name: string; durationMinutes: number; pricePence: number | null }[];
  allowAnyPractitionerSubstitution: boolean;
}

export interface PublicCollective {
  name: string;
  slug: string;
  branding: CollectiveBranding;
  serviceGrouping: ServiceGrouping;
  allowAnyPractitioner: boolean;
  members: PublicCollectiveMember[];
}

/**
 * Build the public-page dataset for a collective, re-verifying membership rules
 * first (§7.5). Returns null when the collective is not live.
 */
export async function loadPublicCollective(
  admin: SupabaseClient,
  slug: string,
): Promise<PublicCollective | null> {
  const { data: collectiveRow } = await admin
    .from('venue_collectives')
    .select(COLLECTIVE_COLUMNS)
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!collectiveRow) return null;
  const collective = collectiveRow as VenueCollectiveRow;
  if (collective.status !== 'active') return null;

  // Re-verify links still hold; this may dissolve the collective.
  const { dissolved } = await reconcileCollective(admin, collective.id);
  if (dissolved) return null;

  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select(
      'venue_id, status, display_order, visible_practitioner_ids, visible_service_ids, ' +
        'allow_any_practitioner_substitution',
    )
    .eq('collective_id', collective.id)
    .eq('status', 'active')
    .order('display_order', { ascending: true });
  const activeMembers = (memberRows ?? []) as unknown as Array<Record<string, unknown>>;
  if (activeMembers.length < 2) return null;

  const venueIds = activeMembers.map((m) => m.venue_id as string);
  const { data: venues } = await admin
    .from('venues')
    .select('id, name, slug')
    .in('id', venueIds);
  const venueLookup: Record<string, { name: string; slug: string }> = {};
  for (const v of venues ?? []) {
    venueLookup[v.id as string] = {
      name: (v.name as string) ?? 'Venue',
      slug: (v.slug as string) ?? '',
    };
  }

  const members: PublicCollectiveMember[] = [];
  for (const m of activeMembers) {
    const venueId = m.venue_id as string;
    const venue = venueLookup[venueId];
    if (!venue) continue;
    const visiblePractitioners = (m.visible_practitioner_ids as string[]) ?? [];
    const visibleServices = (m.visible_service_ids as string[]) ?? [];

    const { data: practitionerRows } = await admin
      .from('practitioners')
      .select('id, name, slug, is_active, sort_order')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    const practitioners = (practitionerRows ?? [])
      .filter((p) =>
        visiblePractitioners.length === 0 ? true : visiblePractitioners.includes(p.id as string),
      )
      .map((p) => ({
        id: p.id as string,
        name: (p.name as string) ?? 'Practitioner',
        slug: (p.slug as string | null) ?? null,
      }));

    const { data: serviceRows } = await admin
      .from('appointment_services')
      .select('id, name, duration_minutes, price_pence, is_active, sort_order')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    const services = (serviceRows ?? [])
      .filter((s) =>
        visibleServices.length === 0 ? true : visibleServices.includes(s.id as string),
      )
      .map((s) => ({
        id: s.id as string,
        name: (s.name as string) ?? 'Service',
        durationMinutes: (s.duration_minutes as number) ?? 0,
        pricePence: (s.price_pence as number | null) ?? null,
      }));

    members.push({
      venueId,
      venueName: venue.name,
      venueSlug: venue.slug,
      practitioners,
      services,
      allowAnyPractitionerSubstitution:
        (m.allow_any_practitioner_substitution as boolean) ?? false,
    });
  }

  return {
    name: collective.name,
    slug: collective.slug,
    branding: collective.branding ?? {},
    serviceGrouping: collective.service_grouping,
    allowAnyPractitioner: collective.allow_any_practitioner,
    members,
  };
}
