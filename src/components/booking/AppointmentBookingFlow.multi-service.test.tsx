/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';

/**
 * The multi-service picker (Docs/multi-service-picker-plan.md): several
 * services are ticked on the list, their options are collected before the
 * times, the person list narrows to whoever offers them all, and the day view
 * is asked for the whole chain at once.
 */

const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };
const BEN = { id: 'prac-ben', name: 'Ben' };

const HAIRCUT = 'svc-haircut';
const COLOUR = 'svc-colour';
const WAXING = 'svc-waxing';
const NAILS = 'svc-nails';
const BROWS = 'svc-brows';

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type CatalogService = Record<string, unknown> & { id: string };
type CatalogPractitioner = { id: string; name: string; services: CatalogService[] };

function service(id: string, name: string, pricePence: number, extra: Partial<CatalogService> = {}): CatalogService {
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

/** One optional single-select group, so nothing blocks Continue by default. */
function addonGroup(groupId: string, addonId: string) {
  return {
    group: {
      id: groupId,
      venue_id: VENUE_ID,
      name: 'Treatment',
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
        name: 'Gloss',
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

/** Ada does everything; Ben only cuts. Colour has an optional add-on group. */
function catalog(): CatalogPractitioner[] {
  return [
    {
      ...ADA,
      services: [
        service(HAIRCUT, 'Haircut', 3000),
        service(COLOUR, 'Colour', 6000, { duration_minutes: 60, addon_groups: [addonGroup('grp-gloss', 'addon-gloss')] }),
        service(WAXING, 'Waxing', 1500, { duration_minutes: 15 }),
        service(NAILS, 'Nails', 2500, { duration_minutes: 20 }),
        service(BROWS, 'Brows', 1000, { duration_minutes: 10 }),
      ],
    },
    { ...BEN, services: [service(HAIRCUT, 'Haircut', 3500)] },
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

type CreateCall = { url: string; body: Record<string, unknown> };

function installFetch(): { urls: string[]; creates: CreateCall[] } {
  const urls: string[] = [];
  const creates: CreateCall[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    urls.push(url);
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    if (url.includes('/api/booking/appointment-catalog')) return jsonResponse({ practitioners: catalog() });
    if (url.includes('appointment-calendar')) return jsonResponse({ available_dates: [todayYmd()] });
    if (url.includes('validate-appointment-slot')) return jsonResponse({ ok: true, valid: true });
    if (url.includes('/api/booking/create') || url.includes('/api/venue/bookings')) {
      creates.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return jsonResponse({
        booking_id: 'booking-1',
        booking_ids: ['booking-1', 'booking-2'],
        primary_booking_id: 'booking-1',
        requires_deposit: false,
        total_deposit_pence: 0,
        deposit_amount_pence: 0,
        cancellation_notice_hours: 24,
      });
    }
    if (url.includes('/api/booking/availability')) {
      const serviceId = params.get('service_id') ?? HAIRCUT;
      const practitionerId = params.get('practitioner_id') ?? ADA.id;
      const source = catalog().find((p) => p.id === practitionerId) ?? catalog()[0]!;
      return jsonResponse({
        practitioners: [
          {
            id: practitionerId,
            name: source.name,
            services: source.services,
            slots: ['10:00:00', '14:00:00'].map((start_time) => ({
              start_time,
              service_id: serviceId,
              duration_minutes: 30,
              price_pence: 3000,
              practitioner_id: practitionerId,
              practitioner_name: source.name,
            })),
          },
        ],
      });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', impl);
  return { urls, creates };
}

async function waitForNoSkeletons(): Promise<void> {
  await waitFor(() => expect(document.querySelector('.animate-pulse')).toBeNull());
}
async function waitForStep(heading: string): Promise<void> {
  await screen.findByRole('heading', { name: heading });
  await waitForNoSkeletons();
}
function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}
function serviceCard(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${name}\\b`, 'i') });
}
function tick(name: string): void {
  fireEvent.click(serviceCard(name));
}
function clickPractitioner(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`\\b${name}\\b`, 'i') }));
}
function chainParam(urls: string[]): Array<{ service_id: string }> | null {
  const url = [...urls].reverse().find((u) => u.includes('/api/booking/availability'));
  if (!url) return null;
  const raw = new URLSearchParams(url.split('?')[1] ?? '').get('services');
  return raw ? (JSON.parse(raw) as Array<{ service_id: string }>) : null;
}

async function startSingleBooking(): Promise<void> {
  await waitForStep('How would you like to book?');
  clickButton(/Book an appointment/i);
  await waitForStep('Select a service');
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the picker', () => {
  it('sums the ticked services and only moves on from Continue', async () => {
    installFetch();
    render(<AppointmentBookingFlow venue={venue()} />);
    await startSingleBooking();

    // Nothing ticked: no bar and no Continue, so there is nothing to press by mistake.
    expect(screen.queryByTestId('service-picker-bar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Continue$/ })).not.toBeInTheDocument();

    tick('Haircut');
    tick('Waxing');
    const bar = screen.getByTestId('service-picker-bar');
    expect(serviceCard('Haircut')).toHaveAttribute('aria-pressed', 'true');
    expect(bar).toHaveTextContent('2 services');
    expect(bar).toHaveTextContent('45 min');
    expect(bar).toHaveTextContent('Haircut + Waxing');
    // Still on the list: ticking does not navigate.
    expect(screen.getByRole('heading', { name: 'Select a service' })).toBeInTheDocument();

    // Ticking again unticks, and clearing the last one takes the bar away.
    tick('Waxing');
    expect(serviceCard('Waxing')).toHaveAttribute('aria-pressed', 'false');
    expect(bar).toHaveTextContent('1 service');
    tick('Haircut');
    expect(screen.queryByTestId('service-picker-bar')).not.toBeInTheDocument();
  });

  it('stops at four services', async () => {
    installFetch();
    render(<AppointmentBookingFlow venue={venue()} />);
    await startSingleBooking();

    for (const name of ['Haircut', 'Colour', 'Waxing', 'Nails', 'Brows']) tick(name);
    expect(serviceCard('Brows')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('service-picker-bar')).toHaveTextContent('4 services');
    expect(screen.getByTestId('service-picker-bar')).toHaveTextContent(/most you can book/i);
  });
});

describe('a visit of several services, as a guest', () => {
  it('asks the extra service its options, narrows the people, and fetches the whole chain', async () => {
    const stub = installFetch();
    render(<AppointmentBookingFlow venue={venue()} />);
    await startSingleBooking();

    tick('Haircut');
    tick('Colour');
    clickButton(/^Continue$/);

    // Colour is the second service and has add-ons: asked before the person.
    await waitForStep('Add extras to Colour');
    clickButton(/^Continue$/);

    await waitForStep('Who would you like to see?');
    expect(screen.getByRole('button', { name: /\bAda\b/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /\bBen\b/i })).not.toBeInTheDocument();
    clickPractitioner('Ada');

    await waitForStep('Date and time');
    expect(screen.getByText('Haircut + Colour')).toBeInTheDocument();
    await screen.findByRole('button', { name: '10:00' });
    expect(chainParam(stub.urls)).toEqual([{ service_id: HAIRCUT }, { service_id: COLOUR }]);

    fireEvent.click(screen.getByRole('button', { name: '10:00' }));
    await waitForStep('Review your services');
    expect(screen.getByText('Haircut')).toBeInTheDocument();
    expect(screen.getByText('Colour')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add another service/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change services/i })).toBeInTheDocument();
  });

  it('returns to the picker with the same services ticked from "Change services"', async () => {
    installFetch();
    render(<AppointmentBookingFlow venue={venue()} />);
    await startSingleBooking();

    tick('Haircut');
    tick('Waxing');
    clickButton(/^Continue$/);
    await waitForStep('Who would you like to see?');
    clickPractitioner('Ada');
    await waitForStep('Date and time');
    fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
    await waitForStep('Review your services');

    clickButton(/Change services/i);
    await waitForStep('Select a service');
    expect(serviceCard('Haircut')).toHaveAttribute('aria-pressed', 'true');
    expect(serviceCard('Waxing')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('service-picker-bar')).toHaveTextContent('2 services');
  });
});

describe('a visit of several services, taken by staff', () => {
  it('posts one create-multi-service with the services back to back', async () => {
    const stub = installFetch();
    render(<AppointmentBookingFlow venue={venue()} bookingAudience="staff" staffBookingSource="phone" />);
    await waitForStep('Select a service');

    tick('Haircut');
    tick('Waxing');
    clickButton(/^Continue$/);
    await waitForStep('Who would you like to see?');
    clickPractitioner('Ada');
    await waitForStep('Date and time');
    fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
    await waitForStep('Review your services');

    clickButton(/Continue to details/i);
    await screen.findByPlaceholderText('First name');
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText('Surname'), { target: { value: 'Guest' } });
    const phone = document.querySelector('#details-phone');
    if (phone) fireEvent.change(phone, { target: { value: '02071234567' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm Booking|Continue to payment)$/i }));

    await waitFor(() => expect(stub.creates.length).toBe(1));
    const create = stub.creates[0]!;
    expect(create.url).toContain('create-multi-service');
    const services = create.body.services as Array<Record<string, unknown>>;
    expect(services.map((s) => [s.service_id, s.practitioner_id, s.start_time])).toEqual([
      [HAIRCUT, ADA.id, '10:00'],
      [WAXING, ADA.id, '10:30'],
    ]);
  });
});

describe('a group booking', () => {
  it('turns one person with two services into two rows under one card', async () => {
    installFetch();
    render(<AppointmentBookingFlow venue={venue()} />);
    await waitForStep('How would you like to book?');
    clickButton(/Group appointment/i);
    await waitForStep('Group Booking');

    clickButton(/Add a person/i);
    await waitForStep('Who is this appointment for?');
    fireEvent.change(screen.getByPlaceholderText(/Guest name or label/i), { target: { value: 'Sam' } });
    clickButton(/^Continue$/);
    await screen.findByText('Booking for: Sam');

    tick('Haircut');
    tick('Waxing');
    clickButton(/^Continue$/);
    await waitForStep('Choose staff');
    expect(screen.queryByRole('button', { name: /\bBen\b/i })).not.toBeInTheDocument();
    clickPractitioner('Ada');
    await screen.findByRole('heading', { name: 'Pick a time for Sam' });
    expect(screen.getByText(/Haircut \+ Waxing/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
    await waitForStep('Group Booking');

    expect(screen.getByText(/1 person added/i)).toBeInTheDocument();
    expect(screen.getByText('Haircut with Ada')).toBeInTheDocument();
    expect(screen.getByText('Waxing with Ada')).toBeInTheDocument();
    expect(screen.getByText(/at 10:30/)).toBeInTheDocument();

    // Removing the person takes both rows with it.
    fireEvent.click(screen.getByTitle('Remove'));
    await screen.findByText(/Add each person and their services/i);
  });
});
