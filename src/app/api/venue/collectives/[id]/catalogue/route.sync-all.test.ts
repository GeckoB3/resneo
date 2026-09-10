import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/linked-accounts/route-helpers', () => ({
  resolveLinkAdmin: vi.fn(),
  enforceLinkRateLimit: vi.fn(() => null),
}));
vi.mock('@/lib/linked-accounts/collective-access', () => ({
  loadCollectiveAccess: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/catalogue', () => ({
  loadCatalogueForManagement: vi.fn(),
  loadVenueCatalogueData: vi.fn(),
  backfillPerCalendarProviders: vi.fn(async () => {}),
  invalidatePublicCombinedCatalogueMemo: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collective-page-config', () => ({
  loadCollectiveMemberImportSources: vi.fn(async () => []),
}));
vi.mock('@/lib/linked-accounts/service-duplication', () => ({
  ensureServiceForCalendar: vi.fn(),
  loadOfferingTemplate: vi.fn(),
  matchAddonGroupsToOrigin: vi.fn(async () => true),
}));
vi.mock('@/lib/linked-accounts/service-sync', () => ({
  syncOneCopy: vi.fn(),
  detachCopy: vi.fn(),
  linkCopyToOrigin: vi.fn(),
  loadServiceSyncViews: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collective-categories', () => ({
  resolveCollectiveCategoryId: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/collective-category-inheritance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linked-accounts/collective-category-inheritance')>()),
  applyCollectiveCategoryAction: vi.fn(),
  inheritCategoryForOffering: vi.fn(async () => null),
  seedCollectiveCategoriesOnce: vi.fn(async () => {}),
}));

import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadCollectiveAccess } from '@/lib/linked-accounts/collective-access';
import { loadCatalogueForManagement } from '@/lib/linked-accounts/catalogue';
import { detachCopy, linkCopyToOrigin, loadServiceSyncViews, syncOneCopy } from '@/lib/linked-accounts/service-sync';
import { ensureServiceForCalendar, loadOfferingTemplate } from '@/lib/linked-accounts/service-duplication';
import { PATCH } from './route';

const mockResolve = vi.mocked(resolveLinkAdmin);
const mockAccess = vi.mocked(loadCollectiveAccess);
const mockLoad = vi.mocked(loadCatalogueForManagement);
const mockSync = vi.mocked(syncOneCopy);
const mockLink = vi.mocked(linkCopyToOrigin);
const mockViews = vi.mocked(loadServiceSyncViews);
const mockDetach = vi.mocked(detachCopy);
const mockTemplate = vi.mocked(loadOfferingTemplate);
const mockEnsure = vi.mocked(ensureServiceForCalendar);

const COLLECTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ITEM = '33333333-3333-4333-8333-333333333333';
const CALENDAR = '22222222-2222-4222-8222-222222222222';
const ORIGIN = '66666666-6666-4666-8666-666666666666';
const COPY = '55555555-5555-4555-8555-555555555555';
const OTHER_COPY = '77777777-7777-4777-8777-777777777777';

/**
 * Enough of the admin client for these actions: the member row, the item's
 * collective, and a provider list (one copy at the member, one at the host).
 */
