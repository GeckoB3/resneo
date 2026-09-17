/**
 * SB-15 (Docs/collective-one-venue-plan.md): only the host's services may write into another
 * venue. The old gate asked only whether two venues shared a live collective, and an offering's
 * origin falls back to a member's service when the host offers no calendar for it, so a member's
 * ordinary save could rewrite a second member's copy with no host involved.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));

import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';
import { columnsMissingFromMigrations } from '@/lib/testing/migration-columns';
import { originHostsLiveCollectiveWith, syncCopiesOfService } from './service-sync';

const HOST = 'venue-host';
const MEMBER_A = 'venue-a';
const MEMBER_B = 'venue-b';

/** One live collective hosted by HOST, with A and B as active members. */
function world(originVenue: string) {
  const responder: Responder = (call) => {
    if (call.table === 'venue_collective_members' && call.op === 'select') {
      const venue = call.filters.find((f) => f[0] === 'eq' && f[1] === 'venue_id')?.[2];
      const host = call.filters.find((f) => f[0] === 'eq' && f[1] === 'venue_collectives.host_venue_id')?.[2];
      if (venue === undefined) return { data: [{ collective_id: 'c1' }] };
      const member = venue === MEMBER_A || venue === MEMBER_B || venue === HOST;
      return { data: member && host === HOST ? [{ collective_id: 'c1', venue_collectives: { status: 'active', host_venue_id: HOST } }] : [] };
    }
    if (call.table === 'service_items' && call.op === 'select') {
      const byOrigin = call.filters.some((f) => f[0] === 'eq' && f[1] === 'synced_from_service_id');
      if (byOrigin) {
        return {
          data: [{ id: 'copy-b', venue_id: MEMBER_B, name: 'Cut', duration_minutes: 30, buffer_minutes: 0, processing_time_blocks: [], synced_from_service_id: 'origin', sync_state: 'linked' }],
        };
      }
      return {
        data: { id: 'origin', venue_id: originVenue, name: 'Cut', duration_minutes: 45, buffer_minutes: 10, processing_time_blocks: [], synced_from_service_id: null, sync_state: 'independent' },
      };
    }
    return undefined;
  };
  return makeRecordingDb(responder);
}

describe('originHostsLiveCollectiveWith', () => {
  it('is true only when the origin venue hosts the collective the copy venue belongs to', async () => {
    expect(await originHostsLiveCollectiveWith(world(HOST).db, HOST, MEMBER_B)).toBe(true);
    expect(await originHostsLiveCollectiveWith(world(MEMBER_A).db, MEMBER_A, MEMBER_B)).toBe(false);
    expect(await originHostsLiveCollectiveWith(world(HOST).db, HOST, HOST)).toBe(false);
  });
});

describe('syncCopiesOfService', () => {
  it("does not write a member's shape into another member's copy", async () => {
    const rec = world(MEMBER_A);

    const result = await syncCopiesOfService(rec.db, 'origin', 'test');

    expect(result).toEqual({ synced: 0, skipped: 1, failed: 0 });
    expect(rec.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it("still pushes the host's shape to a member's copy", async () => {
    const rec = world(HOST);

    const result = await syncCopiesOfService(rec.db, 'origin', 'test');

    expect(result.skipped).toBe(0);
    const writes = rec.calls.filter((c) => c.table === 'service_items' && c.op === 'update');
    expect(writes.length).toBeGreaterThan(0);
    expect(columnsMissingFromMigrations(rec.calls)).toEqual([]);
  });
});
