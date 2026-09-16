/**
 * TERMS-15 and BM-04: currency and timezone gates.
 *
 * A collective shares one timezone and one currency. Creating one with a venue that trades in
 * another currency is refused with a code, and a venue already in a collective cannot change its
 * timezone or switch appointments off from its settings (BM-02's lock, which lives with this one).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/notifications', () => ({ notifyCollectiveInvitation: vi.fn() }));
vi.mock('@/lib/linked-accounts/collectives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linked-accounts/collectives')>()),
  loadCollectiveViewsForVenue: vi.fn(async () => []),
  hasFullMutualWriteLinks: vi.fn(async () => true),
}));
vi.mock('@/lib/supabase/venue-route-client', () => ({ createVenueRouteClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
  requireAdmin: () => true,
}));
vi.mock('@/lib/booking/venue-booking-model-disable-guard', () => ({
  assertCanDisableBookingModels: vi.fn(async () => undefined),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { getVenueStaff } from '@/lib/venue-auth';
import { POST as createCollective } from './route';
import { PATCH as patchVenue } from '../route';

const HOST = '11111111-1111-4111-8111-111111111111';
const EURO = '22222222-2222-4222-8222-222222222222';
const MEMBER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.mocked(resolveLinkAdmin).mockReset();
  vi.mocked(getVenueStaff).mockReset();
});

describe('creating a collective (BM-04)', () => {
  it('refuses a venue that trades in another currency, with a code', async () => {
    const recording = makeRecordingDb((call) => {
      if (call.table === 'venues') {
        return {
          data: [
            { id: HOST, name: 'Host Venue', timezone: 'Europe/London', currency: 'GBP' },
            { id: EURO, name: 'Café Dublin', timezone: 'Europe/London', currency: 'EUR' },
          ],
        };
      }
      return undefined;
    });
    vi.mocked(resolveLinkAdmin).mockResolvedValue({
      ok: true,
      ctx: {
        admin: recording.db as unknown as SupabaseClient,
        venueId: HOST,
        eligibility: { feature: true, canCreate: true },
      },
    } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);

    const response = await createCollective(
      new NextRequest('http://test/api/venue/collectives', {
        method: 'POST',
        body: JSON.stringify({ name: 'Northside', slug: 'northside', inviteVenueIds: [EURO] }),
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'COLLECTIVE_CURRENCY_MISMATCH',
      error:
        'Café Dublin takes payment in EUR and the collective uses GBP. Every venue in a collective has to use the same currency.',
    });
    expect(recording.calls.some((c) => c.table === 'venue_collectives' && c.op === 'insert')).toBe(false);
  });
});

describe('PATCH /api/venue while in a collective (TERMS-15, BM-02)', () => {
  const venueResponder = (inCollective: boolean): Responder => (call) => {
    if (call.table === 'venue_collective_members') {
      return { data: inCollective ? [{ collective_id: 'collective-1' }] : [] };
    }
    if (call.table === 'venue_collectives') {
      const byHost = call.filters.some((f) => f[0] === 'eq' && f[1] === 'host_venue_id');
      return { data: byHost ? [] : [{ id: 'collective-1', name: 'Northside', host_venue_id: HOST }] };
    }
    if (call.table === 'venues' && call.op === 'select') {
      return {
        data: {
          name: 'Zen Studio',
          timezone: 'Europe/London',
          booking_model: 'unified_scheduling',
          active_booking_models: ['unified_scheduling', 'class_session'],
          enabled_models: [],
          pricing_tier: 'appointments',
        },
      };
    }
    if (call.table === 'venues' && call.op === 'update') {
      return { data: { id: MEMBER, booking_model: 'unified_scheduling', pricing_tier: 'appointments' } };
    }
    return undefined;
  };

  const patch = async (body: Record<string, unknown>, inCollective = true) => {
    const recording = makeRecordingDb(venueResponder(inCollective));
    vi.mocked(getVenueStaff).mockResolvedValue({
      db: recording.db,
      venue_id: MEMBER,
      role: 'admin',
    } as unknown as Awaited<ReturnType<typeof getVenueStaff>>);
    const response = await patchVenue(
      new NextRequest('http://test/api/venue', { method: 'PATCH', body: JSON.stringify(body) }),
    );
    const updated = recording.calls.some((c) => c.table === 'venues' && c.op === 'update');
    return { response, updated };
  };

  it('refuses a timezone change and leaves the timezone alone', async () => {
    const { response, updated } = await patch({ name: 'Zen Studio', timezone: 'Europe/Dublin' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'COLLECTIVE_TIMEZONE_LOCKED' });
    expect(updated).toBe(false);
  });

  it('still saves the profile when the timezone is sent unchanged', async () => {
    const { response, updated } = await patch({ name: 'Zen Studio', timezone: 'Europe/London' });
    expect(response.status).toBe(200);
    expect(updated).toBe(true);
  });

  it('allows a timezone change outside a collective', async () => {
    const { response } = await patch({ timezone: 'Europe/Dublin' }, false);
    expect(response.status).toBe(200);
  });

  it('refuses switching appointments off, but not other models', async () => {
    const off = await patch({ active_booking_models: ['class_session'] });
    expect(off.response.status).toBe(409);
    expect(await off.response.json()).toMatchObject({ code: 'COLLECTIVE_BOOKING_MODEL_LOCKED' });
    expect(off.updated).toBe(false);

    const classesOff = await patch({ active_booking_models: ['unified_scheduling'] });
    expect(classesOff.response.status).toBe(200);
  });
});
