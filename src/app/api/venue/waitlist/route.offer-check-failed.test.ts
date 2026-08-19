import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `can_offer` degrades PER ENTRY, not per response.
 *
 * A failed schedule read used to answer `can_offer: false` with "No matching availability".
 * Both clients gate their Offer button on an explicit `=== false` and render that string in
 * warning colour, so the system told staff a waiting client could not be offered a slot and
 * removed their ability to try. A wrong answer, not a missing one.
 *
 * Wrapping the route in `withScheduleFailClosed` was the obvious remedy and the wrong one:
 * `can_offer` is folded into a list response with no availability-only sub-view, so a 503
 * would trade a wrong flag on some entries for no waitlist at all for every entry. It is
 * also advisory in front of `offerAppointmentWaitlistEntryManually`, which re-resolves the
 * slot and returns 409.
 *
 * So: leave `can_offer` unset, say nothing about availability, and flag the entry.
 * `schedule-read-context.test.ts` covers why the two mechanisms cannot be combined.
 */

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn() }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock('@/lib/booking/load-waitlist-venue-capabilities', () => ({
  loadWaitlistVenueCapabilities: vi.fn(),
}));
vi.mock('@/lib/booking/waitlist-entry-display', () => ({
  enrichWaitlistEntriesForDisplay: vi.fn(async () => new Map()),
}));
vi.mock('@/lib/booking/waitlist-offer-availability', () => ({
  findAppointmentWaitlistAvailability: vi.fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import { findAppointmentWaitlistAvailability } from '@/lib/booking/waitlist-offer-availability';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';
import { GET } from './route';

const VENUE_ID = 'a0000000-0000-4000-8000-000000000001';

function waitingEntry(id: string) {
  return {
    id,
    venue_id: VENUE_ID,
    waitlist_kind: 'appointment',
    status: 'waiting',
    desired_date: '2026-09-01',
    desired_time: '10:00:00',
    desired_time_end: null,
    service_item_id: 'svc-1',
    practitioner_id: null,
    guest_first_name: 'Sam',
    guest_last_name: 'Guest',
  };
}

function mockAdmin(rows: Array<Record<string, unknown>>) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'venues') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { feature_flags: {} }, error: null }),
        };
      }
      if (table === 'waitlist_entries') {
        // The route chains `.select().eq().order()` and then `.eq()` again on the RESULT of
        // `.order()`, so the builder has to stay chainable AND be awaitable at any point.
        const q: Record<string, unknown> = {};
        q.select = vi.fn(() => q);
        q.eq = vi.fn(() => q);
        q.order = vi.fn(() => q);
        q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
  vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
  return client;
}

async function listEntries(): Promise<Array<Record<string, unknown>>> {
  const res = await GET(new NextRequest('https://app.test/api/venue/waitlist?kind=appointment'));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: Array<Record<string, unknown>> };
  return body.entries;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVenueStaff).mockResolvedValue({ venue_id: VENUE_ID, role: 'admin' } as never);
  vi.mocked(loadWaitlistVenueCapabilities).mockResolvedValue({
    showTableWaitlist: false,
    showAppointmentWaitlist: true,
  } as never);
});

describe('GET /api/venue/waitlist degrades per entry', () => {
  it('sends can_offer true and no flag when the check succeeds', async () => {
    mockAdmin([waitingEntry('w-1')]);
    vi.mocked(findAppointmentWaitlistAvailability).mockResolvedValue({ available: true } as never);

    const [entry] = await listEntries();

    expect(entry).toMatchObject({ can_offer: true, offer_unavailable_reason: null });
    expect(entry).not.toHaveProperty('offer_check_failed');
  });

  it('sends can_offer false with a reason when the venue genuinely has no slot', async () => {
    mockAdmin([waitingEntry('w-1')]);
    vi.mocked(findAppointmentWaitlistAvailability).mockResolvedValue({
      available: false,
      reason: 'No matching availability.',
    } as never);

    const [entry] = await listEntries();

    expect(entry).toMatchObject({
      can_offer: false,
      offer_unavailable_reason: 'No matching availability.',
    });
    expect(entry).not.toHaveProperty('offer_check_failed');
  });

  /**
   * The wrong-DISABLE direction: the read that decides working hours failed, so the engine
   * found no slots. Before this change staff were told the client could not be offered one.
   */
  it('omits can_offer and flags the entry when a schedule read failed open', async () => {
    mockAdmin([waitingEntry('w-1')]);
    vi.mocked(findAppointmentWaitlistAvailability).mockImplementation(async () => {
      reportAvailabilityReadFailure(
        {
          source: 'findAppointmentWaitlistAvailability',
          table: 'calendar_working_hours',
          assumed: 'the calendar has no working hours, so nothing is bookable',
        },
        { message: 'injected' },
      );
      return { available: false, reason: 'No matching availability.' } as never;
    });

    const [entry] = await listEntries();

    // The button gates on an explicit `=== false` on both clients, so an absent value keeps
    // it enabled on builds that predate the flag.
    expect(entry!.can_offer).toBeUndefined();
    expect(entry!.offer_check_failed).toBe(true);
    // Saying "No matching availability" here is the exact falsehood being removed.
    expect(entry!.offer_unavailable_reason).toBeNull();
  });

  /**
   * The wrong-ENABLE direction, which the harm argument for this change originally missed.
   * A failed `bookings` read yields no occupancy, so the engine believes the day is empty
   * and answers `available: true`. Keying on "a read failed" rather than on `available`
   * covers both; narrowing it to `available === false` would reopen this half.
   */
  it('flags the entry even when the failed read produced a confident YES', async () => {
    mockAdmin([waitingEntry('w-1')]);
    vi.mocked(findAppointmentWaitlistAvailability).mockImplementation(async () => {
      reportAvailabilityReadFailure(
        {
          source: 'findAppointmentWaitlistAvailability',
          table: 'bookings',
          assumed: 'nothing is booked, so every slot is free',
        },
        { message: 'injected' },
      );
      return { available: true } as never;
    });

    const [entry] = await listEntries();

    expect(entry!.can_offer).toBeUndefined();
    expect(entry!.offer_check_failed).toBe(true);
  });

  /**
   * The whole reason for per-entry contexts. One broken entry must not blank the others,
   * which is what a route-level 503 would have done.
   */
  it('degrades only the entry whose read failed', async () => {
    mockAdmin([waitingEntry('w-1'), waitingEntry('w-2')]);
    vi.mocked(findAppointmentWaitlistAvailability).mockImplementation(async (_admin, _venue, e) => {
      if ((e as { desired_date: string }).desired_date === '2026-09-01' && failNext) {
        failNext = false;
        reportAvailabilityReadFailure(
          { source: 'findAppointmentWaitlistAvailability', table: 'bookings', assumed: 'free' },
          { message: 'injected' },
        );
        return { available: true } as never;
      }
      return { available: true } as never;
    });
    let failNext = true;

    const entries = await listEntries();

    expect(entries).toHaveLength(2);
    const flagged = entries.filter((e) => e.offer_check_failed === true);
    const clean = entries.filter((e) => e.can_offer === true);
    expect(flagged).toHaveLength(1);
    expect(clean).toHaveLength(1);
  });
});