function makeAdmin() {
  const admin = {
    from(table: string) {
      const b: Record<string, unknown> = {};
      const chain = () => () => b;
      for (const f of ['select', 'update', 'insert', 'eq', 'neq', 'in', 'is', 'order', 'limit']) b[f] = chain();
      const single = () => {
        if (table === 'venue_collective_members') return Promise.resolve({ data: { id: 'member-1' }, error: null });
        if (table === 'collective_service_items') return Promise.resolve({ data: { id: ITEM, collective_id: COLLECTIVE }, error: null });
        if (table === 'collective_service_providers') return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      const list = () => {
        if (table === 'collective_service_providers') {
          return Promise.resolve({
            data: [
              { id: 'p1', item_id: ITEM, venue_id: MEMBER, source_service_id: COPY, status: 'active' },
              { id: 'p2', item_id: ITEM, venue_id: HOST, source_service_id: ORIGIN, status: 'active' },
              { id: 'p3', item_id: ITEM, venue_id: MEMBER, source_service_id: OTHER_COPY, status: 'active' },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      };
      b.maybeSingle = single;
      b.single = single;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => list().then(res, rej);
      return b;
    },
  };
  return admin;
}

function setup() {
  const admin = makeAdmin();
  mockResolve.mockResolvedValue({ ok: true, ctx: { admin, venueId: HOST, userId: 'user-1' } } as never);
  mockAccess.mockResolvedValue({
    id: COLLECTIVE,
    hostVenueId: HOST,
    status: 'active',
    pageMode: 'unified_catalog',
    isHost: true,
    memberId: 'member-1',
  });
  mockLoad.mockResolvedValue({ collectiveId: COLLECTIVE, pageMode: 'unified_catalog', items: [], memberSources: [], categories: [] } as never);
  mockTemplate.mockResolvedValue({
    name: 'Cut & Blow Dry',
    origin: { venueId: HOST, serviceId: ORIGIN },
    addonGroups: [],
  } as never);
}

function req(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = { params: Promise.resolve({ id: COLLECTIVE }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockLink.mockResolvedValue({ ok: true });
  mockSync.mockResolvedValue({ ok: true });
});

describe('sync_all_providers', () => {
  it('links every independent copy and re-syncs a drifted one, leaving the origin alone', async () => {
    setup();
    mockViews.mockImplementation(async (_admin, ids) => {
      const id = ids[0]!;
      const state = id === COPY ? 'independent' : 'linked';
      return new Map([[id, { state, originServiceId: ORIGIN, originVenueId: HOST, inStep: false }]]);
    });
    const res = await PATCH(req({ action: 'sync_all_providers' }), params);
    expect(res.status).toBe(200);
    expect(mockLink).toHaveBeenCalledTimes(1);
    expect(mockLink).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ copyServiceId: COPY, originServiceId: ORIGIN }));
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), OTHER_COPY, expect.objectContaining({ force: true }));
    // The host's own service is the origin: never touched.
    expect(mockViews).not.toHaveBeenCalledWith(expect.anything(), [ORIGIN], expect.anything());
  });

  it('skips a linked copy that is already in step', async () => {
    setup();
    mockViews.mockImplementation(async (_admin, ids) =>
      new Map([[ids[0]!, { state: 'linked', originServiceId: ORIGIN, originVenueId: HOST, inStep: true }]]),
    );
    const res = await PATCH(req({ action: 'sync_all_providers', itemId: ITEM }), params);
    expect(res.status).toBe(200);
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('unlink_all_providers', () => {
  it('detaches every copy at another venue once and leaves the origin alone', async () => {
    setup();
    mockDetach.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ action: 'unlink_all_providers', itemId: ITEM }), params);
    expect(res.status).toBe(200);
    const detached = mockDetach.mock.calls.map((c) => c[1]).sort();
    expect(detached).toEqual([COPY, OTHER_COPY].sort());
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('set_providers with sync', () => {
  it('links an existing same-named service when the host said yes at tick time', async () => {
    setup();
    mockEnsure.mockResolvedValue({ sourceServiceId: COPY, created: false });
    mockViews.mockResolvedValue(new Map([[COPY, { state: 'independent', originServiceId: ORIGIN, originVenueId: HOST, inStep: false }]]));
    const res = await PATCH(
      req({ action: 'set_providers', ops: [{ op: 'add', itemId: ITEM, venueId: MEMBER, practitionerId: CALENDAR, sync: true }] }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockLink).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ copyServiceId: COPY, originServiceId: ORIGIN }));
  });

  it('leaves the service alone without the flag, and never syncs a copy the tick just created', async () => {
    setup();
    mockEnsure.mockResolvedValueOnce({ sourceServiceId: COPY, created: false });
    let res = await PATCH(
      req({ action: 'set_providers', ops: [{ op: 'add', itemId: ITEM, venueId: MEMBER, practitionerId: CALENDAR }] }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockLink).not.toHaveBeenCalled();

    mockEnsure.mockResolvedValueOnce({ sourceServiceId: COPY, created: true });
    res = await PATCH(
      req({ action: 'set_providers', ops: [{ op: 'add', itemId: ITEM, venueId: MEMBER, practitionerId: CALENDAR, sync: true }] }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});
