/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';

/**
 * Staff must always be able to take a booking without collecting money, for
 * every shape of booking: one service, several services in one visit, variants,
 * add-ons, and services that ask for payment in full.
 *
 * That was true of single-service bookings and false of everything else. The
 * checkbox was gated on `!(segments.length > 1)`, the exact inverse of the
 * branch that posts to `create-multi-service`, so it disappeared for precisely
 * the bookings that needed it. A staff two-service visit of a deposit-taking
 * service landed `Pending` with a Stripe payment step and no way past it.
 *
 * These walks go all the way to the create call and read the posted body,
 * because the checkbox rendering and the field reaching the server were two
 * separate halves of the same bug: the visit routes had no `require_deposit`
 * in their schema at all, so a checkbox alone would have changed nothing.
 *
 * Boundary: walks stop at the create POST. Mounting payment would boot Stripe.
 */

const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };

const DEPOSIT_A = 'svc-deposit-a';
const DEPOSIT_B = 'svc-deposit-b';
const FULL_PAY = 'svc-full-pay';
const FREE = 'svc-free';

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type CatalogService = Record<string, unknown> & { id: string };

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

/** Two deposit services (£10 + £15), one pay-in-full (£60), one free. */
function catalog() {
  return [
    {
      ...ADA,
      services: [
        service(DEPOSIT_A, 'Deposit Service A', 4000, {
          payment_requirement: 'deposit',
          deposit_pence: 1000,
        }),
        service(DEPOSIT_B, 'Deposit Service B', 5000, {
          payment_requirement: 'deposit',
          deposit_pence: 1500,
        }),
        service(FULL_PAY, 'Full Pay Service', 6000, { payment_requirement: 'full_payment' }),
        service(FREE, 'Free Service', 3000),
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

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

type CreateCall = { url: string; body: Record<string, unknown> };

function installFetch(): { creates: CreateCall[] } {
  const creates: CreateCall[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const params = new URLSearchParams(url.split('?')[1] ?? '');

    if (url.includes('/api/booking/appointment-catalog')) {
      return jsonResponse({ practitioners: catalog() });
    }
    if (url.includes('appointment-calendar')) {
      return jsonResponse({ available_dates: [todayYmd()] });
    }
    if (url.includes('validate-appointment-slot')) {
      return jsonResponse({ ok: true, valid: true });
    }
    if (url.includes('/api/booking/create-multi-service') || url.includes('/api/venue/bookings')) {
      creates.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      // Answer as the server does once the charge is waived: nothing to pay, so
      // the flow must land on confirmation rather than a payment step.
      return jsonResponse({
        booking_id: 'booking-1',
        booking_ids: ['booking-1'],
        primary_booking_id: 'booking-1',
        requires_deposit: false,
        total_deposit_pence: 0,
        deposit_amount_pence: 0,
        cancellation_notice_hours: 24,
      });
    }
    if (url.includes('/api/booking/availability')) {
      const serviceId = params.get('service_id') ?? DEPOSIT_A;
      const offer = catalog()[0]!.services.find((s) => s.id === serviceId);
      return jsonResponse({
        practitioners: [
          {
            id: ADA.id,
            name: ADA.name,
            services: catalog()[0]!.services,
            slots: ['09:00:00', '10:00:00', '14:00:00'].map((start_time) => ({
              start_time,
              service_id: serviceId,
              duration_minutes: (offer?.duration_minutes as number) ?? 30,
              price_pence: (offer?.price_pence as number) ?? null,
              practitioner_id: ADA.id,
              practitioner_name: ADA.name,
            })),
          },
        ],
      });
    }
    return jsonResponse({});
  });

  vi.stubGlobal('fetch', impl);
  return { creates };
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

type FlowProps = Parameters<typeof AppointmentBookingFlow>[0];

function renderStaffFlow(props: Partial<FlowProps> = {}) {
  return render(
    <AppointmentBookingFlow
      venue={venue()}
      bookingAudience="staff"
      staffBookingSource="phone"
      {...props}
    />,
  );
}

async function waitForNoSkeletons(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
}

async function waitForStep(heading: string): Promise<void> {
  await screen.findByRole('heading', { name: heading });
  await waitForNoSkeletons();
}

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * Staff on a service-first venue open on the service list. Every service of
 * the visit is ticked there, then Continue; two or more make it multi-service.
 */
async function pickServicesAndSlot(serviceNames: string[]): Promise<void> {
  await waitForStep('Select a service');
  for (const name of serviceNames) clickButton(new RegExp(name, 'i'));
  clickButton(/^Continue$/);
  await waitForStep('Who would you like to see?');
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`\\b${ADA.name}\\b`, 'i') }));
  await waitForStep('Date and time');
  fireEvent.click(await screen.findByRole('button', { name: '10:00' }));
  await waitForStep('Review your services');
}

