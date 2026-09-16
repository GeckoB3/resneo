/**
 * Contract 10: a member suggests a parked service. Only a member of a shared-services collective,
 * once per service.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { POST } from './route';

const SERVICE = 'aaaaaaaa-0000-4000-8000-0000000000f1';

function signIn(extra: Responder = () => undefined, member = true) {
  const recording = makeRecordingDb((call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'venue_collectives') {
      return { data: { name: 'Northside', host_venue_id: 'host', status: 'active', service_model: 'replicas' } };
    }
    if (call.table === 'venue_collective_members') return { data: member ? { id: 'm-1' } : null };
    if (call.table === 'venues') return { data: { name: 'Host Venue' } };
    if (call.table === 'rpc:collective_suggest_service') return { data: 'audit-1' };
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
});

describe('POST /api/venue/collectives/[id]/suggestions', () => {
  it('suggests the service as the member', async () => {
    const recording = signIn();
    const response = await post({ service_id: SERVICE });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, already_suggested: false, host_name: 'Host Venue' });
    expect(recording.calls.filter((c) => c.table === 'rpc:collective_suggest_service').map((c) => c.payload)).toEqual([
      { p_collective_id: 'collective-1', p_service_id: SERVICE, p_actor_venue_id: 'member', p_actor_user_id: 'user-1' },
    ]);
  });

  it('says when it was suggested before', async () => {
    signIn((call) => (call.table === 'rpc:collective_suggest_service' ? { data: null } : undefined));
    const response = await post({ service_id: SERVICE });
    expect(response.status).toBe(200);
    expect((await response.json()).already_suggested).toBe(true);
  });

  it('refuses a venue that is not a member, and a bad body', async () => {
    signIn(() => undefined, false);
    expect((await post({ service_id: SERVICE })).status).toBe(404);
    signIn();
    expect((await post({ service_id: 'nope' })).status).toBe(400);
  });

  it("passes on the engine's refusal in words", async () => {
    signIn((call) =>
      call.table === 'rpc:collective_suggest_service'
        ? { error: { code: 'P0001', message: 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: not yours' } }
        : undefined,
    );
    const response = await post({ service_id: SERVICE });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE');
  });
});
