/**
 * GET /api/venue/collectives/[id]/join: only the invited venue reads what it has to decide, and only
 * for a shared-services collective.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/join', () => ({ loadJoinPreview: vi.fn() }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadJoinPreview } from '@/lib/linked-accounts/replicas/join';
import { GET } from './route';

const mockResolve = vi.mocked(resolveLinkAdmin);
const mockPreview = vi.mocked(loadJoinPreview);

function signedIn(invitation: Record<string, unknown> | null) {
  const recording = makeRecordingDb((call) =>
    call.table === 'venue_collective_members' ? { data: invitation } : undefined,
  );
  mockResolve.mockResolvedValue({
    ok: true,
    ctx: { admin: recording.db as unknown as SupabaseClient, venueId: 'venue-me' },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  return recording;
}

const call = () => GET(new Request('http://test/api'), { params: Promise.resolve({ id: 'collective-1' }) });

beforeEach(() => {
  mockPreview.mockReset();
});

describe('GET /api/venue/collectives/[id]/join', () => {
  it('is only for a venue with an open invitation', async () => {
    const recording = signedIn(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(mockPreview).not.toHaveBeenCalled();
    const lookup = recording.calls.find((c) => c.table === 'venue_collective_members')!;
    expect(lookup.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'venue_id', 'venue-me'],
        ['eq', 'status', 'invited'],
      ]),
    );
  });

  it('refuses a collective that does not share services', async () => {
    signedIn({ id: 'membership-1' });
    mockPreview.mockResolvedValue(null);
    expect((await call()).status).toBe(409);
  });

  it('returns the preview, never cached', async () => {
    signedIn({ id: 'membership-1' });
    mockPreview.mockResolvedValue({ collective_name: 'Northside' } as never);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ collective_name: 'Northside' });
    expect(mockPreview).toHaveBeenCalledWith(expect.anything(), 'collective-1', 'venue-me');
  });
});
