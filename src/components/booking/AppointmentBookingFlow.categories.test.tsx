/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * The service step groups by category exactly as the catalog says: this is the
 * wiring between `/api/booking/appointment-catalog` and `ServiceCategoryList`,
 * which the component's own tests cannot see. A venue without categories must
 * still get the flat list, or every other flow test would already be red.
 */

const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };

const hair: ServiceCategoryRef = { id: 'cat-hair', name: 'Hair', sort_order: 0 };
const nails: ServiceCategoryRef = { id: 'cat-nails', name: 'Nails', sort_order: 1 };

function service(id: string, name: string, sort_order: number, category: ServiceCategoryRef | null) {
  return {
    id,
    name,
    description: null,
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: 3000,
    deposit_pence: null,
    payment_requirement: 'none',
    sort_order,
    cancellation_notice_hours: 24,
    category,
  };
}

function categorisedCatalog() {
  return {
    practitioners: [
      {
        ...ADA,
        services: [
          service('svc-kit', 'Aftercare kit', 0, null),
          service('svc-mani', 'Manicure', 0, nails),
          service('svc-colour', 'Colour', 1, hair),
          service('svc-cut', 'Cut', 0, hair),
        ],
      },
    ],
    categories: [hair, nails],
  };
}

function flatCatalog() {
  return {
    practitioners: [{ ...ADA, services: [service('svc-cut', 'Cut', 0, null), service('svc-colour', 'Colour', 1, null)] }],
    categories: [],
  };
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function installFetch(catalog: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url.includes('/api/booking/appointment-catalog')) return jsonResponse(catalog);
      if (url.includes('appointment-calendar')) return jsonResponse({ available_dates: [] });
      return jsonResponse({ slots: [], practitioners: [] });
    }),
  );
}

async function openServiceStep(venueOverrides: Partial<VenuePublic> = {}) {
  render(<AppointmentBookingFlow venue={venue(venueOverrides)} />);
  await screen.findByRole('heading', { name: 'How would you like to book?' });
  fireEvent.click(screen.getByRole('button', { name: /Book an appointment/i }));
  await screen.findByRole('heading', { name: 'Select a service' });
  await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('service step with categories', () => {
  it('lists headed sections in category order with a menu, and a service still advances', async () => {
    installFetch(categorisedCatalog());
    await openServiceStep();

    const nav = screen.getByRole('navigation', { name: /service categories/i });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hair2', 'Nails1', 'Other services1']);

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Hair2', 'Nails1', 'Other services1']);

    // Category order first, then the venue's own order inside each, uncategorised last.
    const rows = screen
      .getAllByRole('button')
      .filter((b) => !nav.contains(b) && /£30\.00/.test(b.textContent ?? ''))
      .map((b) => b.textContent);
    expect(rows.map((t) => t?.replace(/30 min.*$/, '').trim())).toEqual(['Cut', 'Colour', 'Manicure', 'Aftercare kit']);

    fireEvent.click(screen.getByRole('button', { name: /Manicure/i }));
    await screen.findByRole('heading', { name: 'Who would you like to see?' });
  });

  it('collapsible categories: every category starts closed and opens on demand', async () => {
    installFetch(categorisedCatalog());
    await openServiceStep({ booking_page_config: { services_layout: 'accordion' } });

    expect(screen.queryByRole('navigation', { name: /service categories/i })).toBeNull();
    const hairHeader = screen.getByRole('button', { name: /^Hair/ });
    const nailsHeader = screen.getByRole('button', { name: /^Nails/ });
    expect(hairHeader).toHaveAttribute('aria-expanded', 'false');
    expect(nailsHeader).toHaveAttribute('aria-expanded', 'false');

    // A closed category's services are out of the accessibility tree until it opens.
    expect(screen.queryByRole('button', { name: /Cut/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Manicure/i })).toBeNull();
    fireEvent.click(nailsHeader);
    expect(nailsHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Manicure/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cut/i })).toBeNull();
  });

  it('a venue with no categories keeps the flat list', async () => {
    installFetch(flatCatalog());
    await openServiceStep();
    expect(screen.queryByRole('navigation', { name: /service categories/i })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getByRole('button', { name: /Cut/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Colour/i })).toBeInTheDocument();
  });
});
