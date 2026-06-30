/** Venue collective types and server helpers (Phase 2, §7). */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getAcceptedLinkBetween } from './queries';
import { evaluateLinkEligibility } from './eligibility';
import {
  notifyCollectiveDissolved,
  notifyCollectiveHostTransferred,
  notifyCollectiveRemoval,
} from './notifications';

export type CollectiveStatus = 'active' | 'dissolved';

/**
 * Tombstone slug applied when a collective is dissolved, so its public booking-page
 * address (`venue_collectives.slug` is globally UNIQUE) is freed for reuse immediately.
 * Derived from the collective id → guaranteed unique; the dead row keeps no claim on the
 * original slug. (The adopted-venue index is already partial on `status='active'`.)
 */
export function dissolvedCollectiveSlug(collectiveId: string): string {
  return `dissolved-${collectiveId}`;
}
export type CollectiveMemberStatus = 'invited' | 'active' | 'left' | 'removed';
export type ServiceGrouping = 'by_practitioner' | 'by_service_type';
/** Combined booking page (plan §1.3). `directory` = the Phase 2 list-of-venues page. */
export type PageMode = 'directory' | 'unified_catalog';
/** Where the combined page is served (plan D1). */
export type SlugStrategy = 'dedicated' | 'adopt_member';
/** What a member's own /book/{slug} does while the combined page is live (plan D2). */
export type SoloPageBehavior = 'keep_live' | 'redirect';
export type ItemStatus = 'active' | 'archived';
/** Member consent on the commercial terms for its calendars (plan D6). */
export type ProviderApprovalStatus = 'pending' | 'approved' | 'rejected';
/** Link/eligibility-driven bookability of a provider (plan §8). */
export type ProviderStatus = 'active' | 'suspended' | 'removed';
export type PricingDisplay = 'from' | 'fixed' | 'per_provider';

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
  page_mode: PageMode;
  slug_strategy: SlugStrategy;
  adopted_venue_id: string | null;
  timezone: string | null;
  booking_page_config: Record<string, unknown> | null;
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
  solo_page_behavior: SoloPageBehavior;
  joined_at: string | null;
  left_at: string | null;
}

/** A merged offering on the combined page (plan §4.3). */
export interface CollectiveServiceItemRow {
  id: string;
  collective_id: string;
  name: string;
  description: string | null;
  category: string | null;
  display_order: number;
  default_duration_minutes: number | null;
  default_price_pence: number | null;
  pricing_display: PricingDisplay;
  allow_any_available: boolean;
  status: ItemStatus;
  created_at: string;
  updated_at: string;
}

/** A calendar (venue + service + optional practitioner) that provides an item (plan §4.4). */
export interface CollectiveServiceProviderRow {
  id: string;
  item_id: string;
  member_id: string;
  venue_id: string;
  source_service_id: string;
  practitioner_id: string | null;
  price_pence_override: number | null;
  duration_minutes_override: number | null;
  approval_status: ProviderApprovalStatus;
  approved_by_user_id: string | null;
  status: ProviderStatus;
  created_at: string;
  updated_at: string;
}

export interface CollectiveView {
  id: string;
  slug: string;
  name: string;
  status: CollectiveStatus;
  branding: CollectiveBranding;
  serviceGrouping: ServiceGrouping;
  allowAnyPractitioner: boolean;
  /** Combined booking page (plan §1.3). */
  pageMode: PageMode;
  slugStrategy: SlugStrategy;
  adoptedVenueId: string | null;
  timezone: string | null;
  /** Single-venue-grade public-page config for the combined page (plan §22 / G6). */
  bookingPageConfig: Record<string, unknown> | null;
  isHost: boolean;
  /** The host venue's id (so the UI can identify which member is the host). */
  hostVenueId: string;
  /** The venue this view was loaded for. */
  myVenueId: string;
  /** This venue's membership status, if it is a member. */
  myMembershipStatus: CollectiveMemberStatus | null;
  /** This venue's own member configuration (visible practitioners/services, order). */
  myConfig: {
    visiblePractitionerIds: string[];
    visibleServiceIds: string[];
    allowAnyPractitionerSubstitution: boolean;
    displayOrder: number;
    soloPageBehavior: SoloPageBehavior;
  } | null;
  members: {
    venueId: string;
    venueName: string;
    status: CollectiveMemberStatus;
    displayOrder: number;
    soloPageBehavior: SoloPageBehavior;
  }[];
  activeMemberCount: number;
}

