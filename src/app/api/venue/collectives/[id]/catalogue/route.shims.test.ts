/**
 * MGR-01: the older manager's catalogue actions on a shared-services collective are answered the
 * engine's way, or with a code where there is no equivalent, and a partial failure is reported per
 * operation (CB-45).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb, type Responder } from '@/lib/testing/recording-supabase';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
  enforceLinkRateLimit: vi.fn(() => null),
}));
vi.mock('@/lib/linked-accounts/collective-access', () => ({
  loadCollectiveAccess: vi.fn(async () => ({ status: 'active', isHost: true })),
}));
vi.mock('@/lib/linked-accounts/catalogue', () => ({
  loadCatalogueForManagement: vi.fn(async () => ({ items: [] })),
  loadVenueCatalogueData: vi.fn(),
  backfillPerCalendarProviders: vi.fn(async () => {}),
  invalidatePublicCombinedCatalogueMemo: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collective-venue', () => ({ invalidateCollectiveCatalogMemo: vi.fn() }));
const runBulkOps = vi.hoisted(() =>
  vi.fn(async (_admin: unknown, params: { ops: unknown[] }) => ({
    results: params.ops.map((_op, index) => ({ index, ok: true })),
    linkIds: [],
  })),
);
vi.mock('@/lib/linked-accounts/replicas/bulk-ops', () => ({ runBulkOps }));
vi.mock('@/lib/linked-accounts/replicas/inline-apply', () => ({ applyLinksInline: vi.fn(async () => ({})) }));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { PATCH } from './route';

const COLLECTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ITEM = '33333333-3333-4333-8333-333333333333';
const MASTER = '66666666-6666-4666-8666-666666666666';
const PROVIDER = '44444444-4444-4444-8444-444444444444';
const CAL = '77777777-7777-4777-8777-777777777777';
const CAL_2 = '88888888-8888-4888-8888-888888888888';

function signIn(model = 'replicas', extra: Responder = () => undefined) {
  const recording = makeRecordingDb((call) => {
    const injected = extra(call);
    if (injected) return injected;
    if (call.table === 'venue_collectives') return { data: { service_model: model, name: 'Northside' } };
    if (call.table === 'collective_service_items' && call.op === 'select') {
      return { data: { id: ITEM, master_service_id: MASTER } };
    }
    if (call.table === 'collective_service_items' && call.op === 'update') return { data: { id: ITEM } };
    if (call.table === 'collective_service_providers') {
      return { data: { id: PROVIDER, item_id: ITEM, venue_id: MEMBER, practitioner_id: null } };
    }
    if (call.table === 'collective_service_replicas') return { data: { replica_service_id: 'replica-1' } };
    if (call.table === 'calendar_service_assignments') return { data: [{ calendar_id: CAL }, { calendar_id: CAL_2 }] };
    return undefined;
  });
  vi.mocked(resolveLinkAdmin).mockResolvedValue({
    ok: true,
    ctx: {
      admin: recording.db as unknown as SupabaseClient,
      venueId: HOST,
      userId: 'user-1',
      venue: { name: 'Host Venue' },
    },
  } as unknown as Awaited<ReturnType<typeof resolveLinkAdmin>>);
  return recording;
}

const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest('http://test/api', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: COLLECTIVE }),
  });
const sentOps = () => (runBulkOps.mock.calls.at(-1)?.[1] as { ops: unknown[] } | undefined)?.ops;

beforeEach(() => {
  runBulkOps.mockClear();
});

describe('MGR-01: the older catalogue actions on a shared-services collective', () => {
  it("offers the host's own services for create_item and create_items", async () => {
    signIn();
    expect((await patch({ action: 'create_item', name: 'Cut', sourceServiceIds: [{ venueId: HOST, sourceServiceId: MASTER }] })).status).toBe(200);
    expect(sentOps()).toEqual([{ op: 'offer', service_id: MASTER }]);
    await patch({ action: 'create_items', services: [{ name: 'Cut', venueId: HOST, sourceServiceId: MASTER }] });
    expect(sentOps()).toEqual([{ op: 'offer', service_id: MASTER }]);
  });

  it("refuses a member's service, or none, with the way to add one", async () => {
    signIn();
    for (const body of [
      { action: 'create_item', name: 'Cut', sourceServiceIds: [{ venueId: MEMBER, sourceServiceId: MASTER }] },
      { action: 'create_item', name: 'Cut' },
    ]) {
      const response = await patch(body);
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.code).toBe('COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE');
      expect(json.error).toContain('Add from another venue');
    }
    expect(runBulkOps).not.toHaveBeenCalled();
  });

  it('withdraws for archive_item', async () => {
    signIn();
    expect((await patch({ action: 'archive_item', itemId: ITEM })).status).toBe(200);
    expect(sentOps()).toEqual([{ op: 'withdraw', service_id: MASTER }]);
  });

  it('changes only the photo for update_item', async () => {
    const recording = signIn();
    expect((await patch({ action: 'update_item', itemId: ITEM, imageUrl: 'https://x.test/p.png' })).status).toBe(200);
    expect(recording.calls.find((c) => c.table === 'collective_service_items' && c.op === 'update')?.payload).toEqual({
      image_url: 'https://x.test/p.png',
    });
    const refused = await patch({ action: 'update_item', itemId: ITEM, name: 'New name' });
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe('COLLECTIVE_EDIT_ON_SERVICES_PAGE');
  });

  it('answers the sync and link actions with nothing to do, and refuses detach', async () => {
    signIn();
    for (const action of ['sync_provider', 'link_provider', 'sync_all_providers', 'unlink_all_providers']) {
      expect((await patch({ action, providerId: PROVIDER })).status).toBe(200);
    }
    const detach = await patch({ action: 'detach_provider', providerId: PROVIDER });
    expect(detach.status).toBe(409);
    expect((await detach.json()).code).toBe('COLLECTIVE_REPLICAS_ALWAYS_FOLLOW');
    expect(runBulkOps).not.toHaveBeenCalled();
  });

  it('refuses every heading action', async () => {
    signIn();
    const response = await patch({ action: 'rename_category', categoryId: ITEM, categoryName: 'Hair' });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('COLLECTIVE_HEADINGS_FOLLOW_SERVICES');
  });

  it('turns provider actions into calendar offerings, a whole-venue provider into each of its calendars', async () => {
    signIn();
    await patch({ action: 'add_provider', itemId: ITEM, venueId: MEMBER, practitionerId: CAL });
    expect(sentOps()).toEqual([{ op: 'assign', service_id: MASTER, venue_id: MEMBER, calendar_id: CAL }]);
    await patch({ action: 'remove_provider', providerId: PROVIDER });
    expect(sentOps()).toEqual([
      { op: 'unassign', service_id: MASTER, venue_id: MEMBER, calendar_id: CAL },
      { op: 'unassign', service_id: MASTER, venue_id: MEMBER, calendar_id: CAL_2 },
    ]);
  });

  it('reports a partial failure per operation instead of calling it success (CB-45)', async () => {
    signIn();
    runBulkOps.mockResolvedValueOnce({
      results: [
        { index: 0, ok: true },
        { index: 1, ok: false, code: 'COLLECTIVE_CALENDAR_NOT_AT_VENUE', message: 'That calendar belongs to a different venue.' },
      ],
      linkIds: [],
    } as never);
    const response = await patch({
      action: 'set_providers',
      ops: [
        { op: 'add', itemId: ITEM, venueId: MEMBER, practitionerId: CAL },
        { op: 'add', itemId: ITEM, venueId: MEMBER, practitionerId: CAL_2 },
      ],
    });
    expect(response.status).toBe(207);
    const json = await response.json();
    expect(json.error).toBe('1 of 2 changes could not be applied.');
    expect(json.results).toHaveLength(2);
    expect(json.catalogue).toEqual({ items: [] });
  });

  it('leaves an older collective to the older actions', async () => {
    signIn('legacy_copies');
    await patch({ action: 'sync_all_providers' });
    expect(runBulkOps).not.toHaveBeenCalled();
  });
});
