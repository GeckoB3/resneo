/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';

/**
 * The staff "override availability" tick box (Docs/staff-availability-override-plan.md).
 *
 * With it ticked the flow stops asking the engine: the catalogue is every person
 * with every service (unassigned ones marked), the date and time are typed, the
 * review step lists what the engine would have refused for, and the create call
 * carries `override_availability`. Unticking clears every choice, and the public
 * flow never sees the box.
 *
 * Boundary: walks stop at the create POST.
 */
const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };
const BEN = { id: 'prac-ben', name: 'Ben' };
const CUT = 'svc-cut';
const COLOUR = 'svc-colour';

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

type CatalogService = Record<string, unknown> & { id: string };
function service(id: string, name: string, extra: Partial<CatalogService> = {}): CatalogService {
  return {
    id,
    name,
    description: null,
    duration_minutes: 30,
    buffer_minutes: 0,
    price_pence: 3000,
    deposit_pence: null,
    payment_requirement: 'none',
    sort_order: 0,
    cancellation_notice_hours: 24,
    ...extra,
  };
}

/** The ordinary catalogue: Ada does the Cut, Ben does the Colour. */
function catalog() {
  return [
    { ...ADA, services: [service(CUT, 'Cut')] },
    { ...BEN, services: [service(COLOUR, 'Colour')] },
  ];
}
/** The override catalogue: everyone with everything, `assigned` saying which is real. */
function overrideCatalog() {
  return [
    { ...ADA, services: [service(CUT, 'Cut', { assigned: true }), service(COLOUR, 'Colour', { assigned: false })] },
    { ...BEN, services: [service(CUT, 'Cut', { assigned: false }), service(COLOUR, 'Colour', { assigned: true })] },
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

type Call = { url: string; body: Record<string, unknown> };
function installFetch(): { creates: Call[]; validates: Call[]; catalogUrls: string[]; availabilityCalls: number } {
  const state = { creates: [] as Call[], validates: [] as Call[], catalogUrls: [] as string[], availabilityCalls: 0 };
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (url.includes('/api/booking/appointment-catalog')) {
      state.catalogUrls.push(url);
      return jsonResponse({ practitioners: url.includes('override=1') ? overrideCatalog() : catalog() });
    }
    if (url.includes('appointment-calendar')) {
      return jsonResponse({ available_dates: [todayYmd()] });
    }
    if (url.includes('validate-appointment-slot')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      state.validates.push({ url, body });
      return jsonResponse(
        body.override_availability
          ? { ok: true, warnings: ['Outside working hours', 'Conflicts with another booking'] }
          : { ok: true },
      );
    }
    if (url.includes('/api/booking/create-multi-service') || url.includes('/api/venue/bookings')) {
      state.creates.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return jsonResponse({
        booking_id: 'booking-1',
        booking_ids: ['booking-1'],
        primary_booking_id: 'booking-1',
        requires_deposit: false,
        total_deposit_pence: 0,
        deposit_amount_pence: 0,
        cancellation_notice_hours: 24,
        availability_override_warnings: ['Outside working hours'],
      });
    }
    if (url.includes('/api/booking/availability')) {
      state.availabilityCalls += 1;
      return jsonResponse({ practitioners: [] });
    }
    return jsonResponse({});
  });
  vi.stubGlobal('fetch', impl);
  return state;
}

type FlowProps = Parameters<typeof AppointmentBookingFlow>[0];
function renderStaffFlow(props: Partial<FlowProps> = {}) {
  return render(
    <AppointmentBookingFlow venue={venue()} bookingAudience="staff" staffBookingSource="phone" {...props} />,
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
const toggle = () => screen.getByTestId('availability-override-toggle') as HTMLInputElement;
function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Tick the box, book Ada for the Colour she does not offer, at 07:00 today. */
async function walkToReview(): Promise<void> {
  await waitForStep('Select a service');
  fireEvent.click(toggle());
  await waitForNoSkeletons();
  await waitFor(() => expect(screen.getByRole('button', { name: /Colour/i })).toBeInTheDocument());
  clickButton(/Colour/i);
  clickButton(/^Continue$/);
  await waitForStep('Who would you like to see?');
  fireEvent.click(screen.getByRole('button', { name: /\bAda\b/i }));
  await waitForStep('Date and time');
  const picker = within(screen.getByTestId('override-date-time'));
  fireEvent.change(picker.getByLabelText(/^Start time/i), { target: { value: '07:00' } });
  fireEvent.click(picker.getByRole('button', { name: /^Continue$/ }));
  await waitForStep('Review your services');
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the tick box', () => {
  it('is on the staff member’s first step and reloads the catalogue with every person and service', async () => {
    const state = installFetch();
    renderStaffFlow();
    await waitForStep('Select a service');
    expect(toggle()).not.toBeChecked();
    // The ordinary catalogue lists only what people are assigned.
    expect(screen.getByRole('button', { name: /Cut/i })).toBeInTheDocument();
    fireEvent.click(toggle());
    await waitFor(() => expect(state.catalogUrls.some((u) => u.includes('override=1'))).toBe(true));
    await waitForNoSkeletons();
    expect(screen.getByRole('button', { name: /Colour/i })).toBeInTheDocument();
  });

  it('is never shown to the public', async () => {
    installFetch();
    render(<AppointmentBookingFlow venue={venue()} bookingAudience="public" />);
    await waitForNoSkeletons();
    expect(screen.queryByTestId('availability-override-toggle')).toBeNull();
  });

  it('lists a person who does not usually offer the service, and says so', async () => {
    installFetch();
    renderStaffFlow();
    await waitForStep('Select a service');
    fireEvent.click(toggle());
    await waitForNoSkeletons();
    clickButton(/Colour/i);
    clickButton(/^Continue$/);
    await waitForStep('Who would you like to see?');
    const ada = screen.getByRole('button', { name: /\bAda\b/i });
    expect(within(ada).getByText(/Does not usually offer this service/i)).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /\bBen\b/i })).queryByText(/Does not usually offer/i)).toBeNull();
  });
});

