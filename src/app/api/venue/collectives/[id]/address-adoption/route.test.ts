/**
 * SEO-02 and N38: a member's admin answers the host's request to use its page address.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { invalidateCollectiveCatalogMemo } from '@/lib/linked-accounts/collective-venue';
import { POST } from './route';

function signIn({
  member = true,
  rpc = { data: { status: 'adopted' }, error: null } as { data: unknown; error: unknown },
} = {}) {
  const recording = makeRecordingDb((call) => {
    if (call.table === 'venue_collectives') {
      return { data: { name: 'Northside', host_venue_id: 'host', status: 'active', service_model: 'replicas' } };
    }
    if (call.table === 'venue_collective_members') return { data: member ? { id: 'm-1' } : null };
    if (call.table === 'venues') return { data: { name: 'Host Venue' } };
    if (call.table === 'rpc:collective_answer_address_adoption') return rpc as never;
    return undefined;
  });
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin: recording.db as unknown as SupabaseClient, venueId: 'member', userId: 'user-1' },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  return recording;
}

const post = (body: unknown) =>
  POST(new NextRequest('http://test/api', { method: 'POST', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'collective-1' }),
  });

beforeEach(() => {
  vi.mocked(resolveLinkAdmin).mockReset();
  vi.mocked(invalidateCollectiveCatalogMemo).mockClear();
});

describe('POST /api/venue/collectives/[id]/address-adoption', () => {
  it('agrees for the calling venue, and only for it', async () => {
    const recording = signIn();
    const response = await post({ accept: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'adopted' });
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_answer_address_adoption').map((c) => c.payload)).toEqual([
      { p_collective_id: 'collective-1', p_venue_id: 'member', p_accept: true, p_actor_user_id: 'user-1' },
    ]);
    expect(invalidateCollectiveCatalogMemo).toHaveBeenCalledWith('collective-1');
  });

  it('says "Not now" without touching the page', async () => {
    signIn({ rpc: { data: { status: 'declined' }, error: null } });
    const response = await post({ accept: false });
    expect(await response.json()).toEqual({ ok: true, status: 'declined' });
    expect(invalidateCollectiveCatalogMemo).not.toHaveBeenCalled();
  });

  it('refuses a venue that is not part of it, and a request already settled', async () => {
    signIn({ member: false });
    expect((await post({ accept: true })).status).toBe(404);

    signIn({ rpc: { data: null, error: { code: 'P0001', message: 'COLLECTIVE_ADDRESS_NOT_PENDING: gone' } } });
    const settled = await post({ accept: true });
    expect(settled.status).toBe(409);
    expect((await settled.json()).code).toBe('COLLECTIVE_ADDRESS_NOT_PENDING');
  });

  it('needs an answer', async () => {
    signIn();
    expect((await post({})).status).toBe(400);
  });
});
