import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateLinkEligibility } from './eligibility';

/**
 * The live venue collective a member's staff may book for as one business.
 *
 * A collective in `unified_catalog` mode with at least two currently eligible
 * active members is what the combined public page requires to render
 * (`loadPublicCollective`); the staff booking form applies the same gate, so
 * staff and clients see the same set of calendars and offerings. Pairwise links
 * without a collective never qualify: the per-venue form stays as it is.
 */
export interface StaffCollectiveScope {
  collectiveId: string;
  name: string;
  hostVenueId: string;
  /** Active member venue ids, the actor's own included. */
  memberVenueIds: string[];
}

interface CollectiveRow {
  id: string;
  name: string;
  status: string;
  page_mode: string;
  host_venue_id: string;
}

async function activeMemberVenueIds(admin: SupabaseClient, collectiveId: string): Promise<string[]> {
  const { data } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  return (data ?? []).map((m) => m.venue_id as string);
}

/** Members that are appointments-family venues on an active plan, the public page's rule. */
async function countEligible(admin: SupabaseClient, venueIds: string[]): Promise<number> {
  if (venueIds.length === 0) return 0;
  const { data: venues } = await admin
    .from('venues')
    .select('id, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source')
    .in('id', venueIds);
  let eligible = 0;
  for (const v of venues ?? []) {
    const result = evaluateLinkEligibility({
      pricing_tier: (v.pricing_tier as string | null) ?? null,
      plan_status: (v.plan_status as string | null) ?? null,
      booking_model: (v.booking_model as string | null) ?? null,
      subscription_current_period_end: (v.subscription_current_period_end as string | null) ?? null,
      billing_access_source: (v.billing_access_source as string | null) ?? null,
    });
    if (result.canCreate) eligible += 1;
  }
  return eligible;
}

function isLiveCollectiveRow(row: CollectiveRow | null | undefined): row is CollectiveRow {
  return Boolean(row) && row!.status === 'active' && row!.page_mode === 'unified_catalog';
}

/**
 * Is `collectiveId` a live collective that `staffVenueId` is an active member of?
 * Null when it is not (or is not a collective at all), so a caller can fall back
 * to treating the id as a plain venue.
 */
export async function resolveStaffCollectiveScope(
  admin: SupabaseClient,
  staffVenueId: string,
  collectiveId: string,
): Promise<StaffCollectiveScope | null> {
  const { data } = await admin
    .from('venue_collectives')
    .select('id, name, status, page_mode, host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  const row = data as CollectiveRow | null;
  if (!isLiveCollectiveRow(row)) return null;
  const memberVenueIds = await activeMemberVenueIds(admin, row.id);
  if (!memberVenueIds.includes(staffVenueId)) return null;
  if ((await countEligible(admin, memberVenueIds)) < 2) return null;
  return { collectiveId: row.id, name: row.name, hostVenueId: row.host_venue_id, memberVenueIds };
}

/**
 * The live collective `venueId` books for, if any. A venue belongs to at most
 * one active collective in practice (membership needs full mutual write links
 * with every other member); the first live one wins if the data ever holds two.
 */
export async function findStaffCollectiveForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<StaffCollectiveScope | null> {
  const { data: memberships } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  for (const m of memberships ?? []) {
    const scope = await resolveStaffCollectiveScope(admin, venueId, m.collective_id as string);
    if (scope) return scope;
  }
  return null;
}
