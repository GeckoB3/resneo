/**
 * Ending a collective runs every venue's release follow-up straight away, as leaving does, so no
 * review panel waits on the cron saying "Copying photos".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({ resolveLinkAdmin: vi.fn() }));
vi.mock('@/lib/linked-accounts/collectives', () => ({
  loadCollectiveViewsForVenue: vi.fn(async () => []),
  dissolvedCollectiveSlug: (id: string) => `dissolved-${id}`,
}));
vi.mock('@/lib/linked-accounts/notifications', () => ({ notifyCollectiveDissolved: vi.fn() }));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));
vi.mock('@/lib/linked-accounts/replicas/release-followups', () => ({ drainReleaseFollowups: vi.fn(async () => ({})) }));
vi.mock('@/lib/linked-accounts/replicas/below-two', () => ({ pendingReleaseFollowups: vi.fn(async () => ['op-1', 'op-2']) }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { drainReleaseFollowups } from '@/lib/linked-accounts/replicas/release-followups';
import { DELETE } from './route';

const HOST = '11111111-1111-4111-8111-111111111111';
const COLLECTIVE = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.mocked(drainReleaseFollowups).mockClear();
  const admin = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'venue_collectives'
                ? { id: COLLECTIVE, name: 'Northside', host_venue_id: HOST, status: 'active', service_model: 'replicas' }
                : null,
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: { members_released: 2 }, error: null }),
  };
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: { admin, venueId: HOST, userId: 'u', venue: { name: 'Zen' }, eligibility: { canCreate: true } },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
});

describe('DELETE /api/venue/collectives/[id]', () => {
  it('dissolves through the engine and runs the pending release follow-ups at once', async () => {
    const res = await DELETE(new NextRequest(`http://localhost/api/venue/collectives/${COLLECTIVE}`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: COLLECTIVE }),
    });
    expect(res.status).toBe(200);
    expect(drainReleaseFollowups).toHaveBeenCalledWith(expect.anything(), { operationIds: ['op-1', 'op-2'] });
  });
});
