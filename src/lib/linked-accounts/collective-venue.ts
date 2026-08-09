/**
 * The collective as a "virtual venue" (plan §22). Builds a synthetic
 * `VenuePublic` and a merged appointment catalogue/team so the STANDARD
 * single-venue booking stack (`BookPublicLayout` + `AppointmentBookingFlow`)
 * can render a combined booking page that looks like one venue.
 *
 * Services on the merged page are the host-curated OFFERINGS
 * (`collective_service_items`, deduped across venues), priced/durated by the
 * effective (overridden) values. "Staff" are the union of provider calendars
 * across member venues. Each catalogue entry carries the routing metadata
 * (`owning_venue_id`, `source_service_id`) the booking create needs to write the
 * row into the correct owning venue with the override applied.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { VenuePublic } from '@/components/booking/types';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { BookingPagePublicService } from '@/lib/booking/booking-page-tabs';
import { loadPublicCombinedCatalogue, loadVenueCatalogueData } from './catalogue';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlags } from '@/lib/feature-flags';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { loadVariantsForServices } from '@/lib/venue/service-variants';
import { variantToCatalog, type AppointmentCatalogVariant } from '@/lib/availability/appointment-catalog';
import { loadAddonGroupsForServices } from '@/lib/addons/addon-resolution';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import { entityBookingWindowFromRow } from '@/lib/booking/entity-booking-window';
import type {
  AppointmentCatalogAddonGroup,
  ClassPaymentRequirement,
  ProcessingTimeBlock,
} from '@/types/booking-models';

interface CollectiveRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  timezone: string | null;
  branding: { logo_url?: string | null; primary_colour?: string | null; description?: string | null } | null;
  booking_page_config: BookingPageConfig | null;
  host_venue_id: string;
}

async function loadCollectiveRow(admin: SupabaseClient, collectiveId: string): Promise<CollectiveRow | null> {
  const { data } = await admin
    .from('venue_collectives')
    .select('id, name, slug, status, timezone, branding, booking_page_config, host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  return (data as CollectiveRow | null) ?? null;
}

/**
 * A synthetic `VenuePublic` representing the whole collective as one venue.
 * `booking_paused` is set when the combined page can't currently render
 * (fewer than 2 bookable offerings), so the standard layout shows its paused state.
 */
