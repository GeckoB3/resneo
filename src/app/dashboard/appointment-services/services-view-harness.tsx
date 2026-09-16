/**
 * A test harness for the Services page (`AppointmentServicesView`).
 *
 * The page is the venue's whole service catalogue: it loads three endpoints, renders a card per
 * service with its pills and switches, opens a form that saves through two more endpoints, and
 * answers a handful of dialogs. It had no test of its own, so every change to it was covered only
 * by the component and API tests around it. This mounts the real page against a fetch router, so a
 * test can say "these services came back" and then assert on what a venue sees and what it sends.
 *
 * Only what the page cannot run without is stubbed: routing, the feature-flag and entitlement
 * hooks, and `fetch`. Everything else (state, effects, the form, dnd-kit, the dialogs) is real,
 * which is the point of the harness.
 *
 * A test file starts with the mocks, because `vi.mock` is hoisted and must sit in the test file
 * itself, then renders through this harness:
 *
 *   vi.mock('next/navigation', () => ({
 *     useSearchParams: () => new URLSearchParams(),
 *     useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
 *     usePathname: () => '/dashboard/appointment-services',
 *   }));
 *   vi.mock('@/components/providers/VenueFeatureFlagsProvider', () => ({
 *     useAppointmentsFeatureFlag: () => false,
 *   }));
 *   vi.mock('@/lib/hooks/use-venue-wide-blocks', () => ({ useVenueWideBlocks: () => [] }));
 *   vi.mock('@/hooks/use-calendar-entitlement', () => ({
 *     useCalendarEntitlement: () => ({ entitlement: null, entitlementLoaded: true, refresh: vi.fn() }),
 *     canAddCalendarColumn: () => true,
 *   }));
 *
 *   const world = renderServicesView(AppointmentServicesView, { services: [harnessService()] });
 *   await world.ready();
 *   expect(world.requests('PATCH', '/api/venue/appointment-services')[0].body).toMatchObject({ ... });
 */
import { expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';

export interface HarnessService {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

export interface ServicesViewWorld {
  /** Every request the page made, in order. */
  calls: RecordedRequest[];
  /** The requests to one endpoint, by method and URL prefix. */
  requests: (method: string, urlPrefix: string) => RecordedRequest[];
  /** Resolves once the first load has painted, so the skeleton is gone. */
  ready: () => Promise<void>;
  /** Answer the NEXT call to this endpoint with a given status and body, once. */
  reply: (method: string, urlPrefix: string, status: number, body: unknown) => void;
  rerender: (ui: ReactElement) => void;
}

export interface ServicesViewOptions {
  services?: HarnessService[];
  practitionerServices?: Record<string, unknown>[];
  categories?: Record<string, unknown>[];
  /** Host admins only: every calendar in the collective (contract 5). */
  collectiveCalendars?: Record<string, unknown>[];
  practitioners?: Record<string, unknown>[];
  isAdmin?: boolean;
  linkedPractitionerIds?: string[];
  currency?: string;
  stripeConnected?: boolean;
  /** Extra routes, or overrides, keyed by "METHOD /path-prefix". */
  routes?: Record<string, { status?: number; body?: unknown }>;
}

/** A service row shaped like the dashboard API's, so a test names only what it cares about. */
export function harnessService(overrides: Partial<HarnessService> = {}): HarnessService {
  return {
    id: 'svc-1',
    name: 'Facial',
    description: null,
    duration_minutes: 60,
    buffer_minutes: 0,
    price_pence: 6000,
    deposit_pence: null,
    payment_requirement: 'none',
    colour: '#3B82F6',
    is_active: true,
    is_bookable_online: true,
    sort_order: 0,
    category_id: null,
    updated_at: '2026-09-16T09:00:00Z',
    max_advance_booking_days: 90,
    min_booking_notice_hours: 1,
    cancellation_notice_hours: 48,
    allow_same_day_booking: true,
    booking_interval_minutes: 15,
    booking_minute_marks: null,
    booking_start_times: null,
    custom_availability_enabled: false,
    custom_working_hours: null,
    variants: [],
    addon_groups: [],
    processing_time_blocks: [],
    location_type: 'business_venue',
    staff_may_customize_name: false,
    staff_may_customize_description: false,
    staff_may_customize_duration: false,
    staff_may_customize_buffer: false,
    staff_may_customize_price: false,
    staff_may_customize_deposit: false,
    staff_may_customize_colour: false,
    collective: null,
    ...overrides,
  };
}

/** A calendar row shaped like /api/venue/practitioners?roster=1. */
export function harnessCalendar(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'cal-1', name: 'Room 1', is_active: true, calendar_type: 'staff', working_hours: {}, ...overrides };
}

/** What a service on the collective page carries, for the pills and the calendars section. */
export function harnessCollectiveBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    role: 'master',
    collective_id: 'collective-1',
    collective_name: 'Northside',
    host_venue_name: 'Host Venue',
    item_id: 'item-1',
    locked_fields: ['staff_may_customize_name', 'staff_may_customize_description'],
    delegated_fields: [],
    status: 'up_to_date',
    status_reason: null,
    last_applied_at: null,
    hidden_reasons: [],
    ...overrides,
  };
}

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });

