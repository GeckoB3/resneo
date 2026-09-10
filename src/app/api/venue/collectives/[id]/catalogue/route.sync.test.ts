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
import { detachCopy, linkCopyToOrigin, syncOneCopy } from '@/lib/linked-accounts/service-sync';
import { matchAddonGroupsToOrigin, loadOfferingTemplate } from '@/lib/linked-accounts/service-duplication';
import { PATCH } from './route';

const mockResolve = vi.mocked(resolveLinkAdmin);
const mockAccess = vi.mocked(loadCollectiveAccess);
const mockLoad = vi.mocked(loadCatalogueForManagement);
const mockSync = vi.mocked(syncOneCopy);
const mockDetach = vi.mocked(detachCopy);
const mockLink = vi.mocked(linkCopyToOrigin);
const mockTemplate = vi.mocked(loadOfferingTemplate);
const mockAddons = vi.mocked(matchAddonGroupsToOrigin);
const ORIGIN = '66666666-6666-4666-8666-666666666666';

const COLLECTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROVIDER = '44444444-4444-4444-8444-444444444444';
const ITEM = '33333333-3333-4333-8333-333333333333';
const COPY = '55555555-5555-4555-8555-555555555555';

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> };

/** The provider row lookups the route makes on its way to the copy's service id. */
function makeAdmin() {
  const calls: Call[] = [];
  const admin = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      const chain = (fn: (...args: unknown[]) => void) => (...args: unknown[]) => {
        fn(...args);
        return b;
      };
      b.select = chain(() => {});
      b.update = chain((p) => {
        call.op = 'update';
        call.payload = p;
      });
      for (const f of ['eq', 'neq', 'in', 'is', 'order', 'limit']) {
        b[f] = chain((...a) => call.filters.push([f, ...a]));
      }
      const resolve = () => {
        if (table === 'collective_service_providers') {
          return Promise.resolve({
            data: { id: PROVIDER, venue_id: MEMBER, item_id: ITEM, price_pence_override: null, duration_minutes_override: null, source_service_id: COPY },
            error: null,
          });
        }
        if (table === 'collective_service_items') {
          return Promise.resolve({ data: { id: ITEM, collective_id: COLLECTIVE }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      b.maybeSingle = resolve;
      b.single = resolve;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => resolve().then(res, rej);
      return b;
    },
  };
  return { admin, calls };
}

const CATALOGUE = { collectiveId: COLLECTIVE, pageMode: 'unified_catalog', items: [], memberSources: [], categories: [] };

function setup(opts: { isHost?: boolean } = {}) {
  const { admin, calls } = makeAdmin();
  mockResolve.mockResolvedValue({ ok: true, ctx: { admin, venueId: HOST, userId: 'user-1' } } as never);
  mockAccess.mockResolvedValue({
    id: COLLECTIVE,
    hostVenueId: HOST,
    status: 'active',
    pageMode: 'unified_catalog',
    isHost: opts.isHost ?? true,
    memberId: 'member-1',
  });
  mockLoad.mockResolvedValue(CATALOGUE as never);
  return { admin, calls };
}

function req(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}
const params = { params: Promise.resolve({ id: COLLECTIVE }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH sync actions', () => {
  it('sync_provider re-syncs the provider’s copy, passing the force flag through', async () => {
    setup();
    mockSync.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ action: 'sync_provider', providerId: PROVIDER, forceSync: true }), params);
    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), COPY, { force: true, source: 'PATCH catalogue sync_provider' });
    expect(mockDetach).not.toHaveBeenCalled();
  });

  it('a customised copy without force comes back as 409 with the sync module’s reason', async () => {
    setup();
    mockSync.mockResolvedValue({ ok: false, error: 'This copy has been customised at its venue. Confirm to replace those changes.' });
    const res = await PATCH(req({ action: 'sync_provider', providerId: PROVIDER }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/customised/);
    expect(mockSync).toHaveBeenCalledWith(expect.anything(), COPY, { force: false, source: 'PATCH catalogue sync_provider' });
  });

  it('detach_provider stops the copy following', async () => {
    setup();
    mockDetach.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ action: 'detach_provider', providerId: PROVIDER }), params);
    expect(res.status).toBe(200);
    expect(mockDetach).toHaveBeenCalledWith(expect.anything(), COPY);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('is host-only, and needs a provider id', async () => {
    setup({ isHost: false });
    expect((await PATCH(req({ action: 'sync_provider', providerId: PROVIDER }), params)).status).toBe(403);
    expect(mockSync).not.toHaveBeenCalled();
    setup();
    expect((await PATCH(req({ action: 'detach_provider' }), params)).status).toBe(404);
    expect(mockDetach).not.toHaveBeenCalled();
  });
});

describe('PATCH link_provider', () => {
  it('links the copy to the offering’s origin, updates it, then matches its add-on groups', async () => {
    setup();
    mockTemplate.mockResolvedValue({ origin: { venueId: HOST, serviceId: ORIGIN }, addonGroups: [{ group: {}, addons: [] }] } as never);
    mockLink.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ action: 'link_provider', providerId: PROVIDER }), params);
    expect(res.status).toBe(200);
    expect(mockLink).toHaveBeenCalledWith(expect.anything(), { copyServiceId: COPY, originServiceId: ORIGIN, source: 'PATCH catalogue link_provider' });
    expect(mockAddons).toHaveBeenCalledWith(expect.anything(), MEMBER, COPY, expect.any(Array));
  });

  it('refuses when the offering has no origin, or the copy IS the origin', async () => {
    setup();
    mockTemplate.mockResolvedValue({ origin: null, addonGroups: [] } as never);
    expect((await PATCH(req({ action: 'link_provider', providerId: PROVIDER }), params)).status).toBe(409);
    mockTemplate.mockResolvedValue({ origin: { venueId: MEMBER, serviceId: COPY }, addonGroups: [] } as never);
    expect((await PATCH(req({ action: 'link_provider', providerId: PROVIDER }), params)).status).toBe(409);
    expect(mockLink).not.toHaveBeenCalled();
  });
});
