import type { CollectiveView } from '@/lib/linked-accounts/collectives';
import type { CatalogueManagementView } from '@/lib/linked-accounts/catalogue';

/** A two-venue collective as `GET /api/venue/collectives` returns it, seen from `myVenueId`. */
export function collectiveView(overrides: Partial<CollectiveView> = {}): CollectiveView {
  return {
    id: 'col-1',
    slug: 'plus-1',
    name: 'Plus 1 Staging',
    status: 'active',
    branding: {},
    serviceGrouping: 'by_service_type',
    hostAnyAvailablePractitioner: false,
    hostStaffFirstBookingFlow: false,
    pageMode: 'unified_catalog',
    slugStrategy: 'dedicated',
    adoptedVenueId: null,
    timezone: 'Europe/London',
    bookingPageConfig: null,
    isHost: true,
    hostVenueId: 'v-host',
    myVenueId: 'v-host',
    myMembershipStatus: null,
    myConfig: null,
    members: [
      { venueId: 'v-host', venueName: 'Plus 1', venueSlug: 'plus-1-venue', status: 'active', displayOrder: 0, soloPageBehavior: 'keep_live' },
      { venueId: 'v-member', venueName: 'Light 3', venueSlug: 'light-3', status: 'active', displayOrder: 1, soloPageBehavior: 'keep_live' },
    ],
    activeMemberCount: 2,
    ...overrides,
  };
}

/** One offering, Cut, provided by Light 3's John; Plus 1's Ada is not yet on it. */
export function catalogueView(): CatalogueManagementView {
  return {
    collectiveId: 'col-1',
    pageMode: 'unified_catalog',
    categories: [],
    items: [
      {
        id: 'item-1',
        name: 'Cut',
        description: null,
        category: null,
        categoryId: null,
        imageUrl: null,
        displayOrder: 0,
        defaultDurationMinutes: 30,
        defaultPricePence: 3000,
        pricingDisplay: 'from',
        allowAnyAvailable: false,
        status: 'active',
        providers: [
          {
            id: 'prov-1',
            itemId: 'item-1',
            venueId: 'v-member',
            venueName: 'Light 3',
            sourceServiceId: 's-l1',
            sourceServiceName: 'Cut',
            practitionerId: 'cal-l1',
            practitionerName: 'John',
            effectivePricePence: 3000,
            effectiveDurationMinutes: 30,
            status: 'active',
            sourceLive: true,
          } as CatalogueManagementView['items'][number]['providers'][number],
        ],
        originVenueId: 'v-member',
        originVenueName: 'Light 3',
      } as CatalogueManagementView['items'][number],
    ],
    memberSources: [
      {
        venueId: 'v-host',
        venueName: 'Plus 1',
        services: [{ id: 's-h1', name: 'Cut', durationMinutes: 30, pricePence: 3000 }],
        practitioners: [{ id: 'cal-h1', name: 'Ada', services: [{ id: 's-h1', name: 'Cut' }] }],
      },
      {
        venueId: 'v-member',
        venueName: 'Light 3',
        services: [{ id: 's-l1', name: 'Cut', durationMinutes: 30, pricePence: 3000 }],
        practitioners: [{ id: 'cal-l1', name: 'John', services: [{ id: 's-l1', name: 'Cut' }] }],
      },
    ],
  };
}
