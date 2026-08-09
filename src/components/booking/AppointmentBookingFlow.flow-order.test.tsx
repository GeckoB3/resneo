/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';
import { APPOINTMENT_BOOKING_RESET_EVENT } from './appointment-booking-events';

/**
 * Characterisation of the booking flow's step order, written against the
 * behaviour that shipped before staff-first booking existed.
 *
 * These walks are the safety net for that feature: the ordering moves into a
 * pure helper and every call site is rewired, so the default (service-first)
 * order needs a test that fails the moment it drifts. Assertions here describe
 * what guests see today, not what looks tidy, and a few of them pin behaviour
 * that is mildly wrong on purpose (see DELTA notes). Each of those flips in the
 * same commit as the fix it belongs to.
 *
 * Boundary: walks stop at the details step. Mounting payment would boot Stripe,
 * and the end-to-end suite already owns that leg.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };
const BEN = { id: 'prac-ben', name: 'Ben' };

const PLAIN = 'svc-plain';
const VARIANTS = 'svc-variants';
const ADDONS = 'svc-addons';
const BOTH = 'svc-both';
const BEN_ONLY = 'svc-ben-only';

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function variant(id: string, name: string, price: number) {
  return {
    id,
    name,
    description: null,
    duration_minutes: 45,
    buffer_minutes: 0,
    price_pence: price,
    deposit_pence: null,
    sort_order: 0,
  };
}

/** One optional single-select group, so nothing blocks Continue by default. */
function addonGroup(groupId: string, groupName: string, addonId: string, addonName: string) {
  return {
    group: {
      id: groupId,
      venue_id: VENUE_ID,
      name: groupName,
      prompt_to_client: null,
      description: null,
      selection_type: 'single' as const,
      min_select: 0,
      max_select: 1,
      hidden_from_online: false,
      is_active: true,
      sort_order: 0,
      created_at: '',
      updated_at: '',
    },
    addons: [
      {
        id: addonId,
        addon_group_id: groupId,
        venue_id: VENUE_ID,
        name: addonName,
        description: null,
        additional_price_pence: 500,
        additional_duration_minutes: 10,
        cost_to_business_pence: null,
        is_active: true,
        sort_order: 0,
        archived_at: null,
        created_at: '',
        updated_at: '',
      },
    ],
    link_sort_order: 0,
  };
}

type CatalogService = Record<string, unknown> & { id: string };
type CatalogPractitioner = { id: string; name: string; services: CatalogService[] };

function service(
  id: string,
  name: string,
  pricePence: number,
  extra: Partial<CatalogService> = {},
): CatalogService {
  return {
    id,
    name,
    description: null,
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: pricePence,
    deposit_pence: null,
    payment_requirement: 'none',
    sort_order: 0,
    cancellation_notice_hours: 24,
    ...extra,
  };
}

/** Ada offers all four shapes; Ben shares two of them at his own prices, plus one only he offers. */
function venueCatalog(): CatalogPractitioner[] {
  const variantList = [variant('var-short', 'Short', 3000), variant('var-long', 'Long', 5000)];
  return [
    {
      ...ADA,
      services: [
        service(PLAIN, 'Plain Service', 3000),
        service(VARIANTS, 'Variants Service', 3000, { variants: variantList }),
        service(ADDONS, 'Addons Service', 3500, {
          addon_groups: [addonGroup('grp-1', 'Finishing', 'add-1', 'Hot towel')],
        }),
        service(BOTH, 'Both Service', 4000, {
          variants: variantList,
          addon_groups: [addonGroup('grp-2', 'Extras', 'add-2', 'Scalp massage')],
        }),
      ],
    },
    {
      ...BEN,
      services: [
        service(PLAIN, 'Plain Service', 4500),
        service(VARIANTS, 'Variants Service', 4500, { variants: variantList }),
        service(BEN_ONLY, 'Ben Only Service', 2000),
      ],
    },
  ];
}

/**
 * Combined page shape, covering the same four service shapes as a single venue.
 * Each calendar carries its OWN variants and add-on groups for the same offering
 * id, which is what makes the display-versus-charge divergence visible.
 */
