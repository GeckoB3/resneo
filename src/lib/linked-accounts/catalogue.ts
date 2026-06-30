/**
 * Unified service catalogue for combined booking pages (plan §4.3/§4.4, §6, §7.3).
 *
 * The host curates `collective_service_items` (merged offerings) and assigns
 * `collective_service_providers` (which calendars across member venues provide
 * each), with collective-scoped price/duration overrides the owning member
 * approves (plan D6). Everything here is collective-scoped — no source service is
 * ever mutated — so a broken link splits the catalogue cleanly (plan D5/§8).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasFullMutualWriteLinks,
  type PageMode,
  type PricingDisplay,
  type ProviderStatus,
  type ItemStatus,
  type ServiceGrouping,
} from './collectives';
import { evaluateLinkEligibility } from './eligibility';
import { fetchAppointmentCatalog } from '@/lib/availability/appointment-catalog';

/**
 * A venue's bookable catalogue, resolved MODEL-AGNOSTICALLY (plan §16 follow-up).
 * Reuses `fetchAppointmentCatalog`, which normalises both the legacy
 * practitioner_appointment model (practitioners + appointment_services) AND the
 * unified_scheduling model (unified_calendars + service_items) into one shape —
 * so the combined catalogue works for the venues that actually exist. "Service"
 * ids are appointment_service / service_item ids; "calendar" ids are
 * practitioner / unified_calendar ids, exactly what the booking create route
 * expects (it maps them per model).
 */
export interface VenueCatalogueData {
  /** serviceId → name/duration/price (deduped across calendars). */
  services: Map<string, { name: string; durationMinutes: number | null; pricePence: number | null }>;
  /** calendarId → name. */
  calendars: Map<string, { name: string }>;
  /** serviceId → calendarIds that offer it (for the availability fan-out). */
  serviceCalendars: Map<string, string[]>;
  /** ordered list of services for the builder. */
  serviceList: { id: string; name: string; durationMinutes: number | null; pricePence: number | null }[];
  /** ordered list of calendars for the builder. */
  calendarList: { id: string; name: string }[];
}

export async function loadVenueCatalogueData(
  admin: SupabaseClient,
  venueId: string,
): Promise<VenueCatalogueData> {
  let practitioners: Awaited<ReturnType<typeof fetchAppointmentCatalog>>['practitioners'] = [];
  try {
    ({ practitioners } = await fetchAppointmentCatalog(admin, venueId));
  } catch {
    practitioners = [];
  }
  const services = new Map<string, { name: string; durationMinutes: number | null; pricePence: number | null }>();
  const calendars = new Map<string, { name: string }>();
  const serviceCalendars = new Map<string, string[]>();
  const serviceOrder: string[] = [];
  const calendarOrder: string[] = [];
  for (const p of practitioners) {
    if (!calendars.has(p.id)) {
      calendars.set(p.id, { name: p.name });
      calendarOrder.push(p.id);
    }
    for (const s of p.services) {
      if (!services.has(s.id)) {
        services.set(s.id, {
          name: s.name,
          durationMinutes: s.duration_minutes ?? null,
          pricePence: s.price_pence ?? null,
        });
        serviceOrder.push(s.id);
      }
      const cals = serviceCalendars.get(s.id) ?? [];
      if (!cals.includes(p.id)) cals.push(p.id);
      serviceCalendars.set(s.id, cals);
    }
  }
  return {
    services,
    calendars,
    serviceCalendars,
    serviceList: serviceOrder.map((id) => ({ id, ...services.get(id)! })),
    calendarList: calendarOrder.map((id) => ({ id, name: calendars.get(id)!.name })),
  };
}

// ---------------------------------------------------------------------------
// Service-name normaliser (pure) — used to match a same-named service when a
// calendar is assigned cross-venue (D1 duplication reuse in service-duplication.ts)
// and to avoid duplicate offerings in the "Choose services to offer" picker.
// ---------------------------------------------------------------------------

/**
 * Normalise a service name for same-name matching: lowercase, strip a trailing
 * duration token ("60 min", "(45 mins)", "- 1 hr"), drop punctuation, and
 * collapse whitespace. Pure and deterministic. Two services that normalise to
 * the same key are treated as the same offering.
 */
