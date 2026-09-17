/**
 * OFF-06, the route half: "Add from another venue" goes to the adoption flow, only for the host of
 * a shared-services collective, and the host sees what the member's own services are.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
  enforceLinkRateLimit: () => null,
}));
vi.mock('@/lib/linked-accounts/replicas/host-route-helpers', () => ({
  requireReplicasHost: vi.fn(),
  engineErrorResponse: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/replicas/adoptions', () => ({
  ownServicesAt: vi.fn(async () => [{ id: 'svc-1', name: 'Balayage', duration_minutes: 90, price_pence: 12000 }]),
  runAddFromVenue: vi.fn(async () => ({ ok: true, result: { item_id: 'item-1', service_name: 'Balayage' } })),
}));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/inline-apply', () => ({ applyLinksInline: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/collective-notices', () => ({ notifyServiceOffered: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { requireReplicasHost } from '@/lib/linked-accounts/replicas/host-route-helpers';
import { ownServicesAt, runAddFromVenue } from '@/lib/linked-accounts/replicas/adoptions';
import { GET, POST } from './route';

const MEMBER = 'aaaaaaaa-0000-4000-8000-00000000000b';
const SERVICE = 'aaaaaaaa-0000-4000-8000-0000000000f1';
const params = { params: Promise.resolve({ id: 'collective-1' }) };

function signIn(membership: unknown = { id: 'm-1' }) {
  const recording = makeRecordingDb((call) =>
    call.table === 'venue_collective_members' ? { data: membership } : undefined,
  );
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin: recording.db as unknown as SupabaseClient, venueId: 'host', userId: 'user-1', venue: { name: 'Host Venue' } },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  vi.mocked(requireReplicasHost).mockResolvedValue({
    ok: true,
    collective: { id: 'collective-1', name: 'Northside', hostVenueId: 'host' },
  } as never);
}

beforeEach(() => {
  vi.mocked(runAddFromVenue).mockClear();
  vi.mocked(ownServicesAt).mockClear();
});

describe('POST offerings with a source venue', () => {
  it('runs the adoption flow with the host and the chosen service', async () => {
    signIn();
    const response = await POST(
      new NextRequest('http://test/api', {
        method: 'POST',
        body: JSON.stringify({ source_venue_id: MEMBER, source_service_id: SERVICE }),
      }),
      params,
    );
    expect(response.status).toBe(201);
    expect(vi.mocked(runAddFromVenue)).toHaveBeenCalledWith(
      expect.objectContaining({ collectiveId: 'collective-1', hostVenueId: 'host', hostVenueName: 'Host Venue', venueId: 'host' }),
      { venueId: MEMBER, serviceId: SERVICE },
    );
  });

  it('is only for the host', async () => {
    signIn();
    vi.mocked(requireReplicasHost).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ code: 'COLLECTIVE_NOT_HOST' }, { status: 403 }),
    } as never);
    const response = await POST(
      new NextRequest('http://test/api', {
        method: 'POST',
        body: JSON.stringify({ source_venue_id: MEMBER, source_service_id: SERVICE }),
      }),
      params,
    );
    expect(response.status).toBe(403);
    expect(vi.mocked(runAddFromVenue)).not.toHaveBeenCalled();
  });
});

describe("GET a member's own services", () => {
  it('lists them for a member', async () => {
    signIn();
    const response = await GET(new NextRequest(`http://test/api?source_venue_id=${MEMBER}`), params);
    expect(await response.json()).toEqual({
      services: [{ id: 'svc-1', name: 'Balayage', duration_minutes: 90, price_pence: 12000 }],
    });
    expect(vi.mocked(ownServicesAt)).toHaveBeenCalledWith(expect.anything(), MEMBER);
  });

  it('refuses a venue that is not a member', async () => {
    signIn(null);
    const response = await GET(new NextRequest(`http://test/api?source_venue_id=${MEMBER}`), params);
    expect(response.status).toBe(404);
    expect(vi.mocked(ownServicesAt)).not.toHaveBeenCalled();
  });
});
