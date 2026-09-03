/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppointmentBookingFlow } from './AppointmentBookingFlow';
import type { VenuePublic } from './types';

/**
 * Stage 7 (decision J): what a guest sees when the server refuses to guess.
 *
 * `/api/booking/availability` now answers 503 when a schedule read failed open, rather than
 * returning a slot list built without one of its inputs. The client half is the part that
 * decides whether that is an improvement or a regression:
 *
 * Before, the fetch ignored `res.ok` and did `data.practitioners ?? []`, so a 503 rendered as
 * "No times available on <date> -- try a different date above". That is the SAME screen a
 * genuinely full day produces, and its advice is wrong in the worst way: the date is fine, so
 * a guest would work through every date and conclude the venue is booked solid. Shipping the
 * server change without this card would have traded a wrong-but-confident answer for a
 * confidently wrong instruction.
 *
 * These fixtures exist because that path could not be reached by driving the real UI: the
 * slot step sits inside a panel the headless browser could not open, so the route's 503 was
 * proven on staging while the card it feeds was not. This is the durable version of that
 * missing check.
 */

const VENUE_ID = 'venue-1';
const ADA = { id: 'prac-ada', name: 'Ada' };
const PLAIN = 'svc-plain';

function todayYmd(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

function venue(): VenuePublic {
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
  } as VenuePublic;
}

const CATALOG = [
  {
    ...ADA,
    services: [
      {
        id: PLAIN,
        name: 'Plain Service',
        description: null,
        duration_minutes: 30,
        buffer_minutes: 0,
        price_pence: 3000,
        deposit_pence: null,
        payment_requirement: 'none',
        sort_order: 0,
        cancellation_notice_hours: 24,
      },
    ],
  },
];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** The 503 the route returns when a schedule read failed open. */
function unavailableResponse(): Response {
  return jsonResponse(
    {
      unavailable: true,
      error: 'Availability is temporarily unavailable. Please try again in a moment.',
      retry_after_seconds: 15,
      tables: ['practitioner_leave_periods'],
    },
    503,
  );
}

function slotsResponse() {
  return jsonResponse({
    practitioners: [
      {
        id: ADA.id,
        name: ADA.name,
        services: CATALOG[0]!.services,
        slots: ['10:00:00'].map((start_time) => ({
          start_time,
          service_id: PLAIN,
          duration_minutes: 30,
          price_pence: 3000,
          practitioner_id: ADA.id,
          practitioner_name: ADA.name,
        })),
      },
    ],
  });
}

/**
 * `availabilityResponses` is consumed one call at a time, so a test can make the first
 * lookup fail and the retry succeed. That ordering IS the feature: a card that appears but
 * cannot recover would be no better than the wrong list it replaced.
 */
function installFetch(
  availabilityResponses: Array<() => Response>,
  calendarResponses?: Array<() => Response>,
) {
  let availabilityCalls = 0;
  let calendarCalls = 0;

  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input);

    if (url.includes('/api/booking/appointment-catalog')) return jsonResponse({ practitioners: CATALOG });
    if (url.includes('appointment-calendar')) {
      if (!calendarResponses) return jsonResponse({ available_dates: [todayYmd()] });
      const next = calendarResponses[Math.min(calendarCalls, calendarResponses.length - 1)]!;
      calendarCalls += 1;
      return next();
    }
    if (url.includes('/api/booking/availability')) {
      const next = availabilityResponses[Math.min(availabilityCalls, availabilityResponses.length - 1)]!;
      availabilityCalls += 1;
      return next();
    }
    return jsonResponse({});
  });

  vi.stubGlobal('fetch', impl);
  return { calls: () => availabilityCalls, calendarCalls: () => calendarCalls };
}