/** Mount the page with a fetch router. Pass the page component in, so the test file's mocks apply. */
export function renderServicesView(
  View: ComponentType<{
    isAdmin: boolean;
    currency?: string;
    stripeConnected?: boolean;
    linkedPractitionerIds?: string[];
    currentStaffId?: string | null;
  }>,
  options: ServicesViewOptions = {},
): ServicesViewWorld {
  const calls: RecordedRequest[] = [];
  const queued: Array<{ method: string; urlPrefix: string; status: number; body: unknown }> = [];

  const routes: Record<string, { status?: number; body?: unknown }> = {
    'GET /api/venue': { body: { opening_hours: null, venue_opening_exceptions: [] } },
    'GET /api/venue/appointment-services': {
      body: {
        services: options.services ?? [],
        practitioner_services: options.practitionerServices ?? [],
        categories: options.categories ?? [],
        ...(options.collectiveCalendars ? { collective_calendars: options.collectiveCalendars } : {}),
      },
    },
    'GET /api/venue/practitioners': { body: { practitioners: options.practitioners ?? [harnessCalendar()] } },
    'GET /api/venue/compliance/requirements': { body: { requirements: [] } },
    'PATCH /api/venue/appointment-services': { body: { id: 'svc-1' } },
    'POST /api/venue/appointment-services': { body: { id: 'svc-new' } },
    ...(options.routes ?? {}),
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = null;
        }
      }
      calls.push({ method, url, body });

      const queuedIndex = queued.findIndex((q) => q.method === method && url.startsWith(q.urlPrefix));
      if (queuedIndex >= 0) {
        const reply = queued.splice(queuedIndex, 1)[0]!;
        return jsonResponse(reply.status, reply.body);
      }

      const key = Object.keys(routes)
        .filter((k) => {
          const [routeMethod, path] = k.split(' ');
          return routeMethod === method && url.startsWith(path!);
        })
        // The longest matching path wins, so "/api/venue" never answers for
        // "/api/venue/appointment-services".
        .sort((a, b) => b.length - a.length)[0];
      const route = key ? routes[key] : undefined;
      return jsonResponse(route?.status ?? 200, route?.body ?? {});
    }),
  );

  const view = render(
    <View
      isAdmin={options.isAdmin ?? true}
      currency={options.currency ?? 'GBP'}
      stripeConnected={options.stripeConnected ?? true}
      linkedPractitionerIds={options.linkedPractitionerIds ?? []}
    />,
  );

  return {
    calls,
    requests: (method, urlPrefix) =>
      calls.filter((c) => c.method === method.toUpperCase() && c.url.startsWith(urlPrefix)),
    ready: async () => {
      await waitFor(() =>
        expect(calls.some((c) => c.url.startsWith('/api/venue/appointment-services'))).toBe(true),
      );
      await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull());
    },
    reply: (method, urlPrefix, status, body) =>
      queued.push({ method: method.toUpperCase(), urlPrefix, status, body }),
    rerender: view.rerender,
  };
}

/** The card around one service, by its name, for assertions scoped to that card. */
export function serviceCard(name: string): HTMLElement {
  const heading = screen.getByText(name);
  const card = heading.closest('section') ?? heading.closest('div[class*="rounded"]');
  if (!card) throw new Error(`No card found around "${name}"`);
  return card as HTMLElement;
}

export { within };