async function pickServiceAndSlot(serviceName: string): Promise<void> {
  await pickServicesAndSlot([serviceName]);
}

async function continueToDetails(): Promise<void> {
  clickButton(/Continue to details/i);
  await screen.findByPlaceholderText('First name');
}

/** Fills the minimum a staff booking needs and submits. */
async function submitDetails(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Sam' } });
  fireEvent.change(screen.getByPlaceholderText('Surname'), { target: { value: 'Guest' } });
  // The 07700 900xxx drama range is rejected as unparseable by the phone field.
  const phone = document.querySelector('#details-phone');
  if (phone) fireEvent.change(phone, { target: { value: '02071234567' } });
  // The label follows the checkbox: ticking it turns the booking into one with
  // a payment step, which is the whole point of the control.
  fireEvent.click(
    screen.getByRole('button', { name: /^(Confirm Booking|Continue to payment)$/i }),
  );
}

function chargeCheckbox(): HTMLElement | null {
  return screen.queryByRole('checkbox', { name: /Require (deposit|payment)/i });
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

describe('single service', () => {
  it('offers the deposit checkbox, unchecked', async () => {
    installFetch();
    renderStaffFlow();

    await pickServiceAndSlot('Deposit Service A');
    await continueToDetails();

    const box = chargeCheckbox();
    expect(box).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Require deposit \(£10\.00\)/i)).toBeInTheDocument();
  });

  it('offers no checkbox for a service that charges nothing', async () => {
    installFetch();
    renderStaffFlow();

    await pickServiceAndSlot('Free Service');
    await continueToDetails();

    expect(chargeCheckbox()).not.toBeInTheDocument();
  });
});

describe('multi-service visit', () => {
  it('offers the checkbox, which the segment count used to hide', async () => {
    installFetch();
    renderStaffFlow();

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();

    expect(chargeCheckbox()).toBeInTheDocument();
  });

  it('sums the deposit across the whole visit', async () => {
    installFetch();
    renderStaffFlow();

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();

    // £10 + £15, not the £10 of the first service alone.
    expect(screen.getByText(/Require deposit \(£25\.00\)/i)).toBeInTheDocument();
  });

  it('posts require_deposit false when the checkbox is left alone', async () => {
    const { creates } = installFetch();
    renderStaffFlow();

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();
    await submitDetails();

    await waitFor(() => expect(creates.length).toBe(1));
    expect(creates[0]!.url).toContain('create-multi-service');
    expect(creates[0]!.body.require_deposit).toBe(false);
  });

  it('posts require_deposit true once staff tick the box', async () => {
    const { creates } = installFetch();
    renderStaffFlow();

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();
    fireEvent.click(chargeCheckbox()!);
    await submitDetails();

    await waitFor(() => expect(creates.length).toBe(1));
    expect(creates[0]!.body.require_deposit).toBe(true);
  });
});

describe('pay-in-full services', () => {
  it('offers a checkbox instead of an unavoidable notice', async () => {
    installFetch();
    renderStaffFlow();

    await pickServiceAndSlot('Full Pay Service');
    await continueToDetails();

    const box = chargeCheckbox();
    expect(box).toBeInTheDocument();
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Require payment \(£60\.00\)/i)).toBeInTheDocument();
  });

  it('posts require_deposit false, so the booking confirms without payment', async () => {
    const { creates } = installFetch();
    renderStaffFlow();

    await pickServiceAndSlot('Full Pay Service');
    await continueToDetails();
    await submitDetails();

    await waitFor(() => expect(creates.length).toBe(1));
    expect(creates[0]!.body.require_deposit).toBe(false);
  });
});

describe('walk-ins', () => {
  it('offer no checkbox, because a walk-in never collects a deposit', async () => {
    installFetch();
    renderStaffFlow({ staffBookingSource: 'walk-in' });

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();

    expect(chargeCheckbox()).not.toBeInTheDocument();
  });

  it('post require_deposit false on a multi-service visit', async () => {
    const { creates } = installFetch();
    renderStaffFlow({ staffBookingSource: 'walk-in' });

    await pickServicesAndSlot(['Deposit Service A', 'Deposit Service B']);
    await continueToDetails();
    await submitDetails();

    await waitFor(() => expect(creates.length).toBe(1));
    expect(creates[0]!.body.require_deposit).toBe(false);
  });
});