function combinedCatalog(): CatalogPractitioner[] {
  const adaVariants = [variant('var-ada-short', 'Ada Short', 3000)];
  const benVariants = [variant('var-ben-short', 'Ben Short', 4000)];
  return [
    {
      ...ADA,
      services: [
        service(PLAIN, 'Plain Offering', 3000, { any_available: true }),
        service(VARIANTS, 'Options Offering', 3000, {
          any_available: false,
          variants: adaVariants,
        }),
        service(ADDONS, 'Divergent Offering', 3500, {
          any_available: false,
          addon_groups: [addonGroup('grp-ada', 'Ada Extras', 'add-ada', 'Ada hot towel')],
        }),
        service(BOTH, 'Full Offering', 4000, {
          any_available: false,
          variants: adaVariants,
          addon_groups: [addonGroup('grp-ada-2', 'Ada Finishing', 'add-ada-2', 'Ada gloss')],
        }),
      ],
    },
    {
      ...BEN,
      services: [
        service(PLAIN, 'Plain Offering', 3000, { any_available: true }),
        service(VARIANTS, 'Options Offering', 4000, {
          any_available: false,
          variants: benVariants,
        }),
        service(ADDONS, 'Divergent Offering', 4200, {
          any_available: false,
          addon_groups: [addonGroup('grp-ben', 'Ben Extras', 'add-ben', 'Ben scalp massage')],
        }),
        service(BOTH, 'Full Offering', 4600, {
          any_available: false,
          variants: benVariants,
          addon_groups: [addonGroup('grp-ben-2', 'Ben Finishing', 'add-ben-2', 'Ben gloss')],
        }),
      ],
    },
  ];
}

function venue(overrides: Partial<VenuePublic> = {}): VenuePublic {
  return {
    id: VENUE_ID,
    name: 'Test Salon',
    slug: 'test-salon',
    cover_photo_url: null,
    address: null,
    phone: null,
    deposit_config: null,
    booking_rules: null,
    opening_hours: null,
    timezone: 'Europe/London',
    booking_model: 'unified_scheduling',
    currency: 'GBP',
    feature_flags: { resolved: { any_available_practitioner: false } },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch stub
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

interface FetchStub {
  urls: string[];
  countMatching: (fragment: string) => number;
  calendarRequests: () => URLSearchParams[];
}

/**
 * Serves the four endpoints the flow reads. Slots are synthesised for whatever
 * practitioner and service the URL asks about, so any walk reaches the times.
 */
function installFetch(catalog: CatalogPractitioner[]): FetchStub {
  const urls: string[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);
    urls.push(url);
    const params = new URLSearchParams(url.split('?')[1] ?? '');

    if (url.includes('/api/booking/appointment-catalog')) {
      return jsonResponse({ practitioners: catalog });
    }
    if (url.includes('appointment-calendar')) {
      return jsonResponse({ available_dates: [todayYmd()] });
    }
    if (url.includes('/api/booking/availability')) {
      const serviceId = params.get('service_id') ?? PLAIN;
      const pooled = params.get('any_available') === '1';
      const practitionerId = pooled ? 'any' : (params.get('practitioner_id') ?? ADA.id);
      const source = catalog.find((p) => p.id === practitionerId) ?? catalog[0];
      const offer = source?.services.find((s) => s.id === serviceId);
      return jsonResponse({
        practitioners: [
          {
            id: practitionerId,
            name: source?.name ?? 'Any',
            services: source?.services ?? [],
            slots: ['09:00:00', '10:00:00', '14:00:00'].map((start_time) => ({
              start_time,
              service_id: serviceId,
              duration_minutes: (offer?.duration_minutes as number) ?? 30,
              price_pence: (offer?.price_pence as number) ?? null,
              practitioner_id: pooled ? ADA.id : practitionerId,
              practitioner_name: pooled ? ADA.name : (source?.name ?? ''),
            })),
          },
        ],
      });
    }
    return jsonResponse({});
  });

  vi.stubGlobal('fetch', impl);

  return {
    urls,
    countMatching: (fragment) => urls.filter((u) => u.includes(fragment)).length,
    calendarRequests: () =>
      urls
        .filter((u) => u.includes('appointment-calendar'))
        .map((u) => new URLSearchParams(u.split('?')[1] ?? '')),
  };
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

type FlowProps = Parameters<typeof AppointmentBookingFlow>[0];

function renderFlow(props: Partial<FlowProps> = {}) {
  return render(<AppointmentBookingFlow venue={venue()} {...props} />);
}

/** Step headings, as a guest sees them. */
const STEP = {
  modeChoice: 'How would you like to book?',
  service: 'Select a service',
  variant: 'Choose your option',
  addons: 'Add extras to your booking',
  practitioner: 'Who would you like to see?',
  slot: 'Date and time',
  review: 'Review your services',
  groupReview: 'Group Booking',
  groupPerson: 'Who is this appointment for?',
  groupVariant: 'Choose an option',
  groupPractitioner: 'Choose staff',
} as const;

async function waitForStep(heading: string): Promise<void> {
  await screen.findByRole('heading', { name: heading });
}

function notAtStep(heading: string): void {
  expect(screen.queryByRole('heading', { name: heading })).not.toBeInTheDocument();
}

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** The flow renders one "Back" control per step. */
function clickBack(): void {
  fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
}

async function startSingleBooking(): Promise<void> {
  await waitForStep(STEP.modeChoice);
  clickButton(/Book an appointment/i);
  await waitForStep(STEP.service);
}

/** Service rows are buttons labelled with the service name (plus price and duration). */
function clickService(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name, 'i') }));
}