async function walkToSlots(): Promise<void> {
  await screen.findByText('How would you like to book?');
  fireEvent.click(screen.getByRole('button', { name: /Book an appointment/i }));

  await screen.findByText('Select a service');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Plain Service/i })).toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole('button', { name: /Plain Service/i }));
  fireEvent.click(screen.getByRole('button', { name: /^Continue$/ }));

  await screen.findByText('Who would you like to see?');
  await waitFor(() => expect(screen.getByRole('button', { name: /\bAda\b/i })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /\bAda\b/i }));

  await screen.findByText('Date and time');
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('slot lookup returning 503', () => {
  it('shows the retry card, not the "no times available" card', async () => {
    installFetch([unavailableResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    expect(await screen.findByText(/We could not load times for/i)).toBeInTheDocument();
    expect(
      screen.getByText(/temporary problem on our side, not a sign the day is full/i),
    ).toBeInTheDocument();

    // The wrong advice this card exists to avoid.
    expect(screen.queryByText(/No times available on/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Try a different date above/i)).not.toBeInTheDocument();
  });

  it('offers a Try again control', async () => {
    installFetch([unavailableResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    expect(await screen.findByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  /** A card that cannot recover is no better than the wrong list it replaced. */
  it('recovers when Try again succeeds, replaying the same lookup', async () => {
    const stub = installFetch([unavailableResponse, slotsResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    const retry = await screen.findByRole('button', { name: /Try again/i });
    const before = stub.calls();
    fireEvent.click(retry);

    expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(stub.calls()).toBeGreaterThan(before);
    expect(screen.queryByText(/We could not load times for/i)).not.toBeInTheDocument();
  });

  /** The 503 state must not stick once a later lookup succeeds. */
  it('does not show the card when the lookup succeeds', async () => {
    installFetch([slotsResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(screen.queryByText(/We could not load times for/i)).not.toBeInTheDocument();
  });

  /** House style: no em-dash in anything a guest reads. */
  it('uses no em-dash in the retry copy', async () => {
    installFetch([unavailableResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    const card = (await screen.findByText(/We could not load times for/i)).closest('div');
    expect(card?.textContent ?? '').not.toContain('—');
  });
});

/**
 * The MONTH path, which is the most exposed surface in the programme:
 * `appointment-month-availability.ts` carries twelve fail-open reads, more than any other
 * file, and a failure there does not remove one time, it removes whole DATES from the
 * picker. Rendered without this notice, a month the server refused to answer looks exactly
 * like a venue booked solid for weeks, and a guest has no reason to try again.
 */
describe('month lookup returning 503', () => {
  it('warns that the month could not be checked, without claiming it is full', async () => {
    installFetch([slotsResponse], [unavailableResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    expect(await screen.findByText(/We could not check which days are free/i)).toBeInTheDocument();
    expect(
      screen.getByText(/temporary problem on our side, not a sign the month is full/i),
    ).toBeInTheDocument();
  });

  /**
   * The flow loads more than one month while walking (it prefetches around the current
   * one), so "fail the first call, succeed after" cannot express this: a later success
   * clears the notice before the assertion runs. That clearing is CORRECT -- any month that
   * loads means the venue is reachable again -- so the test controls the switch explicitly
   * rather than counting calls.
   */
  it('offers a Try again that refetches the month', async () => {
    let healthy = false;
    const stub = installFetch(
      [slotsResponse],
      [() => (healthy ? jsonResponse({ available_dates: [todayYmd()] }) : unavailableResponse())],
    );
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    await screen.findByText(/We could not check which days are free/i);
    const before = stub.calendarCalls();

    healthy = true;
    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    await waitFor(() => expect(stub.calendarCalls()).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.queryByText(/We could not check which days are free/i)).not.toBeInTheDocument(),
    );
  });

  it('stays absent when the month lookup succeeds', async () => {
    installFetch([slotsResponse]);
    render(<AppointmentBookingFlow venue={venue()} />);
    await walkToSlots();

    expect(await screen.findByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(screen.queryByText(/We could not check which days are free/i)).not.toBeInTheDocument();
  });
});
