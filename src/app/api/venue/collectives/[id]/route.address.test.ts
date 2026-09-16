/**
 * SEO-02 (decided 2026-09-14): on the shared-services model the host's choice of a member's page
 * address is a request. Nothing about the address changes until that member's admin agrees.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/collectives', () => ({
  loadCollectiveViewsForVenue: vi.fn(async () => [{ id: COLLECTIVE, pendingAdoptedVenueId: MEMBER }]),
  dissolvedCollectiveSlug: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/notifications', () => ({ notifyCollectiveDissolved: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { PATCH } from './route';

const COLLECTIVE = 'aaaaaaaa-0000-4000-8000-000000000001';
const HOST = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MEMBER = 'aaaaaaaa-0000-4000-8000-00000000000b';

function signIn(model: 'replicas' | 'legacy_copies', rpcError: { code: string; message: string } | null = null) {
  const recording = makeRecordingDb((call) => {
    if (call.table === 'venue_collectives' && call.op === 'select') {
      if (call.columns === 'service_model') return { data: { service_model: model } };
      if (call.columns === 'id') return { data: null };
      return { data: { id: COLLECTIVE, host_venue_id: HOST, status: 'active', name: 'Northside', page_mode: 'unified_catalog' } };
    }
    if (call.table === 'venue_collective_members') return { data: { id: 'membership' } };
    if (call.table === 'rpc:collective_request_address_adoption') {
      return rpcError ? { data: null, error: rpcError } : { data: { status: 'pending', venue_id: MEMBER } };
    }
    return undefined;
  });
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin: recording.db as unknown as SupabaseClient, venueId: HOST, userId: 'user-1' },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  return recording;
}

const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest('http://test/api', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: COLLECTIVE }),
  });

const addressWrites = (calls: RecordedCall[]) =>
  calls.filter((c) => c.table === 'venue_collectives' && c.op === 'update');

beforeEach(() => {
  vi.mocked(resolveLinkAdmin).mockReset();
});

describe('PATCH /api/venue/collectives/[id] page address on the shared-services model', () => {
  it("asks the member rather than taking its address", async () => {
    const recording = signIn('replicas');
    const response = await patch({ slugStrategy: 'adopt_member', adoptedVenueId: MEMBER });
    expect(response.status).toBe(200);
    expect(addressWrites(recording.calls)).toEqual([]);
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_request_address_adoption').map((c) => c.payload)).toEqual([
      { p_collective_id: COLLECTIVE, p_venue_id: MEMBER, p_actor_venue_id: HOST, p_actor_user_id: 'user-1' },
    ]);
    expect((await response.json()).collective).toEqual({ id: COLLECTIVE, pendingAdoptedVenueId: MEMBER });
  });

  it("going back to the collective's own address withdraws any request", async () => {
    const recording = signIn('replicas');
    expect((await patch({ slugStrategy: 'dedicated' })).status).toBe(200);
    expect(addressWrites(recording.calls).map((c) => c.payload)).toEqual([
      { slug_strategy: 'dedicated', adopted_venue_id: null, pending_adopted_venue_id: null },
    ]);
    expect(recording.calls.some((c) => c.table === 'rpc:collective_request_address_adoption')).toBe(false);
  });

  it('answers an address in use elsewhere with its code', async () => {
    signIn('replicas', { code: 'P0001', message: 'COLLECTIVE_ADDRESS_TAKEN: in use' });
    const response = await patch({ slugStrategy: 'adopt_member', adoptedVenueId: MEMBER });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('COLLECTIVE_ADDRESS_TAKEN');
  });

  it('keeps the direct write on the older model', async () => {
    const recording = signIn('legacy_copies');
    expect((await patch({ slugStrategy: 'adopt_member', adoptedVenueId: MEMBER })).status).toBe(200);
    expect(addressWrites(recording.calls).map((c) => c.payload)).toEqual([
      { slug_strategy: 'adopt_member', adopted_venue_id: MEMBER },
    ]);
    expect(recording.calls.some((c) => c.table === 'rpc:collective_request_address_adoption')).toBe(false);
  });
});