/**
 * A person's card reads "A Ada £30.00": the avatar initial is part of the
 * accessible name, so match the name as a whole word rather than a prefix.
 */
function personCard(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`\\b${name}\\b`, 'i') });
}

function queryPersonCard(name: string): HTMLElement | null {
  return screen.queryByRole('button', { name: new RegExp(`\\b${name}\\b`, 'i') });
}

function clickPractitioner(name: string): void {
  fireEvent.click(personCard(name));
}

async function pickFirstSlot(): Promise<void> {
  const slot = await screen.findByRole('button', { name: '10:00' });
  fireEvent.click(slot);
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Venue page, service-first (the default)
// ---------------------------------------------------------------------------

describe('venue page, service-first: forward order', () => {
  it('plain service goes service to person to times', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);
    notAtStep(STEP.variant);

    clickPractitioner('Ada');
    await waitForStep(STEP.slot);

    await pickFirstSlot();
    await waitForStep(STEP.review);
  });

  it('reaches the details form, the last step before payment', async () => {
    // The boundary for these walks: payment boots Stripe, so end-to-end owns it.
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.slot);
    await pickFirstSlot();
    await waitForStep(STEP.review);

    clickButton(/Continue to details/i);
    // Queried by placeholder, not label: `FormField` points its `htmlFor` at an
    // id it never puts on the input, so the guest form has no label association.
    expect(await screen.findByPlaceholderText('First name')).toBeInTheDocument();
  });

  it('variants service inserts the option step before the person', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Variants Service');
    await waitForStep(STEP.variant);

    clickButton(/Short/);
    await waitForStep(STEP.practitioner);
  });

  it('add-ons service inserts the extras step before the person', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Addons Service');
    await waitForStep(STEP.addons);

    clickButton(/^Continue$/);
    await waitForStep(STEP.practitioner);
  });

  it('a service with both puts options before extras, then the person', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Both Service');
    await waitForStep(STEP.variant);

    clickButton(/Short/);
    await waitForStep(STEP.addons);

    clickButton(/^Continue$/);
    await waitForStep(STEP.practitioner);
  });
});

describe('venue page, service-first: back order', () => {
  it('unwinds person to service for a plain service', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    clickBack();
    await waitForStep(STEP.service);
  });

  it('unwinds person to extras to options to service', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Both Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.practitioner);

    clickBack();
    await waitForStep(STEP.addons);
    clickBack();
    await waitForStep(STEP.variant);
    clickBack();
    await waitForStep(STEP.service);
  });

  it('unwinds times to person, skipping the options already chosen', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Both Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.practitioner);
  });

  it('returns to the single-or-group chooser from the service list', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickBack();
    await waitForStep(STEP.modeChoice);
  });
});