const COLLECTIVE_COLUMNS =
  'id, slug, name, host_venue_id, branding, service_grouping, allow_any_practitioner, status, page_mode, slug_strategy, adopted_venue_id, timezone, booking_page_config, created_at, updated_at';

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

/**
 * Combined-page gate (plan D4). Like {@link hasFullMutualLinks} but additionally
 * requires `create_edit_cancel` in BOTH directions and no §18 calendar scoping
 * — a combined page lets any member's staff manage any combined booking, so the
 * write right must be full and cover every calendar. Used to gate upgrade to
 * `unified_catalog` and to drive the provider suspend/resume ladder on reconcile.
 */
export async function hasFullMutualWriteLinks(
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
      link.high_grants_calendar !== 'full_details' ||
      link.low_grants_act !== 'create_edit_cancel' ||
      link.high_grants_act !== 'create_edit_cancel' ||
      link.low_grants_calendar_ids != null ||
      link.high_grants_calendar_ids != null
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Decide each provider's link/eligibility-driven `status` after a reconcile
 * (plan §8). Pure so the split logic is unit-testable:
 *   - a provider whose venue was removed from the collective → `removed`;
 *   - otherwise → `active` when its venue currently holds full mutual write with
 *     all surviving members, else `suspended` (recoverable).
 * Never touches `approval_status` (the consent dimension) and leaves already
 * `removed` rows alone. Returns only the rows whose status must change.
 */
export function planProviderStatuses(
  providers: { id: string; venueId: string; status: ProviderStatus }[],
  removedVenueIds: string[],
  writeOkByVenue: Record<string, boolean>,
): { id: string; status: ProviderStatus }[] {
  const removed = new Set(removedVenueIds);
  const changes: { id: string; status: ProviderStatus }[] = [];
  for (const p of providers) {
    if (p.status === 'removed') continue;
    const next: ProviderStatus = removed.has(p.venueId)
      ? 'removed'
      : writeOkByVenue[p.venueId]
        ? 'active'
        : 'suspended';
    if (next !== p.status) changes.push({ id: p.id, status: next });
  }
  return changes;
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
    .select(
      'collective_id, venue_id, status, display_order, visible_practitioner_ids, visible_service_ids, allow_any_practitioner_substitution, solo_page_behavior',
    )
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
        soloPageBehavior: ((m.solo_page_behavior as SoloPageBehavior) ?? 'keep_live'),
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const mine = members.find((m) => m.venueId === venueId);
    const myRaw = (allMembers ?? []).find(
      (m) => m.collective_id === row.id && m.venue_id === venueId,
    );
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      branding: row.branding ?? {},
      serviceGrouping: row.service_grouping,
      allowAnyPractitioner: row.allow_any_practitioner,
      pageMode: (row.page_mode as PageMode) ?? 'directory',
      slugStrategy: (row.slug_strategy as SlugStrategy) ?? 'dedicated',
      adoptedVenueId: row.adopted_venue_id ?? null,
      timezone: row.timezone ?? null,
      bookingPageConfig: (row.booking_page_config as Record<string, unknown> | null) ?? null,
      isHost: row.host_venue_id === venueId,
      hostVenueId: row.host_venue_id,
      myVenueId: venueId,
      myMembershipStatus: mine?.status ?? null,
      myConfig: myRaw
        ? {
            visiblePractitionerIds: (myRaw.visible_practitioner_ids as string[]) ?? [],
            visibleServiceIds: (myRaw.visible_service_ids as string[]) ?? [],
            allowAnyPractitionerSubstitution:
              (myRaw.allow_any_practitioner_substitution as boolean) ?? false,
            displayOrder: (myRaw.display_order as number) ?? 0,
            soloPageBehavior:
              ((myRaw.solo_page_behavior as SoloPageBehavior) ?? 'keep_live'),
          }
        : null,
      members,
      activeMemberCount: members.filter((m) => m.status === 'active').length,
    };
  });
}