describe('date, time and review', () => {
  it('replaces the slot list with a typed date and time, never asking for availability', async () => {
    const state = installFetch();
    renderStaffFlow();
    await walkToReview();
    expect(state.availabilityCalls).toBe(0);
  });

  it('checks the chain with the override and shows what it overrides', async () => {
    const state = installFetch();
    renderStaffFlow();
    await walkToReview();
    expect(state.validates.length).toBeGreaterThan(0);
    expect(state.validates[0]!.body.override_availability).toBe(true);
    expect(state.validates[0]!.body.start_time).toMatch(/^07:00/);
    const box = within(screen.getByTestId('override-warnings'));
    expect(box.getByText(/What this overrides/i)).toBeInTheDocument();
    expect(box.getByText(/Colour: Outside working hours/i)).toBeInTheDocument();
    expect(box.getByText(/Colour: Conflicts with another booking/i)).toBeInTheDocument();
  });

  it('refuses a past date before asking the server', async () => {
    const state = installFetch();
    renderStaffFlow();
    await waitForStep('Select a service');
    fireEvent.click(toggle());
    await waitForNoSkeletons();
    clickButton(/Colour/i);
    clickButton(/^Continue$/);
    await waitForStep('Who would you like to see?');
    fireEvent.click(screen.getByRole('button', { name: /\bAda\b/i }));
    await waitForStep('Date and time');
    const picker = within(screen.getByTestId('override-date-time'));
    fireEvent.change(picker.getByLabelText(/^Date/i), { target: { value: '2020-01-01' } });
    fireEvent.change(picker.getByLabelText(/^Start time/i), { target: { value: '09:00' } });
    fireEvent.click(picker.getByRole('button', { name: /^Continue$/ }));
    await waitFor(() => expect(screen.getByText(/Choose today or a later date/i)).toBeInTheDocument());
    expect(state.validates).toHaveLength(0);
  });
});

describe('saving and unticking', () => {
  it('posts override_availability with the booking', async () => {
    const state = installFetch();
    renderStaffFlow();
    await walkToReview();
    clickButton(/Continue to details/i);
    await screen.findByPlaceholderText('First name');
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText('Surname'), { target: { value: 'Guest' } });
    const phone = document.querySelector('#details-phone');
    if (phone) fireEvent.change(phone, { target: { value: '02071234567' } });
    fireEvent.click(screen.getByRole('button', { name: /^(Confirm Booking|Continue to payment)$/i }));
    await waitFor(() => expect(state.creates.length).toBe(1));
    expect(state.creates[0]!.body.override_availability).toBe(true);
    expect(state.creates[0]!.body.practitioner_id).toBe(ADA.id);
    expect(state.creates[0]!.body.appointment_service_id).toBe(COLOUR);
    expect(state.creates[0]!.body.booking_time).toMatch(/^07:00/);
  });

  it('unticking clears the choices and goes back to the first step with the ordinary catalogue', async () => {
    installFetch();
    renderStaffFlow();
    await walkToReview();
    // Back to the service step to reach the box again.
    clickButton(/^Back$/);
    await waitForStep('Date and time');
    clickButton(/^Back$/);
    await waitForStep('Who would you like to see?');
    clickButton(/^Back$/);
    await waitForStep('Select a service');
    expect(toggle()).toBeChecked();
    fireEvent.click(toggle());
    await waitForNoSkeletons();
    expect(toggle()).not.toBeChecked();
    // Colour is Ben's only; the ordinary list no longer offers it to nobody in particular.
    expect(screen.getByRole('button', { name: /Cut/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Continue$/ })).toBeNull();
  });
});