describe('venue page, service-first: state cleared on the way back', () => {
  it('clears the chosen service so the list is re-offered', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);
    clickBack();
    await waitForStep(STEP.service);

    // Every service is offered again, including the one just abandoned.
    expect(screen.getByRole('button', { name: /Plain Service/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Both Service/i })).toBeInTheDocument();
  });

  it('re-lists people after backing out of the times', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ben');
    await waitForStep(STEP.slot);
    clickBack();
    await waitForStep(STEP.practitioner);

    expect(personCard('Ada')).toBeInTheDocument();
    expect(personCard('Ben')).toBeInTheDocument();
  });

  it('shows each person their own price for a shared service', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    expect(personCard('Ada')).toHaveTextContent('£30.00');
    expect(personCard('Ben')).toHaveTextContent('£45.00');
  });

  it('lists only the people who offer the chosen service', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Ben Only Service');
    await waitForStep(STEP.practitioner);

    expect(personCard('Ben')).toBeInTheDocument();
    expect(queryPersonCard('Ada')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Any available
// ---------------------------------------------------------------------------

describe('venue page, service-first: any available', () => {
  const pooledVenue = venue({
    feature_flags: { resolved: { any_available_practitioner: true } },
  });

  it('offers the pool once more than one person provides the service', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: pooledVenue });
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    expect(screen.getByRole('button', { name: /Any available/i })).toBeInTheDocument();
  });

  it('hides the pool when only one person provides the service', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: pooledVenue });
    await startSingleBooking();

    clickService('Ben Only Service');
    await waitForStep(STEP.practitioner);

    expect(screen.queryByRole('button', { name: /Any available/i })).not.toBeInTheDocument();
  });

  it('goes straight to the times when the pool is chosen', async () => {
    const stub = installFetch(venueCatalog());
    renderFlow({ venue: pooledVenue });
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);
    fireEvent.click(screen.getByRole('button', { name: /Any available/i }));
    await waitForStep(STEP.slot);

    await waitFor(() => {
      expect(stub.countMatching('any_available=1')).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Combined page (venue collective)
// ---------------------------------------------------------------------------

const combinedVenue = venue({ is_collective: true });

describe('combined page, service-first: calendar before options', () => {
  it('opens on the service list, with no single-or-group chooser', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });

    await waitForStep(STEP.service);
    notAtStep(STEP.modeChoice);
  });

  it('picks the calendar before extras, even when the offering has them', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Divergent Offering');
    await waitForStep(STEP.practitioner);
    notAtStep(STEP.addons);

    clickPractitioner('Ada');
    await waitForStep(STEP.addons);

    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);
  });

  it('goes calendar to times for an offering with no options', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Plain Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ben');
    await waitForStep(STEP.slot);
  });

  it('collects the chosen calendar\'s own options after the calendar', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Options Offering');
    await waitForStep(STEP.practitioner);
    notAtStep(STEP.variant);

    clickPractitioner('Ben');
    await waitForStep(STEP.variant);

    // Ben's own option, not Ada's, because each calendar has its own.
    expect(screen.getByRole('button', { name: /Ben Short/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ada Short/i })).not.toBeInTheDocument();

    clickButton(/Ben Short/);
    await waitForStep(STEP.slot);
  });

  it('walks calendar to options to extras to times for a full offering', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Full Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.variant);
    clickButton(/Ada Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);
  });

  it('unwinds a full offering back through options to the calendar', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Full Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.variant);
    clickButton(/Ada Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.addons);
    clickBack();
    await waitForStep(STEP.variant);
    clickBack();
    await waitForStep(STEP.practitioner);
    clickBack();
    await waitForStep(STEP.service);
  });

  it('unwinds times to extras to calendar to services', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Divergent Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.addons);
    clickBack();
    await waitForStep(STEP.practitioner);
    clickBack();
    await waitForStep(STEP.service);
  });

  it('shows the chosen calendar\'s own extras, not the first calendar\'s', async () => {
    // Was a DELTA: the extras step used to resolve groups by service id alone, so
    // choosing Ben showed Ada's extras while the booking charged Ben's. Now
    // scoped to the chosen calendar, in both toggle states.
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Divergent Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ben');
    await waitForStep(STEP.addons);

    expect(screen.getByText('Ben Extras')).toBeInTheDocument();
    expect(screen.queryByText('Ada Extras')).not.toBeInTheDocument();
  });

  it('shows the other calendar\'s extras when that one is chosen', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);

    clickService('Divergent Offering');
    await waitForStep(STEP.practitioner);
    clickPractitioner('Ada');
    await waitForStep(STEP.addons);

    expect(screen.getByText('Ada Extras')).toBeInTheDocument();
    expect(screen.queryByText('Ben Extras')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Per-practitioner page
// ---------------------------------------------------------------------------

const LOCKED = { id: ADA.id, name: ADA.name, bookingSlug: 'ada' };

/** The catalog API filters to the one calendar when a practitioner slug is given. */
function lockedCatalog(): CatalogPractitioner[] {
  return venueCatalog().filter((p) => p.id === ADA.id);
}

describe('per-practitioner page: person already fixed', () => {
  it('opens on the service list and skips the person step', async () => {
    installFetch(lockedCatalog());
    renderFlow({ lockedPractitioner: LOCKED });

    await waitForStep(STEP.service);
    notAtStep(STEP.modeChoice);

    clickService('Plain Service');
    await waitForStep(STEP.slot);
    notAtStep(STEP.practitioner);
  });

  it('goes option straight to times when there are no extras', async () => {
    installFetch(lockedCatalog());
    renderFlow({ lockedPractitioner: LOCKED });
    await waitForStep(STEP.service);

    clickService('Variants Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.slot);
    notAtStep(STEP.practitioner);
  });

  it('still collects options and extras before the times', async () => {
    installFetch(lockedCatalog());
    renderFlow({ lockedPractitioner: LOCKED });
    await waitForStep(STEP.service);

    clickService('Both Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);
  });

  it('unwinds the times back through the extras step', async () => {
    // Was a DELTA: this branch used to jump straight past the extras to the
    // service list, losing whatever the guest had chosen. It now unwinds like
    // every other surface.
    installFetch(lockedCatalog());
    renderFlow({ lockedPractitioner: LOCKED });
    await waitForStep(STEP.service);

    clickService('Addons Service');
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.addons);
    clickBack();
    await waitForStep(STEP.service);
  });
});

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

const EDIT_BOOKING = {
  id: 'booking-1',
  booking_date: todayYmd(),
  booking_time: '10:00',
  party_size: 1,
  practitioner_id: ADA.id,
  service_id: PLAIN,
};

describe('edit mode: order is preserved', () => {
  it('jumps a plain service straight to the times, keeping the booked person', async () => {
    installFetch(venueCatalog());
    renderFlow({ editBooking: EDIT_BOOKING });
    await waitForStep(STEP.service);

    clickService('Plain Service');
    await waitForStep(STEP.slot);
    notAtStep(STEP.practitioner);
  });

  it('still walks options and extras, then asks for the person', async () => {
    // `advanceFromAddons` has no edit branch, so an edit lands on the person
    // step exactly like any other service-first venue session.
    installFetch(venueCatalog());
    renderFlow({ editBooking: EDIT_BOOKING });
    await waitForStep(STEP.service);

    clickService('Both Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.practitioner);
  });
});

// ---------------------------------------------------------------------------
// Group booking
// ---------------------------------------------------------------------------

async function addGroupPerson(label: string, serviceName: string): Promise<void> {
  clickButton(/Add a person/i);
  await waitForStep(STEP.groupPerson);

  fireEvent.change(screen.getByPlaceholderText(/Guest name or label/i), {
    target: { value: label },
  });
  clickButton(/^Continue$/);

  await screen.findByText(`Booking for: ${label}`);
  clickService(serviceName);
  await waitForStep(STEP.groupPractitioner);

  clickPractitioner('Ada');
  await screen.findByRole('heading', { name: `Pick a time for ${label}` });
  await pickFirstSlot();
  await waitForStep(STEP.groupReview);
}

describe('group booking, service-first', () => {
  it('collects service then person for each guest, twice over', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await waitForStep(STEP.modeChoice);

    clickButton(/Group appointment/i);
    await waitForStep(STEP.groupReview);

    await addGroupPerson('Sam', 'Plain Service');
    await addGroupPerson('Jo', 'Plain Service');

    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('Jo')).toBeInTheDocument();
    expect(screen.getByText(/2 people added/i)).toBeInTheDocument();
  });

  it('inserts options and extras before the person, like the single flow', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await waitForStep(STEP.modeChoice);
    clickButton(/Group appointment/i);
    await waitForStep(STEP.groupReview);

    clickButton(/Add a person/i);
    await waitForStep(STEP.groupPerson);
    fireEvent.change(screen.getByPlaceholderText(/Guest name or label/i), {
      target: { value: 'Sam' },
    });
    clickButton(/^Continue$/);
    await screen.findByText('Booking for: Sam');

    clickService('Both Service');
    await waitForStep(STEP.groupVariant);
    clickButton(/Short/);
    await screen.findByRole('heading', { name: 'Add extras for Sam' });
    clickButton(/^Continue$/);
    await waitForStep(STEP.groupPractitioner);
  });

  it('unwinds the person step back through extras and options', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await waitForStep(STEP.modeChoice);
    clickButton(/Group appointment/i);
    await waitForStep(STEP.groupReview);

    clickButton(/Add a person/i);
    await waitForStep(STEP.groupPerson);
    fireEvent.change(screen.getByPlaceholderText(/Guest name or label/i), {
      target: { value: 'Sam' },
    });
    clickButton(/^Continue$/);
    await screen.findByText('Booking for: Sam');
    clickService('Both Service');
    await waitForStep(STEP.groupVariant);
    clickButton(/Short/);
    await screen.findByRole('heading', { name: 'Add extras for Sam' });
    clickButton(/^Continue$/);
    await waitForStep(STEP.groupPractitioner);

    clickBack();
    await screen.findByRole('heading', { name: 'Add extras for Sam' });
    clickBack();
    await waitForStep(STEP.groupVariant);
    clickBack();
    await screen.findByText('Booking for: Sam');
  });
});

