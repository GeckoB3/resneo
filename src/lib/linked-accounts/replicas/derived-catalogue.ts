/**
 * The combined booking page of a replicas-model collective, derived rather than stored (plan §6.6
 * "Derived combined catalogue", CB-01, CB-03; W4).
 *
 * Offerings with an active master; the master at the host and the converged replica at each member;
 * one provider per calendar that the service is assigned to, carrying that calendar's own values
 * (`calendarServiceTerms`). The offering's own name, description, price, length and heading are no
 * longer read: everything shown comes from the master.
 *
 * For the public audience a calendar is left out, and listed in `excluded` with the reason so the
 * staff build can keep it with a note, when:
 *   - `suspended`: its venue's membership is suspended;
 *   - `behind`: its venue's replica has not converged to the latest revision (never the host);
 *   - `payments`: the service takes payment and the venue cannot take card charges;
 *   - `forms`: the service needs a form (its own requirement or a venue-wide one) and the venue has
 *     forms switched off;
 *   - `staff_only`: the service is marked "staff bookings only" (`is_bookable_online = false`), so
 *     guests never book it themselves while staff still can.
 *
 * Pure: the caller reads the rows (catalogue.ts) and this decides.
 */
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';
// Types only: catalogue.ts imports this module, so a value import back would be circular.
import type { PublicCatalogueItem, PublicCatalogueProvider, VenueCatalogueData } from '@/lib/linked-accounts/catalogue';

/** The same key as catalogue.ts `calendarServiceTermsKey`. */
const termsKey = (calendarId: string, serviceId: string) => `${calendarId}:${serviceId}`;

export type ProviderExclusion = 'suspended' | 'behind' | 'payments' | 'forms' | 'staff_only';

export interface DerivedOffering {
  id: string;
  masterServiceId: string;
  displayOrder: number;
  imageUrl: string | null;
  pricingDisplay: PublicCatalogueItem['pricingDisplay'];
  allowAnyAvailable: boolean;
}

export interface DerivedLink {
  itemId: string;
  venueId: string;
  replicaServiceId: string | null;
  /** applied_revision = desired_revision. */
  current: boolean;
}

export interface DerivedVenue {
  name: string;
  slug: string;
  /** Plan eligibility, as today's page: an ineligible venue is not on the page at all. */
  eligible: boolean;
  suspended: boolean;
  chargesEnabled: boolean;
  formsOn: boolean;
}

export interface DerivedCatalogueInput {
  hostVenueId: string;
  offerings: DerivedOffering[];
  links: DerivedLink[];
  venues: Record<string, DerivedVenue>;
  venueData: Record<string, VenueCatalogueData>;
  /** Service ids whose payment rule takes money online. */
  paidServiceIds: Set<string>;
  /** Service ids with a form requirement of their own. */
  serviceIdsWithForms: Set<string>;
  /** Venues with at least one venue-wide form requirement. */
  venueIdsWithVenueWideForms: Set<string>;
  /** Service ids marked "staff bookings only". */
  staffOnlyServiceIds: Set<string>;
}

export interface DerivedCatalogueItem extends PublicCatalogueItem {
  excluded: { provider: PublicCatalogueProvider; reason: ProviderExclusion }[];
  sortKey: { displayOrder: number; sourceOrder: number; category: ServiceCategoryRef | null };
}

export function buildDerivedCatalogueItems(input: DerivedCatalogueInput): DerivedCatalogueItem[] {
  const out: DerivedCatalogueItem[] = [];
  for (const offering of input.offerings) {
    const sources: { venueId: string; serviceId: string; behind: boolean }[] = [
      { venueId: input.hostVenueId, serviceId: offering.masterServiceId, behind: false },
    ];
    for (const link of input.links) {
      if (link.itemId !== offering.id || link.venueId === input.hostVenueId || !link.replicaServiceId) continue;
      sources.push({ venueId: link.venueId, serviceId: link.replicaServiceId, behind: !link.current });
    }

    const providers: PublicCatalogueProvider[] = [];
    const excluded: DerivedCatalogueItem['excluded'] = [];
    let name: string | null = null;
    let description: string | null = null;
    let category: ServiceCategoryRef | null = null;
    let sourceOrder = 0;

    for (const source of sources) {
      const venue = input.venues[source.venueId];
      const data = input.venueData[source.venueId];
      if (!venue?.eligible || !data) continue;
      const service = data.services.get(source.serviceId);
      if (source.venueId === input.hostVenueId && service) {
        name = service.name;
        description = service.description;
        category = service.category;
        sourceOrder = service.sortOrder;
      } else if (service && name == null) {
        name = service.name;
        description = service.description;
      }
      const reason: ProviderExclusion | null = venue.suspended
        ? 'suspended'
        : source.behind
          ? 'behind'
          : input.paidServiceIds.has(source.serviceId) && !venue.chargesEnabled
            ? 'payments'
            : (input.serviceIdsWithForms.has(source.serviceId) || input.venueIdsWithVenueWideForms.has(source.venueId)) &&
                !venue.formsOn
              ? 'forms'
              : input.staffOnlyServiceIds.has(source.serviceId)
                ? 'staff_only'
                : null;
      for (const calendarId of data.serviceCalendars.get(source.serviceId) ?? []) {
        const terms = data.calendarServiceTerms.get(termsKey(calendarId, source.serviceId));
        const provider: PublicCatalogueProvider = {
          providerId: `${source.venueId}:${calendarId}:${source.serviceId}`,
          venueId: source.venueId,
          venueName: venue.name,
          venueSlug: venue.slug,
          practitionerId: calendarId,
          practitionerName: data.calendars.get(calendarId)?.name ?? null,
          sourceServiceId: source.serviceId,
          pricePence: terms?.pricePence ?? service?.pricePence ?? null,
          durationMinutes: terms?.durationMinutes ?? service?.durationMinutes ?? null,
        };
        if (reason) excluded.push({ provider, reason });
        else providers.push(provider);
      }
    }

    if (providers.length === 0 && excluded.length === 0) continue;
    const prices = providers.map((p) => p.pricePence).filter((p): p is number => p != null);
    out.push({
      id: offering.id,
      name: name ?? 'Service',
      description,
      category,
      imageUrl: offering.imageUrl,
      pricingDisplay: offering.pricingDisplay,
      allowAnyAvailable: offering.allowAnyAvailable,
      fromPricePence: prices.length > 0 ? Math.min(...prices) : null,
      providers,
      excluded,
      sortKey: { displayOrder: offering.displayOrder, sourceOrder, category },
    });
  }
  return out;
}
