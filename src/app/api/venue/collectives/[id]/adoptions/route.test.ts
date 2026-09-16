/**
 * OFF-06, the member's half: only an active member of a shared-services collective reads and
 * answers its questions, and the answer goes through as given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/adoptions', () => ({
  loadPendingAdoptions: vi.fn(async () => [{ item_id: 'item-1' }]),
  loadAdoptionReview: vi.fn(async () => null),
  runAnswerAdoption: vi.fn(async () => ({ ok: true, collective_sync: { pending: [], failed: [] } })),
}));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadPendingAdoptions, runAnswerAdoption } from '@/lib/linked-accounts/replicas/adoptions';
import { GET as list } from './route';
import { GET as review, POST as answer } from './[itemId]/route';

const ITEM = 'aaaaaaaa-0000-4000-8000-0000000000a1';

function signIn(options: { member?: boolean; model?: string } = {}) {
  const recording = makeRecordingDb((call) => {
    if (call.table === 'venue_collectives') {
      return {
        data: { name: 'Northside', host_venue_id: 'host', status: 'active', service_model: options.model ?? 'replicas' },
      };
    }
    if (call.table === 'venue_collective_members') return { data: options.member === false ? null : { id: 'm-1' } };
    if (call.table === 'venues') return { data: { name: 'Host Venue' } };
    return undefined;
  });
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin: recording.db as unknown as SupabaseClient, venueId: 'member', userId: 'user-1' },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
}

const collectiveParams = () => ({ params: Promise.resolve({ id: 'collective-1' }) });
const itemParams = () => ({ params: Promise.resolve({ id: 'collective-1', itemId: ITEM }) });
const post = (body: unknown) =>
  answer(new NextRequest('http://test/api', { method: 'POST', body: JSON.stringify(body) }), itemParams());

beforeEach(() => {
  vi.mocked(runAnswerAdoption).mockClear();
  vi.mocked(loadPendingAdoptions).mockClear();
});

describe('adoption routes', () => {
  it("lists the member's open questions", async () => {
    signIn();
    const response = await list(new Request('http://test/api'), collectiveParams());
    expect(await response.json()).toEqual({
      host_name: 'Host Venue',
      collective_name: 'Northside',
      adoptions: [{ item_id: 'item-1' }],
    });
  });

  it('refuses a venue that is not a member, and an older collective', async () => {
    signIn({ member: false });
    expect((await list(new Request('http://test/api'), collectiveParams())).status).toBe(404);
    signIn({ model: 'legacy_copies' });
    expect((await post({ choice: 'keep_separate' })).status).toBe(409);
    expect(vi.mocked(runAnswerAdoption)).not.toHaveBeenCalled();
  });

  it('says a settled question is settled', async () => {
    signIn();
    const response = await review(new Request('http://test/api'), itemParams());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('COLLECTIVE_ADOPTION_NOT_PENDING');
  });

  it('sends the answer as the member', async () => {
    signIn();
    const map = [{ my_variant_id: 'aaaaaaaa-0000-4000-8000-0000000000c1', host_variant_id: null }];
    expect((await post({ choice: 'use_mine', option_map: map })).status).toBe(200);
    expect(vi.mocked(runAnswerAdoption)).toHaveBeenCalledWith(
      expect.objectContaining({ venueId: 'member', hostVenueName: 'Host Venue', collectiveName: 'Northside' }),
      ITEM,
      { choice: 'use_mine', option_map: map },
    );
  });

  it('refuses an answer that is not one of the two', async () => {
    signIn();
    expect((await post({ choice: 'pause' })).status).toBe(400);
  });
});