// ---------------------------------------------------------------------------
// Reset event
// ---------------------------------------------------------------------------

describe('reset event', () => {
  it('returns a venue page to the single-or-group chooser', async () => {
    installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();
    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    fireEvent(window, new Event(APPOINTMENT_BOOKING_RESET_EVENT));

    await waitForStep(STEP.modeChoice);
  });

  it('returns a combined page to its service list', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: combinedVenue });
    await waitForStep(STEP.service);
    clickService('Plain Offering');
    await waitForStep(STEP.practitioner);

    fireEvent(window, new Event(APPOINTMENT_BOOKING_RESET_EVENT));

    await waitForStep(STEP.service);
  });
});

// ---------------------------------------------------------------------------
// Staff-first (venue pages)
// ---------------------------------------------------------------------------

function staffFirstVenue(overrides: Partial<VenuePublic> = {}): VenuePublic {
  return venue({
    feature_flags: {
      resolved: { any_available_practitioner: false, staff_first_booking_flow: true },
    },
    ...overrides,
  });
}

const STAFF_PICK = 'staff-pick-step';

async function startStaffFirstBooking(): Promise<void> {
  await waitForStep(STEP.modeChoice);
  clickButton(/Book an appointment/i);
  await screen.findByTestId(STAFF_PICK);
}

