import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The composition proof for staff fail-closed reads.
 *
 * `schedule-unavailable-response.test.ts` proves the RULE (8 fixtures) and
 * `schedule-fail-closed-coverage.test.ts` proves the wrapper is still attached. Neither
 * proves the two ends actually meet through a real handler: that a fail-open read reported
 * from inside the route reaches the wrapper's collector and comes back as a 503, and that
 * the 401 guard in front of it survives.
 *
 * Stage 7 proved that by injecting on staging, which is not available for the staff routes
 * (`[R3-93]` records the same gap for `class-instances` and `resource-calendar`). One route
 * proved here in full stands in for the shape, because all eight wrap identically.
 *
 * `resource-availability` is the stand-in because it is the smallest handler with the same
 * shape: 401 guard, request validation, one engine call.
 */

vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn() }));
vi.mock('@/lib/venue-auth', () => ({ getVenueStaff: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock('@/lib/venue-mode', () => ({ resolveVenueMode: vi.fn() }));
vi.mock('@/lib/availability/resource-booking-engine', () => ({
  fetchResourceInput: vi.fn(),
  computeResourceAvailability: vi.fn(() => []),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { resolveVenueMode } from '@/lib/venue-mode';
import { fetchResourceInput } from '@/lib/availability/resource-booking-engine';
import { reportAvailabilityReadFailure } from '@/lib/availability/availability-read-failure';
import { GET } from './route';

const VENUE_ID = 'a0000000-0000-4000-8000-000000000001';

function req(qs = 'date=2026-09-01'): NextRequest {
  return new NextRequest(`https://app.test/api/venue/resource-availability?${qs}`);
}

function signedInStaff() {
  vi.mocked(getVenueStaff).mockResolvedValue({ venue_id: VENUE_ID, role: 'admin' } as never);
  vi.mocked(resolveVenueMode).mockResolvedValue({
    bookingModel: 'resource_booking',
    enabledModels: [],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchResourceInput).mockResolvedValue({} as never);
});

describe('GET /api/venue/resource-availability fails closed', () => {
  it('answers 200 when every schedule read succeeds', async () => {
    signedInStaff();

    const res = await GET(req());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ venue_id: VENUE_ID });
  });

  it('answers 503 with Retry-After when a schedule read failed open inside the handler', async () => {
    signedInStaff();
    // Exactly what a fail-open read does: substitute an empty result, report, carry on.
    vi.mocked(fetchResourceInput).mockImplementation(async () => {
      reportAvailabilityReadFailure(
        {
          source: 'fetchResourceInput',
          table: 'resource_availability_blocks',
          assumed: 'the resource has no blocked time, so every slot is free',
          venueId: VENUE_ID,
          date: '2026-09-01',
        },
        { message: 'injected' },
      );
      return {} as never;
    });

    const res = await GET(req());

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('15');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    await expect(res.json()).resolves.toMatchObject({
      unavailable: true,
      tables: ['resource_availability_blocks'],
    });
  });

  it('recovers to 200 once the read succeeds again', async () => {
    signedInStaff();
    let failNext = true;
    vi.mocked(fetchResourceInput).mockImplementation(async () => {
      if (failNext) {
        failNext = false;
        reportAvailabilityReadFailure(
          { source: 'fetchResourceInput', table: 'resources', assumed: 'no resources exist' },
          { message: 'injected' },
        );
      }
      return {} as never;
    });

    expect((await GET(req())).status).toBe(503);
    expect((await GET(req())).status).toBe(200);
  });

  /**
   * The guard the whole staff extension rests on. `withScheduleFailClosed` replaces only a
   * SUCCESS, so an unauthenticated request must still be told it is unauthenticated rather
   * than told to come back later. Asserted here because the 401 is what makes these routes
   * different from the guest ones Stage 7 wrapped.
   */
  it('leaves a 401 alone even when a schedule read failed', async () => {
    vi.mocked(getVenueStaff).mockResolvedValue(null as never);

    const res = await GET(req());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'Unauthorised' });
  });

  it('leaves a 400 alone: a bad request is already a correct answer', async () => {
    signedInStaff();

    const res = await GET(req('date=not-a-date'));

    expect(res.status).toBe(400);
  });
});