export async function loadCollectiveVenuePublic(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<VenuePublic | null> {
  const col = await loadCollectiveRow(admin, collectiveId);
  if (!col || col.status !== 'active') return null;

  // Inherit commercial/display defaults from the host venue. The combined page is
  // designed to look like one venue, so the header's address, phone, and website
  // come from the host too (matching the standard single-venue booking header).
  const { data: host } = await admin
    .from('venues')
    .select('currency, deposit_config, booking_rules, terminology, address, phone, website_url, feature_flags')
    .eq('id', col.host_venue_id)
    .maybeSingle();

  // The combined page works like one venue, so its "Any available" option and its
  // booking step order follow the host venue's own settings rather than being fixed.
  const hostFlags = resolveAppointmentsFeatureFlags(parseVenueFeatureFlags(host?.feature_flags));
  const hostAnyAvailablePractitioner = hostFlags.any_available_practitioner;
  const hostStaffFirstBookingFlow = hostFlags.staff_first_booking_flow;

  const branding = col.branding ?? {};
  const hostConfig = (col.booking_page_config ?? {}) as BookingPageConfig & { cover_photo_url?: string | null };

  // The page is bookable only when the merged catalogue has at least one offering.
  const catalogue = await loadPublicCombinedCatalogue(admin, collectiveId);
  const bookable = (catalogue?.items.length ?? 0) > 0;

  // Inherit staff bios/photos from each member venue's own team_profiles (keyed
  // by calendar id), then overlay the host's collective-level overrides (D-V2).
  const memberVenueIds = [
    ...new Set((catalogue?.items ?? []).flatMap((i) => i.providers.map((p) => p.venueId))),
  ];
  const inheritedTeamProfiles: Record<string, NonNullable<BookingPageConfig['team_profiles']>[string]> = {};
  if (memberVenueIds.length > 0) {
    const { data: memberRows } = await admin
      .from('venues')
      .select('booking_page_config')
      .in('id', memberVenueIds);
    for (const row of memberRows ?? []) {
      const tp = ((row.booking_page_config as BookingPageConfig | null) ?? {}).team_profiles ?? {};
      for (const [calendarId, profile] of Object.entries(tp)) {
        if (!inheritedTeamProfiles[calendarId]) inheritedTeamProfiles[calendarId] = profile;
      }
    }
  }
  const config: BookingPageConfig & { cover_photo_url?: string | null } = {
    ...hostConfig,
    team_profiles: { ...inheritedTeamProfiles, ...(hostConfig.team_profiles ?? {}) },
  };

  return {
    id: col.id,
    name: col.name,
    slug: col.slug,
    cover_photo_url: (config.cover_photo_url as string | null) ?? null,
    logo_url: branding.logo_url ?? null,
    address: (host?.address as string | null) ?? null,
    phone: (host?.phone as string | null) ?? null,
    website_url: (host?.website_url as string | null) ?? null,
    booking_page_config: config,
    deposit_config: (host?.deposit_config as VenuePublic['deposit_config']) ?? null,
    booking_rules: (host?.booking_rules as VenuePublic['booking_rules']) ?? null,
    opening_hours: null,
    timezone: col.timezone ?? 'Europe/London',
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling'],
    enabled_models: [],
    terminology: (host?.terminology as VenuePublic['terminology']) ?? undefined,
    currency: (host?.currency as string) ?? 'GBP',
    booking_paused: !bookable,
    is_collective: true,
    feature_flags: {
      resolved: {
        any_available_practitioner: hostAnyAvailablePractitioner,
        staff_first_booking_flow: hostStaffFirstBookingFlow,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Merged appointment catalogue (standard shape + routing metadata)
// ---------------------------------------------------------------------------

export interface CollectiveCatalogService {
  /** The OFFERING id (collective_service_items.id) — the customer-facing "service". */
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  /** The source service's own payment mode (card_hold degraded per the owning venue's flag). */
  payment_requirement: ClassPaymentRequirement;
  /**
   * Position of the offering in the combined catalogue (host display_order, then the
   * member venues' own service order); the booking flow picker sorts by this.
   */
  sort_order: number;
  /** The source service's own deposit-refund notice window (owning venue's setting). */
  cancellation_notice_hours: number;
  /** This calendar's OWN source-service variants/add-ons (each venue keeps its own). */
  variants: AppointmentCatalogVariant[];
  addon_groups: AppointmentCatalogAddonGroup[];
  processing_time_blocks?: ProcessingTimeBlock[];
  /**
   * Whether "any available" is offered for this offering: true only when NO provider
   * has variants/add-ons (a plain service everywhere), so the customer would get the
   * same thing regardless of calendar. Otherwise they must pick a specific calendar.
   */
  any_available: boolean;
  /** Routing: the real source service id in the owning venue (for booking create). */
  source_service_id: string;
}

export interface CollectiveCatalogPractitioner {
  /** A real calendar/practitioner id in a member venue. */
  id: string;
  name: string;
  /** Routing: the venue that owns this calendar (booking writes here). */
  owning_venue_id: string;
  /**
   * The owning venue's name. Not shown to guests directly: it orders the merged
   * list and qualifies duplicate names by folding itself into {@link name}.
   */
  owning_venue_name: string;
  services: CollectiveCatalogService[];
}

const DEFAULT_CANCELLATION_NOTICE_HOURS = 24;

/**
 * Build the merged catalogue in the standard `{ practitioners }` shape, expanded
 * to CONCRETE calendars (a venue-wide provider becomes one practitioner entry per
 * calendar that offers the source service). Each service is an offering; the
 * routing metadata lets the booking create resolve the owning venue + real service.
 */
export async function loadCollectiveAppointmentCatalog(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<{ practitioners: CollectiveCatalogPractitioner[] }> {
  const catalogue = await loadPublicCombinedCatalogue(admin, collectiveId);
  if (!catalogue || catalogue.items.length === 0) return { practitioners: [] };

  // Per-venue calendar names + which calendars offer each source service.
  const venueIds = [
    ...new Set(catalogue.items.flatMap((i) => i.providers.map((p) => p.venueId))),
  ];
  const venueData: Record<string, Awaited<ReturnType<typeof loadVenueCatalogueData>>> = {};
  await Promise.all(
    venueIds.map(async (venueId) => {
      venueData[venueId] = await loadVenueCatalogueData(admin, venueId);
    }),
  );

  // Each member venue keeps its OWN source-service settings. Load every involved source
  // service's variants / add-on groups / meta (buffer, deposit, processing) so the merged
  // catalogue carries the chosen calendar's real options — the calendar-first flow then
  // resolves them once the customer picks a calendar.
  const sourceIdsByVenue: Record<string, Set<string>> = {};
  for (const item of catalogue.items) {
    for (const p of item.providers) {
      (sourceIdsByVenue[p.venueId] ??= new Set<string>()).add(p.sourceServiceId);
    }
  }
  const { data: venueModelRows } = await admin
    .from('venues')
    .select('id, booking_model, feature_flags')
    .in('id', venueIds);
  const venueIsUnified: Record<string, boolean> = {};
  const venueCardHoldEnabled: Record<string, boolean> = {};
  for (const v of venueModelRows ?? []) {
    venueIsUnified[v.id as string] = isUnifiedSchedulingVenue((v.booking_model as string) ?? '');
    venueCardHoldEnabled[v.id as string] = resolveAppointmentsFeatureFlags(
      parseVenueFeatureFlags((v as { feature_flags?: unknown }).feature_flags),
    ).card_hold_deposits;
  }
  type VariantMap = Awaited<ReturnType<typeof loadVariantsForServices>>;
  type AddonMap = Awaited<ReturnType<typeof loadAddonGroupsForServices>>;
  const variantsByVenue: Record<string, VariantMap> = {};
  const addonsByVenue: Record<string, AddonMap> = {};
  const metaByVenue: Record<
    string,
    Map<
      string,
      {
        buffer: number;
        deposit: number | null;
        processing: ProcessingTimeBlock[];
        paymentRequirement: ClassPaymentRequirement;
        cancellationNoticeHours: number;
      }
    >
  > = {};
  await Promise.all(
    venueIds.map(async (venueId) => {
      const ids = [...(sourceIdsByVenue[venueId] ?? [])];
      variantsByVenue[venueId] = new Map();
      addonsByVenue[venueId] = new Map();
      metaByVenue[venueId] = new Map();
      if (ids.length === 0) return;
      const schema = venueIsUnified[venueId] ? 'service_item' : 'appointment_service';
      const [variantMap, addonMap, metaRows] = await Promise.all([
        loadVariantsForServices({ admin, venueId, schema, parentIds: ids }),
        loadAddonGroupsForServices({ admin, venueId, schema, parentIds: ids, includeHidden: false, includeInactive: false }),
        admin
          .from(venueIsUnified[venueId] ? 'service_items' : 'appointment_services')
          .select(
            'id, buffer_minutes, deposit_pence, processing_time_blocks, payment_requirement, cancellation_notice_hours',
          )
          .in('id', ids),
      ]);
      variantsByVenue[venueId] = variantMap;
      addonsByVenue[venueId] = addonMap;
      for (const r of metaRows.data ?? []) {
        metaByVenue[venueId].set(r.id as string, {
          buffer: (r.buffer_minutes as number) ?? 0,
          deposit: (r.deposit_pence as number | null) ?? null,
          processing: parseProcessingTimeBlocksFromDb(r.processing_time_blocks),
          paymentRequirement:
            ((r as { payment_requirement?: ClassPaymentRequirement | null })
              .payment_requirement as ClassPaymentRequirement | null) ?? 'none',
          cancellationNoticeHours: entityBookingWindowFromRow(r as Record<string, unknown>)
            .cancellation_notice_hours,
        });
      }
    }),
  );

  const activeVariants = (venueId: string, srcId: string) =>
    (variantsByVenue[venueId]?.get(srcId) ?? []).filter((v) => v.is_active);
  const addonGroups = (venueId: string, srcId: string) => addonsByVenue[venueId]?.get(srcId) ?? [];

  // "Any available" is offered only when NO provider of an offering has variants/add-ons —
  // otherwise the configuration is venue-specific and the customer must pick a calendar.
  const anyAvailableByItem = new Map<string, boolean>();
  for (const item of catalogue.items) {
    const uniform = item.providers.every(
      (p) => activeVariants(p.venueId, p.sourceServiceId).length === 0 && addonGroups(p.venueId, p.sourceServiceId).length === 0,
    );
    anyAvailableByItem.set(item.id, uniform);
  }

  // calendarId → practitioner entry (deduped across offerings).
  const byCalendar = new Map<string, CollectiveCatalogPractitioner>();
  const ensure = (calendarId: string, name: string, venueId: string): CollectiveCatalogPractitioner => {
    let entry = byCalendar.get(calendarId);
    if (!entry) {
      entry = {
        id: calendarId,
        name,
        owning_venue_id: venueId,
        owning_venue_name: '',
        services: [],
      };
      byCalendar.set(calendarId, entry);
    }
    return entry;
  };

  for (const [itemIndex, item] of catalogue.items.entries()) {
    for (const provider of item.providers) {
      const data = venueData[provider.venueId];
      if (!data) continue;
      const calendarIds = provider.practitionerId
        ? [provider.practitionerId]
        : data.serviceCalendars.get(provider.sourceServiceId) ?? [];
      for (const calendarId of calendarIds) {
        const name = data.calendars.get(calendarId)?.name ?? provider.practitionerName ?? 'Staff';
        const entry = ensure(calendarId, name, provider.venueId);
        if (entry.services.some((s) => s.id === item.id)) continue; // calendar already lists this offering
        const meta = metaByVenue[provider.venueId]?.get(provider.sourceServiceId);
        // Mirror the single-venue catalog's card-hold passthrough: 'card_hold'
        // reaches the guest only when the OWNING venue's flag is on and a positive
        // fee exists (service or variant level); otherwise it degrades to 'none',
        // matching what the create route will actually charge.
        const rawPayReq = meta?.paymentRequirement ?? 'none';
        const cardHoldFeeConfigured =
          (meta?.deposit ?? 0) > 0 ||
          activeVariants(provider.venueId, provider.sourceServiceId).some(
            (v) => (v.deposit_pence ?? 0) > 0,
          );
        const paymentRequirement: ClassPaymentRequirement =
          rawPayReq === 'card_hold'
            ? venueCardHoldEnabled[provider.venueId] && cardHoldFeeConfigured
              ? 'card_hold'
              : 'none'
            : rawPayReq;
        entry.services.push({
          id: item.id,
          name: item.name,
          description: item.description,
          duration_minutes: provider.durationMinutes ?? 0,
          buffer_minutes: meta?.buffer ?? 0,
          price_pence: provider.pricePence,
          deposit_pence: meta?.deposit ?? null,
          payment_requirement: paymentRequirement,
          // `catalogue.items` is already sorted (host display_order → member venue
          // service order → name), so the index is the display position.
          sort_order: itemIndex,
          cancellation_notice_hours:
            meta?.cancellationNoticeHours ?? DEFAULT_CANCELLATION_NOTICE_HOURS,
          variants: activeVariants(provider.venueId, provider.sourceServiceId).map(variantToCatalog),
          addon_groups: addonGroups(provider.venueId, provider.sourceServiceId),
          processing_time_blocks: meta?.processing ?? [],
          any_available: anyAvailableByItem.get(item.id) ?? true,
          source_service_id: provider.sourceServiceId,
        });
      }
    }
  }

  const result = [...byCalendar.values()].filter((p) => p.services.length > 0);

  // Every calendar carries its venue's name: the picker shows it under each
  // person, and duplicate names still fold it into the name itself so the
  // downstream summaries and banners stay unambiguous.
  const { data: venueRows } = await admin.from('venues').select('id, name').in('id', venueIds);
  const venueName: Record<string, string> = {};
  for (const v of venueRows ?? []) venueName[v.id as string] = (v.name as string) ?? '';
  for (const p of result) {
    p.owning_venue_name = venueName[p.owning_venue_id] ?? '';
  }

  // Venue-qualify duplicate staff names (e.g. two "Andrew"s, one per venue) so
  // customers can tell them apart on the merged page.
  const nameCounts = new Map<string, number>();
  for (const p of result) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const dupNames = new Set([...nameCounts.entries()].filter(([, n]) => n > 1).map(([name]) => name));
  for (const p of result) {
    if (dupNames.has(p.name) && p.owning_venue_name) {
      p.name = `${p.name} · ${p.owning_venue_name}`;
    }
  }

  const { data: collectiveRow } = await admin
    .from('venue_collectives')
    .select('host_venue_id')
    .eq('id', collectiveId)
    .maybeSingle();
  sortCollectivePractitioners(
    result,
    (collectiveRow as { host_venue_id?: string } | null)?.host_venue_id ?? null,
  );

  return { practitioners: result };
}

/**
 * Deterministic display order: the host's own calendars first (it curates the
 * page), then the other venues alphabetically, then by name within each venue.
 *
 * The order used to be however the catalogue happened to be assembled, which is
 * fine for a list nobody reads top-down but not for a picker that is now the
 * first thing a guest sees. It also fixes the "Meet the team" tab, which maps
 * this same list.
 */
export function sortCollectivePractitioners<
  T extends { name: string; owning_venue_id: string; owning_venue_name: string },
>(practitioners: T[], hostVenueId: string | null): T[] {
  return practitioners.sort((a, b) => {
    const aHost = a.owning_venue_id === hostVenueId ? 0 : 1;
    const bHost = b.owning_venue_id === hostVenueId ? 0 : 1;
    if (aHost !== bHost) return aHost - bHost;
    const byVenue = a.owning_venue_name.localeCompare(b.owning_venue_name);
    if (byVenue !== 0) return byVenue;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Services for the Services tab — the offerings, deduped, with effective "from" pricing.
 *
 * The offering photo lives on the catalogue item, but its framing lives on the combined page
 * config, so the caller passes the page config in rather than this reloading it.
 */
export async function loadCollectivePublicServices(
  admin: SupabaseClient,
  collectiveId: string,
  pageConfig?: BookingPageConfig | null,
): Promise<BookingPagePublicService[]> {
  const catalogue = await loadPublicCombinedCatalogue(admin, collectiveId);
  if (!catalogue) return [];
  const crops = pageConfig?.service_photo_crops ?? {};
  return catalogue.items.map((i) => {
    const imageUrl = i.imageUrl ?? null;
    return {
      id: i.id,
      name: i.name,
      description: i.description,
      image_url: imageUrl,
      image_crop: imageUrl ? crops[i.id] ?? null : null,
      price_pence: i.fromPricePence,
      duration_minutes:
        i.providers.find((p) => p.durationMinutes != null)?.durationMinutes ?? 0,
    };
  });
}

/** "Meet the team" members — the union of provider calendars across venues. */
export async function loadCollectiveTeam(
  admin: SupabaseClient,
  collectiveId: string,
): Promise<Array<{ id: string; name: string }>> {
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, collectiveId);
  return practitioners.map((p) => ({ id: p.id, name: p.name }));
}