describe('staff-first: person before service', () => {
  it('asks who first, then lists only that person\'s services', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    // Nothing about services yet.
    expect(screen.queryByRole('button', { name: /Plain Service/i })).not.toBeInTheDocument();

    clickPractitioner('Ben');
    await waitForStep(STEP.service);

    expect(screen.getByRole('button', { name: /Ben Only Service/i })).toBeInTheDocument();
    // Ada's exclusive services are not Ben's to sell.
    expect(screen.queryByRole('button', { name: /Addons Service/i })).not.toBeInTheDocument();
  });

  it('shows that person\'s own price, not a team-wide "from"', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    clickPractitioner('Ben');
    await waitForStep(STEP.service);

    const row = screen.getByRole('button', { name: /Plain Service/i });
    expect(row).toHaveTextContent('£45.00');
    expect(row).not.toHaveTextContent('From');
  });

  it('names the chosen person on every step until the times', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    clickPractitioner('Ada');
    await waitForStep(STEP.service);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();

    clickService('Both Service');
    await waitForStep(STEP.variant);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();

    clickButton(/Short/);
    await waitForStep(STEP.addons);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();
  });

  it('walks all four service shapes to the times, never asking who twice', async () => {
    for (const [serviceName, viaVariant, viaAddons] of [
      ['Plain Service', false, false],
      ['Variants Service', true, false],
      ['Addons Service', false, true],
      ['Both Service', true, true],
    ] as const) {
      installFetch(venueCatalog());
      renderFlow({ venue: staffFirstVenue() });
      await startStaffFirstBooking();
      clickPractitioner('Ada');
      await waitForStep(STEP.service);

      clickService(serviceName);
      if (viaVariant) {
        await waitForStep(STEP.variant);
        clickButton(/Short/);
      }
      if (viaAddons) {
        await waitForStep(STEP.addons);
        clickButton(/^Continue$/);
      }
      await waitForStep(STEP.slot);
      notAtStep(STEP.practitioner);
      cleanup();
    }
  });

  it('unwinds times to extras to options to services, keeping the person', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();
    clickPractitioner('Ada');
    await waitForStep(STEP.service);
    clickService('Both Service');
    await waitForStep(STEP.variant);
    clickButton(/Short/);
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.addons);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();

    clickBack();
    await waitForStep(STEP.variant);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();

    clickBack();
    await waitForStep(STEP.service);
    expect(screen.getByText('Booking with Ada')).toBeInTheDocument();
  });

  it('only lets go of the person at the service list', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();
    clickPractitioner('Ada');
    await waitForStep(STEP.service);

    clickBack();
    await screen.findByTestId(STAFF_PICK);
    expect(screen.queryByText('Booking with Ada')).not.toBeInTheDocument();
  });

  it('goes back to the single-or-group chooser from the picker', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    clickBack();
    await waitForStep(STEP.modeChoice);
  });

  it('opens straight on the picker for a start=service link, with no way back', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue(), initialStep: 'service' });

    await screen.findByTestId(STAFF_PICK);
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument();
  });

  it('returns to the chooser on reset', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();
    clickPractitioner('Ada');
    await waitForStep(STEP.service);

    fireEvent(window, new Event(APPOINTMENT_BOOKING_RESET_EVENT));

    await waitForStep(STEP.modeChoice);
  });

  it('lists everyone bookable, including a person with a hidden profile', async () => {
    installFetch(venueCatalog());
    renderFlow({
      venue: staffFirstVenue({
        booking_page_config: { team_profiles: { [BEN.id]: { hidden: true, bio: 'Hidden bio' } } },
      }),
    });
    await startStaffFirstBooking();

    expect(personCard('Ada')).toBeInTheDocument();
    expect(personCard('Ben')).toBeInTheDocument();
    // Hiding is a marketing setting; it must not leak the bio it withholds.
    expect(screen.queryByText('Hidden bio')).not.toBeInTheDocument();
  });

  it('shows a photo, specialties and a bio for a visible profile', async () => {
    installFetch(venueCatalog());
    renderFlow({
      venue: staffFirstVenue({
        booking_page_config: {
          team_profiles: {
            [ADA.id]: {
              photo: 'https://example.test/ada.jpg',
              specialties: 'Colour, Cutting, Styling, Extensions',
              bio: 'Twelve years behind the chair.',
            },
          },
        },
      }),
    });
    await startStaffFirstBooking();

    expect(screen.getByText('Twelve years behind the chair.')).toBeInTheDocument();
    expect(screen.getByText('Colour')).toBeInTheDocument();
    // Four specialties, three chips, and the rest folded into an overflow chip.
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.queryByText('Extensions')).not.toBeInTheDocument();
  });

  it('tells the guest when nobody is bookable', async () => {
    installFetch([]);
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    expect(screen.getByText(/No staff are available to book right now/i)).toBeInTheDocument();
  });

  it('still shows one card for a solo venue', async () => {
    installFetch(lockedCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    expect(personCard('Ada')).toBeInTheDocument();
  });
});