/**
 * Pick the replacement host when a collective's host is no longer an active
 * member (§7.4): the longest-tenured surviving member (earliest `joinedAt`),
 * with a stable `venueId` tiebreak so the choice is deterministic. A null or
 * unparseable `joinedAt` sorts last. Returns null when there are no survivors.
 * Pure (no I/O) so it can be unit-tested directly.
 */
export function selectReplacementHost(
  survivors: { venueId: string; joinedAt: string | null }[],
): string | null {
  if (survivors.length === 0) return null;
  const tenure = (j: string | null): number => {
    if (!j) return Number.POSITIVE_INFINITY;
    const t = Date.parse(j);
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  return [...survivors].sort((a, b) => {
    const at = tenure(a.joinedAt);
    const bt = tenure(b.joinedAt);
    if (at !== bt) return at - bt; // earliest joiner = longest-tenured, wins host
    return a.venueId < b.venueId ? -1 : a.venueId > b.venueId ? 1 : 0;
  })[0].venueId;
}

/**
 * Re-verify a collective still satisfies its membership rules and dissolve /
 * trim it where it does not (§7.5). Returns the venues that were removed, whether
 * the collective was dissolved, and — when the cascade removed the host — the
 * venue hosting was transferred to (§7.4).
 */
export async function reconcileCollective(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<{ removedVenueIds: string[]; dissolved: boolean; hostTransferredTo: string | null }> {
  const removedVenueIds: string[] = [];
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, status, host_venue_id, page_mode')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.status !== 'active') {
    return { removedVenueIds, dissolved: false, hostTransferredTo: null };
  }

  const { data: members } = await admin
    .from('venue_collective_members')
    .select('id, venue_id, status, joined_at')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const active = (members ?? []).map((m) => ({
    id: m.id as string,
    venueId: m.venue_id as string,
    joinedAt: (m.joined_at as string | null) ?? null,
  }));

  // Each active member must still hold full mutual links with all other actives.
  // Read every member's link state FIRST. If any read fails, the membership state is
  // UNCERTAIN — abort with zero changes rather than risk an irreversible wrongful
  // dissolve. (getAcceptedLinkBetween now throws on a real read error instead of
  // returning a null that looks like "no link".) A later reconcile retries cleanly.
  const toRemove: typeof active = [];
  try {
    for (const member of active) {
      const others = active.filter((m) => m.venueId !== member.venueId).map((m) => m.venueId);
      const ok = await hasFullMutualLinks(admin, member.venueId, others);
      if (!ok) toRemove.push(member);
    }
  } catch (err) {
    console.warn('[reconcileCollective] aborting without changes — link read failed:', err);
    return { removedVenueIds: [], dissolved: false, hostTransferredTo: null };
  }

  for (const member of toRemove) {
    await admin
      .from('venue_collective_members')
      .update({ status: 'removed', left_at: new Date().toISOString() })
      .eq('id', member.id);
    removedVenueIds.push(member.venueId);
  }

  const survivors = active.filter((m) => !removedVenueIds.includes(m.venueId));
  if (survivors.length < 2) {
    await admin
      .from('venue_collectives')
      .update({ status: 'dissolved', slug: dissolvedCollectiveSlug(collectiveId) })
      .eq('id', collectiveId);
    // No catalogue cleanup needed on dissolve: `status='dissolved'` takes the
    // page offline, and the overrides are collective-scoped so every venue's own
    // services are already pristine (plan §8.3, the non-destructive guarantee).
    return { removedVenueIds, dissolved: true, hostTransferredTo: null };
  }

  // §7.4 — the host must always be an active member. If the cascade removed the
  // host (or it was already orphaned by an earlier reconcile), transfer hosting
  // to the longest-tenured surviving member so the collective stays
  // administrable instead of orphaning. Idempotent: once the host is a valid
  // active member again, later reconciles leave it untouched.
  let hostTransferredTo: string | null = null;
  const hostStillActive = survivors.some((m) => m.venueId === collective.host_venue_id);
  if (!hostStillActive) {
    const newHostVenueId = selectReplacementHost(survivors);
    if (newHostVenueId) {
      await admin
        .from('venue_collectives')
        .update({ host_venue_id: newHostVenueId })
        .eq('id', collectiveId);
      hostTransferredTo = newHostVenueId;
    }
  }

  // plan §8.2 — for a combined page, re-evaluate provider bookability: suspend
  // (recoverably) the providers of any surviving member that no longer holds
  // full mutual write with all others, reactivate those that regained it, and
  // mark removed-member providers `removed`. Never touches member consent.
  if (collective.page_mode === 'unified_catalog') {
    // Best-effort + reversible: suspend/reactivate is recoverable on the next run, so a
    // transient link-read failure here must not propagate or change the dissolve outcome.
    try {
      await suspendOrRemoveCollectiveProviders(
        admin,
        collectiveId,
        survivors.map((m) => m.venueId),
        removedVenueIds,
      );
    } catch (err) {
      console.warn('[reconcileCollective] provider suspend ladder skipped — link read failed:', err);
    }
  }

  return { removedVenueIds, dissolved: false, hostTransferredTo };
}

/**
 * Apply the plan §8.2 provider suspend/resume/remove ladder for a unified
 * catalogue. Computes each surviving member's write-eligibility, then uses the
 * pure {@link planProviderStatuses} to decide the new `status` for every
 * non-removed provider and applies only the changes. Source data untouched.
 */
async function suspendOrRemoveCollectiveProviders(
  admin: SupabaseClient,
  collectiveId: string,
  survivorVenueIds: string[],
  removedVenueIds: string[],
): Promise<void> {
  const { data: itemRows } = await admin
    .from('collective_service_items')
    .select('id')
    .eq('collective_id', collectiveId);
  const itemIds = (itemRows ?? []).map((r) => r.id as string);
  if (itemIds.length === 0) return;

  const { data: providerRows } = await admin
    .from('collective_service_providers')
    .select('id, venue_id, status')
    .in('item_id', itemIds)
    .neq('status', 'removed');
  const providers = (providerRows ?? []).map((p) => ({
    id: p.id as string,
    venueId: p.venue_id as string,
    status: p.status as ProviderStatus,
  }));
  if (providers.length === 0) return;

  const writeOkByVenue: Record<string, boolean> = {};
  for (const venueId of survivorVenueIds) {
    const others = survivorVenueIds.filter((v) => v !== venueId);
    writeOkByVenue[venueId] = await hasFullMutualWriteLinks(admin, venueId, others);
  }

  const changes = planProviderStatuses(providers, removedVenueIds, writeOkByVenue);
  // Group by target status so each distinct status is one UPDATE.
  const byStatus = new Map<ProviderStatus, string[]>();
  for (const c of changes) {
    const ids = byStatus.get(c.status) ?? [];
    ids.push(c.id);
    byStatus.set(c.status, ids);
  }
  for (const [status, ids] of byStatus) {
    await admin.from('collective_service_providers').update({ status }).in('id', ids);
  }
}

/**
 * Re-evaluate every collective that could be affected by a pairwise-link change
 * touching `venueIds` (§7.5). A broken or reduced link between two collective
 * members must auto-remove them and may dissolve the collective. Notifies
 * removed venues and — on dissolution — the remaining members. Safe to call
 * from any link-change path (unlink, reduce, accepted-change, the maintenance
 * cron); failures are logged and never thrown.
 */
export async function reconcileCollectivesAfterLinkChange(
  admin: SupabaseClient,
  venueIds: string[],
): Promise<void> {
  const ids = [...new Set(venueIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .in('venue_id', ids)
    .eq('status', 'active');
  const collectiveIds = [
    ...new Set((memberRows ?? []).map((m) => m.collective_id as string)),
  ];

  for (const collectiveId of collectiveIds) {
    try {
      // Snapshot the active membership and name before reconcile so we know
      // who to notify afterwards.
      const [{ data: beforeRows }, { data: collectiveRow }] = await Promise.all([
        admin
          .from('venue_collective_members')
          .select('venue_id')
          .eq('collective_id', collectiveId)
          .eq('status', 'active'),
        admin
          .from('venue_collectives')
          .select('name')
          .eq('id', collectiveId)
          .maybeSingle(),
      ]);
      const beforeVenues = (beforeRows ?? []).map((m) => m.venue_id as string);
      const collectiveName = (collectiveRow?.name as string) ?? 'a venue collective';

      const { removedVenueIds, dissolved, hostTransferredTo } = await reconcileCollective(
        admin,
        collectiveId,
      );
      if (removedVenueIds.length === 0 && !dissolved && !hostTransferredTo) continue;

      await Promise.allSettled(
        removedVenueIds.map((v) => notifyCollectiveRemoval(admin, v, collectiveName)),
      );
      if (dissolved) {
        const remaining = beforeVenues.filter((v) => !removedVenueIds.includes(v));
        await Promise.allSettled(
          remaining.map((v) => notifyCollectiveDissolved(admin, v, collectiveName)),
        );
      } else if (hostTransferredTo) {
        // §7.4 — the new host inherited hosting automatically; let them know.
        await notifyCollectiveHostTransferred(admin, hostTransferredTo, collectiveName);
      }
    } catch (err) {
      console.error(
        '[linked-accounts] reconcileCollectivesAfterLinkChange failed:',
        collectiveId,
        err,
      );
    }
  }
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
  id: string;
  name: string;
  slug: string;
  branding: CollectiveBranding;
  serviceGrouping: ServiceGrouping;
  allowAnyPractitioner: boolean;
  pageMode: PageMode;
  members: PublicCollectiveMember[];
}

/**
 * Load a collective's display branding by slug regardless of live status, so the
 * public page can show a branded "not available" state (§19.3) for a slug that
 * exists but isn't currently bookable — distinct from a true 404.
 */
export async function loadCollectiveBrandingBySlug(
  admin: SupabaseClient,
  slug: string,
): Promise<{ name: string; branding: CollectiveBranding; status: CollectiveStatus } | null> {
  const { data } = await admin
    .from('venue_collectives')
    .select('name, branding, status, booking_page_config')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (!data) return null;
  const branding = (data.branding as CollectiveBranding) ?? {};
  // Unified colour source (plan §23): prefer the page config's brand colour so the
  // branded "unavailable" state matches the live page.
  const brandPrimary =
    ((data.booking_page_config as { brand_primary?: string | null } | null)?.brand_primary) ??
    branding.primary_colour ??
    null;
  return {
    name: (data.name as string) ?? 'Venue collective',
    branding: { ...branding, primary_colour: brandPrimary },
    status: data.status as CollectiveStatus,
  };
}

/** Read-only count of a collective's active members that are *currently eligible*
 * (Appointments-family, active plan — §7.2/§16.1 #3). No reconcile/write. */
async function countEligibleActiveMembers(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<number> {
  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const venueIds = (memberRows ?? []).map((m) => m.venue_id as string);
  if (venueIds.length < 2) return venueIds.length;
  const { data: venues } = await admin
    .from('venues')
    .select(
      'id, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
    )
    .in('id', venueIds);
  let eligible = 0;
  for (const v of venues ?? []) {
    if (
      evaluateLinkEligibility({
        pricing_tier: (v.pricing_tier as string | null) ?? null,
        plan_status: (v.plan_status as string | null) ?? null,
        booking_model: (v.booking_model as string | null) ?? null,
        subscription_current_period_end:
          (v.subscription_current_period_end as string | null) ?? null,
        billing_access_source: (v.billing_access_source as string | null) ?? null,
      }).canCreate
    ) {
      eligible += 1;
    }
  }
  return eligible;
}

/**
 * §8.6 — the live collective a venue is an active member of, for the
 * fully-booked cross-suggestion on its own booking page. Returns the first
 * collective this venue actively belongs to (or hosts) that will actually render
 * live — i.e. ≥2 *eligible* active members, matching `loadPublicCollective`'s
 * gate — so the CTA never lands on the branded "unavailable" page. Read-only
 * (no reconcile). Collective-scoped only; pairwise links never produce a
 * suggestion. Returns the slug + name needed to link to `/book/c/{slug}`.
 */
export async function loadActiveCollectiveForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ slug: string; name: string } | null> {
  const views = await loadCollectiveViewsForVenue(admin, venueId);
  const candidates = views.filter(
    (v) =>
      v.status === 'active' &&
      v.activeMemberCount >= 2 &&
      (v.myMembershipStatus === 'active' || v.hostVenueId === venueId),
  );
  for (const c of candidates) {
    if ((await countEligibleActiveMembers(admin, c.id)) >= 2) {
      return { slug: c.slug, name: c.name };
    }
  }
  return null;
}

/**
 * Combined-page booking links to show in the dashboard sidebar (plan §23): for
 * each active `unified_catalog` collective the venue actively belongs to, the
 * public URL of the combined page. Dedicated-address collectives link to
 * `/book/c/{slug}`; an adopt-a-member-slug collective links to that member's
 * `/book/{slug}` — except when it adopted THIS venue's own slug, which the
 * sidebar already shows as "Your Booking Page" (skipped to avoid a duplicate).
 */
export async function loadCollectiveBookingLinksForVenue(
  admin: SupabaseClient,
  venueId: string,
): Promise<{ id: string; name: string; url: string }[]> {
  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'active');
  const ids = [...new Set((memberRows ?? []).map((m) => m.collective_id as string))];
  if (ids.length === 0) return [];

  const { data: cols } = await admin
    .from('venue_collectives')
    .select('id, name, slug, slug_strategy, adopted_venue_id')
    .in('id', ids)
    .eq('status', 'active')
    .eq('page_mode', 'unified_catalog');

  const out: { id: string; name: string; url: string }[] = [];
  for (const c of cols ?? []) {
    const name = (c.name as string) ?? 'Combined booking page';
    if ((c.slug_strategy as string) === 'adopt_member' && c.adopted_venue_id) {
      if ((c.adopted_venue_id as string) === venueId) continue; // already shown as the venue's own page
      const { data: adopted } = await admin
        .from('venues')
        .select('slug')
        .eq('id', c.adopted_venue_id as string)
        .maybeSingle();
      if (adopted?.slug) out.push({ id: c.id as string, name, url: `/book/${adopted.slug as string}` });
    } else {
      out.push({ id: c.id as string, name, url: `/book/c/${c.slug as string}` });
    }
  }
  return out;
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
    .select(
      'id, name, slug, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
    )
    .in('id', venueIds);
  const venueLookup: Record<string, { name: string; slug: string; eligible: boolean }> = {};
  for (const v of venues ?? []) {
    venueLookup[v.id as string] = {
      name: (v.name as string) ?? 'Venue',
      slug: (v.slug as string) ?? '',
      eligible: evaluateLinkEligibility({
        pricing_tier: (v.pricing_tier as string | null) ?? null,
        plan_status: (v.plan_status as string | null) ?? null,
        booking_model: (v.booking_model as string | null) ?? null,
        subscription_current_period_end:
          (v.subscription_current_period_end as string | null) ?? null,
        billing_access_source: (v.billing_access_source as string | null) ?? null,
      }).canCreate,
    };
  }

  // §7.2 / §16.1 #3 — a member whose subscription has lapsed or which has moved
  // to an ineligible product must not appear on the public page, even in the
  // window before the daily cron suspends the underlying pairwise link. Exclude
  // such members from the rendered page rather than removing them from the
  // collective, so they reappear automatically once eligibility is restored
  // (mirroring the link suspend/resume model). Terminal removal still happens via
  // the §7.5 link cascade when the link itself ends.
  const eligibleMembers = activeMembers.filter(
    (m) => venueLookup[m.venue_id as string]?.eligible,
  );
  if (eligibleMembers.length < 2) return null;

  const members: PublicCollectiveMember[] = [];
  for (const m of eligibleMembers) {
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
    id: collective.id,
    name: collective.name,
    slug: collective.slug,
    branding: collective.branding ?? {},
    serviceGrouping: collective.service_grouping,
    allowAnyPractitioner: collective.allow_any_practitioner,
    pageMode: collective.page_mode ?? 'directory',
    members,
  };
}