export function normaliseServiceNameForMerge(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics (combining marks)
    .replace(/\(.*?\)/g, ' ') // drop parenthetical asides ("(60 min)")
    .replace(/\b\d+\s*(?:min(?:ute)?s?|hrs?|hours?)\b/g, ' ') // drop duration tokens
    .replace(/[^a-z0-9]+/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Combined-page eligibility (plan D4 write gate + D8 single timezone)
// ---------------------------------------------------------------------------

export interface CombinedEligibilityResult {
  ok: boolean;
  reason: string | null;
  /** The single shared timezone, when all members agree (else null). */
  timezone: string | null;
}

/**
 * Whether a set of member venues may run a combined (unified_catalog) page:
 * every pair must hold full mutual create/edit/cancel access (plan D4, via
 * {@link hasFullMutualWriteLinks}) and all members must share one timezone
 * (plan D8). Used to gate upgrade and to validate it stays satisfiable.
 */
export async function checkCombinedEligibility(
  admin: SupabaseClient,
  memberVenueIds: string[],
): Promise<CombinedEligibilityResult> {
  const ids = [...new Set(memberVenueIds.filter(Boolean))];
  if (ids.length < 2) {
    return { ok: false, reason: 'A combined page needs at least two active members.', timezone: null };
  }
  for (const venueId of ids) {
    const others = ids.filter((v) => v !== venueId);
    if (!(await hasFullMutualWriteLinks(admin, venueId, others))) {
      return {
        ok: false,
        reason:
          'Every member must grant full create, edit and cancel access (full calendar detail, no calendar limits) to every other member before a combined page can go live.',
        timezone: null,
      };
    }
  }
  const { data: venues } = await admin.from('venues').select('id, timezone').in('id', ids);
  const tzs = new Set((venues ?? []).map((v) => ((v.timezone as string | null) ?? 'Europe/London')));
  if (tzs.size > 1) {
    return {
      ok: false,
      reason: 'All members must share the same timezone to run a combined page.',
      timezone: null,
    };
  }
  return { ok: true, reason: null, timezone: [...tzs][0] ?? null };
}


// ---------------------------------------------------------------------------
// Management (builder) view of the catalogue
// ---------------------------------------------------------------------------

export interface CatalogueProviderView {
  id: string;
  itemId: string;
  venueId: string;
  venueName: string;
  sourceServiceId: string;
  sourceServiceName: string | null;
  practitionerId: string | null;
  practitionerName: string | null;
  /** The owning venue's own service price/duration (set on /dashboard/appointment-services). */
  effectivePricePence: number | null;
  effectiveDurationMinutes: number | null;
  status: ProviderStatus;
  /** Whether the underlying source service (and practitioner, if pinned) is still live. */
  sourceLive: boolean;
}

export interface CatalogueItemView {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  displayOrder: number;
  defaultDurationMinutes: number | null;
  defaultPricePence: number | null;
  pricingDisplay: PricingDisplay;
  allowAnyAvailable: boolean;
  status: ItemStatus;
  providers: CatalogueProviderView[];
}

export interface CatalogueMemberSource {
  venueId: string;
  venueName: string;
  services: { id: string; name: string; durationMinutes: number | null; pricePence: number | null }[];
  /** Each calendar + the services it offers (for cross-venue carrier-service mapping). */
  practitioners: { id: string; name: string; services: { id: string; name: string }[] }[];
}

export interface CatalogueManagementView {
  collectiveId: string;
  pageMode: PageMode;
  items: CatalogueItemView[];
  memberSources: CatalogueMemberSource[];
}

interface SourceServiceRecord {
  name: string;
  durationMinutes: number | null;
  pricePence: number | null;
  active: boolean;
}

/**
 * Heal legacy venue-wide providers (`practitioner_id IS NULL`, created before the
 * per-calendar model) by expanding each into one per-calendar provider for every
 * calendar that offers its source service, then retiring the null row. This keeps the
 * management UI's per-calendar checkboxes accurate (a null provider was invisible to
 * them, so calendars showed unchecked even though the service was bookable). Idempotent
 * and self-healing: once expanded, repeat runs find nothing and return cheaply.
 */
export async function backfillPerCalendarProviders(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<void> {
  const { data: items } = await admin
    .from('collective_service_items')
    .select('id')
    .eq('collective_id', collectiveId);
  const itemIds = (items ?? []).map((i) => i.id as string);
  if (itemIds.length === 0) return;

  const { data: nullProviders } = await admin
    .from('collective_service_providers')
    .select(
      'id, item_id, member_id, venue_id, source_service_id, price_pence_override, duration_minutes_override, approval_status, approved_by_user_id, status',
    )
    .in('item_id', itemIds)
    .is('practitioner_id', null)
    .neq('status', 'removed');
  if (!nullProviders || nullProviders.length === 0) return;

  const cache = new Map<string, VenueCatalogueData>();
  for (const np of nullProviders) {
    const venueId = np.venue_id as string;
    let data = cache.get(venueId);
    if (!data) {
      data = await loadVenueCatalogueData(admin, venueId);
      cache.set(venueId, data);
    }
    const calIds = data.serviceCalendars.get(np.source_service_id as string) ?? [];
    if (calIds.length === 0) continue; // nothing offers it — leave the row untouched

    for (const calId of calIds) {
      const { data: existing } = await admin
        .from('collective_service_providers')
        .select('id')
        .eq('item_id', np.item_id as string)
        .eq('venue_id', venueId)
        .eq('source_service_id', np.source_service_id as string)
        .eq('practitioner_id', calId)
        .maybeSingle();
      if (existing) continue;
      await admin.from('collective_service_providers').insert({
        item_id: np.item_id,
        member_id: np.member_id,
        venue_id: venueId,
        source_service_id: np.source_service_id,
        practitioner_id: calId,
        price_pence_override: np.price_pence_override ?? null,
        duration_minutes_override: np.duration_minutes_override ?? null,
        approval_status: np.approval_status,
        approved_by_user_id: np.approved_by_user_id ?? null,
        status: np.status,
      });
    }
    await admin
      .from('collective_service_providers')
      .update({ status: 'removed' })
      .eq('id', np.id as string);
  }
}

/**
 * Load the full builder dataset for a collective's catalogue: every item with
 * its providers (effective price/duration resolved), each member's active
 * source services + practitioners (to add providers from), and cross-venue
 * merge suggestions. Read-only.
 */
export async function loadCatalogueForManagement(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<CatalogueManagementView | null> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, page_mode')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective) return null;

  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('venue_id, display_order')
    .eq('collective_id', collectiveId)
    .eq('status', 'active')
    .order('display_order', { ascending: true });
  const memberVenueIds = (memberRows ?? []).map((m) => m.venue_id as string);

  // Venue names.
  const venueNames: Record<string, string> = {};
  if (memberVenueIds.length > 0) {
    const { data: venues } = await admin
      .from('venues')
      .select('id, name')
      .in('id', memberVenueIds);
    for (const v of venues ?? []) venueNames[v.id as string] = (v.name as string) ?? 'Venue';
  }

  // Per-member source services + calendars (model-agnostic — works for both the
  // legacy practitioner_appointment and the unified_scheduling models).
  const memberSources: CatalogueMemberSource[] = [];
  const serviceIndex = new Map<string, SourceServiceRecord>(); // `${venueId}:${serviceId}`
  const practitionerNameById = new Map<string, string>(); // `${venueId}:${calendarId}`
  for (const venueId of memberVenueIds) {
    const data = await loadVenueCatalogueData(admin, venueId);
    for (const s of data.serviceList) {
      serviceIndex.set(`${venueId}:${s.id}`, {
        name: s.name,
        durationMinutes: s.durationMinutes,
        pricePence: s.pricePence,
        active: true,
      });
    }
    for (const c of data.calendarList) practitionerNameById.set(`${venueId}:${c.id}`, c.name);
    // Per-calendar offered services (invert serviceCalendars) for carrier mapping.
    const calendarServices = new Map<string, { id: string; name: string }[]>();
    for (const [serviceId, calIds] of data.serviceCalendars) {
      const svcName = data.services.get(serviceId)?.name ?? 'Service';
      for (const calId of calIds) {
        const arr = calendarServices.get(calId) ?? [];
        arr.push({ id: serviceId, name: svcName });
        calendarServices.set(calId, arr);
      }
    }
    memberSources.push({
      venueId,
      venueName: venueNames[venueId] ?? 'Venue',
      services: data.serviceList,
      practitioners: data.calendarList.map((c) => ({
        id: c.id,
        name: c.name,
        services: calendarServices.get(c.id) ?? [],
      })),
    });
  }

  // Items + providers.
  const { data: itemRows } = await admin
    .from('collective_service_items')
    .select(
      'id, name, description, category, image_url, display_order, default_duration_minutes, default_price_pence, pricing_display, allow_any_available, status',
    )
    .eq('collective_id', collectiveId)
    .order('display_order', { ascending: true });
  const items = (itemRows ?? []) as Array<Record<string, unknown>>;
  const itemIds = items.map((i) => i.id as string);

  const providersByItem = new Map<string, CatalogueProviderView[]>();
  if (itemIds.length > 0) {
    const { data: providerRows } = await admin
      .from('collective_service_providers')
      .select('id, item_id, venue_id, source_service_id, practitioner_id, status')
      .in('item_id', itemIds)
      .neq('status', 'removed');
    for (const raw of providerRows ?? []) {
      const itemId = raw.item_id as string;
      const venueId = raw.venue_id as string;
      const sourceServiceId = raw.source_service_id as string;
      const source = serviceIndex.get(`${venueId}:${sourceServiceId}`);
      const practitionerId = (raw.practitioner_id as string | null) ?? null;
      const view: CatalogueProviderView = {
        id: raw.id as string,
        itemId,
        venueId,
        venueName: venueNames[venueId] ?? 'Venue',
        sourceServiceId,
        sourceServiceName: source?.name ?? null,
        practitionerId,
        practitionerName: practitionerId
          ? practitionerNameById.get(`${venueId}:${practitionerId}`) ?? null
          : null,
        // Each venue owns its service's price/duration (set on /dashboard/appointment-services);
        // the combined page never overrides them — it just maps service names → calendars.
        effectivePricePence: source?.pricePence ?? null,
        effectiveDurationMinutes: source?.durationMinutes ?? null,
        status: raw.status as ProviderStatus,
        // Source live = service still active, and (if pinned) practitioner still active.
        sourceLive:
          Boolean(source?.active) &&
          (practitionerId ? practitionerNameById.has(`${venueId}:${practitionerId}`) : true),
      };
      const list = providersByItem.get(itemId) ?? [];
      list.push(view);
      providersByItem.set(itemId, list);
    }
  }

  const itemViews: CatalogueItemView[] = items.map((i) => ({
    id: i.id as string,
    name: (i.name as string) ?? 'Service',
    description: (i.description as string | null) ?? null,
    category: (i.category as string | null) ?? null,
    imageUrl: (i.image_url as string | null) ?? null,
    displayOrder: (i.display_order as number) ?? 0,
    defaultDurationMinutes: (i.default_duration_minutes as number | null) ?? null,
    defaultPricePence: (i.default_price_pence as number | null) ?? null,
    pricingDisplay: (i.pricing_display as PricingDisplay) ?? 'from',
    allowAnyAvailable: (i.allow_any_available as boolean) ?? true,
    status: (i.status as ItemStatus) ?? 'active',
    providers: providersByItem.get(i.id as string) ?? [],
  }));

  return {
    collectiveId,
    pageMode: (collective.page_mode as PageMode) ?? 'directory',
    items: itemViews,
    memberSources,
  };
}

// ---------------------------------------------------------------------------
// Slug routing for combined pages (plan §5 / D1, D2)
// ---------------------------------------------------------------------------

export interface CombinedSlugClaim {
  /** 'adopt' = serve the combined page here; 'redirect' = send the customer to it. */
  kind: 'adopt' | 'redirect';
  /** The collective's own (/book/c/{slug}) slug — what to render for an adopt claim. */
  collectiveSlug: string;
  /** For a redirect claim, the public URL to send the customer to. */
  redirectTo: string | null;
}

/**
 * Does a live combined collective claim this VENUE slug (plan §5.2)?
 *   - `adopt`   — a combined collective adopted this venue's booking address, so
 *                 `/book/{slug}` should serve the combined page.
 *   - `redirect`— this venue is an active member that chose to redirect its solo
 *                 page to the combined one.
 * Returns null otherwise (ordinary venue page). Only live `unified_catalog`
 * collectives claim a slug, so a dissolved/paused combined page automatically
 * frees the slug back to the venue's own page.
 */
export async function resolveCombinedSlugClaim(
  admin: SupabaseClient,
  venueSlug: string,
): Promise<CombinedSlugClaim | null> {
  const { data: venue } = await admin
    .from('venues')
    .select('id')
    .eq('slug', venueSlug)
    .maybeSingle();
  if (!venue) return null;
  const venueId = venue.id as string;

  // Adopt: a live combined collective serves its page at this venue's slug.
  const { data: adopt } = await admin
    .from('venue_collectives')
    .select('slug')
    .eq('adopted_venue_id', venueId)
    .eq('status', 'active')
    .eq('page_mode', 'unified_catalog')
    .maybeSingle();
  if (adopt) {
    return { kind: 'adopt', collectiveSlug: adopt.slug as string, redirectTo: null };
  }

  // Redirect: this venue is an active member that opted to redirect its solo page.
  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('collective_id')
    .eq('venue_id', venueId)
    .eq('status', 'active')
    .eq('solo_page_behavior', 'redirect');
  for (const m of memberRows ?? []) {
    const { data: col } = await admin
      .from('venue_collectives')
      .select('slug, adopted_venue_id')
      .eq('id', m.collective_id as string)
      .eq('status', 'active')
      .eq('page_mode', 'unified_catalog')
      .maybeSingle();
    if (!col) continue;
    let redirectTo = `/book/c/${col.slug as string}`;
    if (col.adopted_venue_id) {
      const { data: adoptedVenue } = await admin
        .from('venues')
        .select('slug')
        .eq('id', col.adopted_venue_id as string)
        .maybeSingle();
      if (adoptedVenue?.slug) redirectTo = `/book/${adoptedVenue.slug as string}`;
    }
    return { kind: 'redirect', collectiveSlug: col.slug as string, redirectTo };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public (customer-facing) combined catalogue
// ---------------------------------------------------------------------------

export interface PublicCatalogueProvider {
  providerId: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  practitionerId: string | null;
  practitionerName: string | null;
  sourceServiceId: string;
  /** Effective price/duration the customer sees and is charged against. */
  pricePence: number | null;
  durationMinutes: number | null;
}

export interface PublicCatalogueItem {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  pricingDisplay: PricingDisplay;
  allowAnyAvailable: boolean;
  /** Lowest effective price across bookable providers (for the "from" display). */
  fromPricePence: number | null;
  providers: PublicCatalogueProvider[];
}

export interface PublicCombinedCatalogue {
  serviceGrouping: ServiceGrouping;
  items: PublicCatalogueItem[];
}

/**
 * Build the customer-facing combined catalogue for a live `unified_catalog`
 * collective: active offerings, each with its BOOKABLE providers (status active,
 * member-approved, the member currently eligible, and the source service +
 * pinned practitioner still live), with effective price/duration resolved.
 * Offerings with no bookable provider are dropped. Read-only.
 */
export async function loadPublicCombinedCatalogue(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<PublicCombinedCatalogue | null> {
  const { data: collective } = await admin
    .from('venue_collectives')
    .select('id, status, page_mode, service_grouping')
    .eq('id', collectiveId)
    .maybeSingle();
  if (!collective || collective.status !== 'active' || collective.page_mode !== 'unified_catalog') {
    return null;
  }

  const { data: memberRows } = await admin
    .from('venue_collective_members')
    .select('venue_id')
    .eq('collective_id', collectiveId)
    .eq('status', 'active');
  const memberVenueIds = (memberRows ?? []).map((m) => m.venue_id as string);
  if (memberVenueIds.length === 0) return { serviceGrouping: collective.service_grouping as ServiceGrouping, items: [] };

  // Eligible venues (Appointments-family, active plan) + name/slug.
  const { data: venues } = await admin
    .from('venues')
    .select(
      'id, name, slug, pricing_tier, plan_status, booking_model, subscription_current_period_end, billing_access_source',
    )
    .in('id', memberVenueIds);
  const venueInfo: Record<string, { name: string; slug: string; eligible: boolean }> = {};
  for (const v of venues ?? []) {
    venueInfo[v.id as string] = {
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
  const eligibleVenueIds = memberVenueIds.filter((id) => venueInfo[id]?.eligible);
  if (eligibleVenueIds.length === 0) {
    return { serviceGrouping: collective.service_grouping as ServiceGrouping, items: [] };
  }

  // Source services + calendars per eligible venue (model-agnostic).
  const serviceIndex = new Map<string, { durationMinutes: number | null; pricePence: number | null }>();
  const practitioner = new Map<string, { name: string }>();
  for (const venueId of eligibleVenueIds) {
    const data = await loadVenueCatalogueData(admin, venueId);
    for (const [id, s] of data.services) {
      serviceIndex.set(`${venueId}:${id}`, { durationMinutes: s.durationMinutes, pricePence: s.pricePence });
    }
    for (const [id, c] of data.calendars) {
      practitioner.set(`${venueId}:${id}`, { name: c.name });
    }
  }

  // Active offerings + bookable providers.
  const { data: itemRows } = await admin
    .from('collective_service_items')
    .select(
      'id, name, description, category, image_url, display_order, default_duration_minutes, default_price_pence, pricing_display, allow_any_available',
    )
    .eq('collective_id', collectiveId)
    .eq('status', 'active')
    .order('display_order', { ascending: true });
  const items = (itemRows ?? []) as Array<Record<string, unknown>>;
  const itemIds = items.map((i) => i.id as string);

  const providersByItem = new Map<string, PublicCatalogueProvider[]>();
  if (itemIds.length > 0) {
    const { data: providerRows } = await admin
      .from('collective_service_providers')
      // Host-curated: every active provider is live (no per-service consent step) —
      // a member consents by joining the collective.
      .select('id, item_id, venue_id, source_service_id, practitioner_id')
      .in('item_id', itemIds)
      .eq('status', 'active')
      .in('venue_id', eligibleVenueIds);
    for (const raw of providerRows ?? []) {
      const venueId = raw.venue_id as string;
      const venue = venueInfo[venueId];
      if (!venue?.eligible) continue;
      const sourceServiceId = raw.source_service_id as string;
      const source = serviceIndex.get(`${venueId}:${sourceServiceId}`);
      if (!source) continue; // source service inactive/removed → not bookable
      const practitionerId = (raw.practitioner_id as string | null) ?? null;
      let practName: string | null = null;
      if (practitionerId) {
        const pr = practitioner.get(`${venueId}:${practitionerId}`);
        if (!pr) continue; // pinned calendar inactive/removed → not bookable
        practName = pr.name;
      }
      const itemId = raw.item_id as string;
      const view: PublicCatalogueProvider = {
        providerId: raw.id as string,
        venueId,
        venueName: venue.name,
        venueSlug: venue.slug,
        practitionerId,
        practitionerName: practName,
        sourceServiceId,
        // Price/duration are the owning venue's own service settings — never a
        // collective-level override. "from" price = the lowest of these across calendars.
        pricePence: source.pricePence,
        durationMinutes: source.durationMinutes,
      };
      const list = providersByItem.get(itemId) ?? [];
      list.push(view);
      providersByItem.set(itemId, list);
    }
  }

  const publicItems: PublicCatalogueItem[] = [];
  for (const i of items) {
    const providers = providersByItem.get(i.id as string) ?? [];
    if (providers.length === 0) continue; // nothing bookable → hide the offering
    const prices = providers.map((p) => p.pricePence).filter((p): p is number => p != null);
    publicItems.push({
      id: i.id as string,
      name: (i.name as string) ?? 'Service',
      description: (i.description as string | null) ?? null,
      category: (i.category as string | null) ?? null,
      imageUrl: (i.image_url as string | null) ?? null,
      pricingDisplay: (i.pricing_display as PricingDisplay) ?? 'from',
      allowAnyAvailable: (i.allow_any_available as boolean) ?? true,
      fromPricePence: prices.length > 0 ? Math.min(...prices) : null,
      providers,
    });
  }

  return { serviceGrouping: collective.service_grouping as ServiceGrouping, items: publicItems };
}