describe('staff-first: any available', () => {
  const pooled = staffFirstVenue({
    feature_flags: {
      resolved: { any_available_practitioner: true, staff_first_booking_flow: true },
    },
  });

  it('offers the pool at the top of the picker', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: pooled });
    await startStaffFirstBooking();

    expect(screen.getByRole('button', { name: /Any available/i })).toBeInTheDocument();
  });

  it('keeps the venue-wide list and "from" prices after choosing the pool', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: pooled });
    await startStaffFirstBooking();

    fireEvent.click(screen.getByRole('button', { name: /Any available/i }));
    await waitForStep(STEP.service);

    expect(screen.getByText('Booking with whoever is available first')).toBeInTheDocument();
    // Ben's exclusive service is still on offer, and pricing spans the team.
    expect(screen.getByRole('button', { name: /Ben Only Service/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Plain Service/i })).toHaveTextContent('From £30.00');
  });

  it('hides the pool when only one person is bookable', async () => {
    installFetch(lockedCatalog());
    renderFlow({ venue: pooled });
    await startStaffFirstBooking();

    expect(screen.queryByRole('button', { name: /Any available/i })).not.toBeInTheDocument();
  });
});

describe('staff-first: when the chosen person is fully booked', () => {
  /** Availability with no slots, so the times step shows its empty state. */
  function installEmptyAvailability(catalog: CatalogPractitioner[]): void {
    installFetch(catalog);
    const inner = globalThis.fetch as unknown as (input: RequestInfo | URL) => Promise<Response>;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/booking/availability')) {
        return jsonResponse({ practitioners: [] });
      }
      return inner(input);
    });
  }

  async function reachEmptyTimes(): Promise<void> {
    await startStaffFirstBooking();
    clickPractitioner('Ada');
    await waitForStep(STEP.service);
    clickService('Plain Service');
    await waitForStep(STEP.slot);
    await screen.findByText(/No times available/i);
  }

  it('offers a way to someone else and pins the service they were booking', async () => {
    installEmptyAvailability(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await reachEmptyTimes();

    clickButton(/See someone else/i);
    await screen.findByTestId(STAFF_PICK);

    clickPractitioner('Ben');
    await waitForStep(STEP.service);

    const row = screen.getByRole('button', { name: /Plain Service/i });
    expect(row).toHaveTextContent('You were booking this');
    // Ben's price for it, visible before any time is picked.
    expect(row).toHaveTextContent('£45.00');
  });

  it('says so plainly when the next person does not offer it', async () => {
    installEmptyAvailability(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();
    clickPractitioner('Ada');
    await waitForStep(STEP.service);
    clickService('Addons Service');
    await waitForStep(STEP.addons);
    clickButton(/^Continue$/);
    await waitForStep(STEP.slot);
    await screen.findByText(/No times available/i);

    clickButton(/See someone else/i);
    await screen.findByTestId(STAFF_PICK);
    clickPractitioner('Ben');
    await waitForStep(STEP.service);

    expect(
      screen.getByText(/Ben does not offer the service you were booking/i),
    ).toBeInTheDocument();
  });

  it('drops the pin once a service is chosen', async () => {
    installEmptyAvailability(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await reachEmptyTimes();

    clickButton(/See someone else/i);
    await screen.findByTestId(STAFF_PICK);
    clickPractitioner('Ben');
    await waitForStep(STEP.service);
    clickService('Plain Service');
    await waitForStep(STEP.slot);

    clickBack();
    await waitForStep(STEP.service);
    expect(screen.queryByText('You were booking this')).not.toBeInTheDocument();
  });

  it('is not offered from the pooled option, which already covered everyone', async () => {
    installEmptyAvailability(venueCatalog());
    renderFlow({
      venue: staffFirstVenue({
        feature_flags: {
          resolved: { any_available_practitioner: true, staff_first_booking_flow: true },
        },
      }),
    });
    await startStaffFirstBooking();
    fireEvent.click(screen.getByRole('button', { name: /Any available/i }));
    await waitForStep(STEP.service);
    clickService('Plain Service');
    await waitForStep(STEP.slot);
    await screen.findByText(/No times available/i);

    expect(screen.queryByRole('button', { name: /See someone else/i })).not.toBeInTheDocument();
  });

  it('is not offered on a solo venue, where there is nobody to switch to', async () => {
    installEmptyAvailability(lockedCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await reachEmptyTimes();

    expect(screen.queryByRole('button', { name: /See someone else/i })).not.toBeInTheDocument();
  });
});

describe('staff-first: prefetching', () => {
  it('warms only the chosen person\'s months, not the whole team\'s', async () => {
    const stub = installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    clickPractitioner('Ada');
    await waitForStep(STEP.service);

    await waitFor(() => {
      expect(stub.calendarRequests().length).toBeGreaterThan(0);
    });
    const asked = stub.calendarRequests().map((p) => p.get('practitioner_id'));
    expect(asked).toContain(ADA.id);
    expect(asked).not.toContain(BEN.id);
  });

  it('does not fall back to warming the whole team at a one-service venue', async () => {
    // The single-service shortcut warms every provider on the service step. Once
    // a person is chosen that is the wrong set, so staff-first opts out of it.
    const singleService = venueCatalog().map((p) => ({
      ...p,
      services: p.services.filter((s) => s.id === PLAIN),
    }));
    const stub = installFetch(singleService);
    renderFlow({ venue: staffFirstVenue() });
    await startStaffFirstBooking();

    clickPractitioner('Ada');
    await waitForStep(STEP.service);

    await waitFor(() => {
      expect(stub.calendarRequests().length).toBeGreaterThan(0);
    });
    expect(stub.calendarRequests().map((p) => p.get('practitioner_id'))).not.toContain(BEN.id);
  });

  it('warms nothing after the pool is chosen', async () => {
    const stub = installFetch(venueCatalog());
    renderFlow({
      venue: staffFirstVenue({
        feature_flags: {
          resolved: { any_available_practitioner: true, staff_first_booking_flow: true },
        },
      }),
    });
    await startStaffFirstBooking();

    fireEvent.click(screen.getByRole('button', { name: /Any available/i }));
    await waitForStep(STEP.service);

    expect(stub.calendarRequests()).toHaveLength(0);
  });
});

describe('staff-first: surfaces that keep the old order', () => {
  it('leaves an edit alone', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue(), editBooking: EDIT_BOOKING });

    await waitForStep(STEP.service);
    expect(screen.queryByTestId(STAFF_PICK)).not.toBeInTheDocument();
  });

  it('leaves a per-practitioner page alone', async () => {
    installFetch(lockedCatalog());
    renderFlow({ venue: staffFirstVenue(), lockedPractitioner: LOCKED });

    await waitForStep(STEP.service);
    expect(screen.queryByTestId(STAFF_PICK)).not.toBeInTheDocument();
  });

  it('leaves the staff dashboard alone', async () => {
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue(), bookingAudience: 'staff' });

    await waitForStep(STEP.service);
    expect(screen.queryByTestId(STAFF_PICK)).not.toBeInTheDocument();
  });

  it('leaves a session that already knows the service alone', async () => {
    // Waitlist offers and service_id links: the guest has committed to the what.
    installFetch(venueCatalog());
    renderFlow({ venue: staffFirstVenue(), preselectedServiceId: PLAIN });

    await waitForStep(STEP.modeChoice);
    clickButton(/Book an appointment/i);
    await waitForStep(STEP.service);
    expect(screen.queryByTestId(STAFF_PICK)).not.toBeInTheDocument();
  });

  it('leaves a combined page alone until its own change lands', async () => {
    installFetch(combinedCatalog());
    renderFlow({ venue: staffFirstVenue({ is_collective: true }) });

    await waitForStep(STEP.service);
    expect(screen.queryByTestId(STAFF_PICK)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Calendar prefetching (plan 4.9 baseline)
// ---------------------------------------------------------------------------

describe('calendar prefetching', () => {
  it('warms every provider of the chosen service while the person step is open', async () => {
    const stub = installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    await waitFor(() => {
      const asked = stub.calendarRequests().map((p) => p.get('practitioner_id'));
      expect(asked).toContain(ADA.id);
      expect(asked).toContain(BEN.id);
    });
  });

  it('does not warm the pool while it is switched off', async () => {
    const stub = installFetch(venueCatalog());
    renderFlow();
    await startSingleBooking();

    clickService('Plain Service');
    await waitForStep(STEP.practitioner);

    await waitFor(() => {
      expect(stub.calendarRequests().length).toBeGreaterThan(0);
    });
    expect(stub.countMatching('any_available=1')).toBe(0);
  });

  it('warms a single-service venue from the service list itself', async () => {
    // The one-service shortcut (a very common salon setup) starts loading month
    // grids for every provider before the guest has picked anything.
    const singleService = venueCatalog().map((p) => ({
      ...p,
      services: p.services.filter((s) => s.id === PLAIN),
    }));
    const stub = installFetch(singleService);
    renderFlow();
    await startSingleBooking();

    await waitFor(() => {
      const asked = stub.calendarRequests().map((p) => p.get('practitioner_id'));
      expect(asked).toContain(ADA.id);
      expect(asked).toContain(BEN.id);
    });
  });
});
