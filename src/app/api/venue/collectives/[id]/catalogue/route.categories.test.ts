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
}));
vi.mock('@/lib/linked-accounts/collective-page-config', () => ({
  loadCollectiveMemberImportSources: vi.fn(async () => []),
}));
vi.mock('@/lib/linked-accounts/service-duplication', () => ({
  ensureServiceForCalendar: vi.fn(),
  loadOfferingTemplate: vi.fn(),
}));
vi.mock('@/lib/linked-accounts/queries', () => ({
  loadVenueLookup: vi.fn(async () => ({})),
}));
vi.mock('@/lib/linked-accounts/notifications', () => ({
  notifyCombinedProviderProposed: vi.fn(async () => {}),
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
import { resolveCollectiveCategoryId } from '@/lib/linked-accounts/collective-categories';
import {
  applyCollectiveCategoryAction,
  inheritCategoryForOffering,
  seedCollectiveCategoriesOnce,
} from '@/lib/linked-accounts/collective-category-inheritance';
import { GET, PATCH } from './route';

const mockResolve = vi.mocked(resolveLinkAdmin);
const mockAccess = vi.mocked(loadCollectiveAccess);
const mockLoad = vi.mocked(loadCatalogueForManagement);
const mockResolveCategory = vi.mocked(resolveCollectiveCategoryId);
const mockApply = vi.mocked(applyCollectiveCategoryAction);
const mockInherit = vi.mocked(inheritCategoryForOffering);
const mockSeed = vi.mocked(seedCollectiveCategoriesOnce);

const COLLECTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAT = '11111111-1111-4111-8111-111111111111';
const ITEM = '33333333-3333-4333-8333-333333333333';

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> };

function makeAdmin(responder: (call: Call) => { data?: unknown; error?: unknown }) {
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
      b.insert = chain((p) => {
        call.op = 'insert';
        call.payload = p;
      });
      b.update = chain((p) => {
        call.op = 'update';
        call.payload = p;
      });
      for (const f of ['eq', 'neq', 'in', 'is', 'order', 'limit']) {
        b[f] = chain((...a) => call.filters.push([f, ...a]));
      }
      const resolve = () => {
        const r = responder(call);
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
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

function setup(opts: { isHost?: boolean; responder?: (call: Call) => { data?: unknown; error?: unknown } } = {}) {
  const { admin, calls } = makeAdmin(opts.responder ?? (() => ({ data: null })));
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
  mockResolveCategory.mockResolvedValue({ ok: true, categoryId: CAT });
});

describe('GET /api/venue/collectives/[id]/catalogue', () => {
  it('runs the one-time heading seed for the host, not for a member', async () => {
    setup({ isHost: true });
    expect((await GET(req(), params)).status).toBe(200);
    expect(mockSeed).toHaveBeenCalledWith(expect.anything(), COLLECTIVE);

    mockSeed.mockClear();
    setup({ isHost: false });
    expect((await GET(req(), params)).status).toBe(200);
    expect(mockSeed).not.toHaveBeenCalled();
  });
});

describe('PATCH category actions', () => {
  it('routes every category action to the category handler and returns the refreshed catalogue', async () => {
    setup();
    mockApply.mockResolvedValue({ ok: true });
    const res = await PATCH(req({ action: 'rename_category', categoryId: CAT, categoryName: 'Hair' }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ catalogue: CATALOGUE });
    expect(mockApply).toHaveBeenCalledWith(expect.anything(), COLLECTIVE, {
      action: 'rename_category',
      categoryId: CAT,
      categoryName: 'Hair',
      categoryIds: undefined,
      itemIds: undefined,
    });
  });

  it('passes the handler\'s failure through with its status', async () => {
    setup();
    mockApply.mockResolvedValue({ ok: false, error: 'You already have a category called "Hair".', status: 409 });
    const res = await PATCH(req({ action: 'create_category', categoryName: 'Hair' }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already have a category/);
  });

  it('403s a member venue and 400s an unknown action before touching anything', async () => {
    setup({ isHost: false });
    expect((await PATCH(req({ action: 'create_category', categoryName: 'Hair' }), params)).status).toBe(403);
    expect(mockApply).not.toHaveBeenCalled();

    setup();
    expect((await PATCH(req({ action: 'explode_categories' }), params)).status).toBe(400);
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe('PATCH offerings carry a heading', () => {
  it('update_item validates the heading belongs to the page and writes category_id', async () => {
    const { calls } = setup({
      responder: (call) => (call.table === 'collective_service_items' && call.op === 'select' ? { data: { id: ITEM } } : { data: null }),
    });
    const res = await PATCH(req({ action: 'update_item', itemId: ITEM, categoryId: CAT }), params);
    expect(res.status).toBe(200);
    expect(mockResolveCategory).toHaveBeenCalledWith(expect.anything(), COLLECTIVE, CAT);
    const update = calls.find((c) => c.table === 'collective_service_items' && c.op === 'update');
    expect(update?.payload).toEqual({ category_id: CAT });
  });

  it('update_item with a stale heading id is refused with the check\'s message', async () => {
    setup({ responder: () => ({ data: { id: ITEM } }) });
    mockResolveCategory.mockResolvedValue({ ok: false, error: 'That category no longer exists. Refresh the page and try again.' });
    const res = await PATCH(req({ action: 'update_item', itemId: ITEM, categoryId: CAT }), params);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no longer exists/);
  });

  it('create_item without a heading inherits one from its source services', async () => {
    const { calls } = setup({
      responder: (call) =>
        call.table === 'collective_service_items' && call.op === 'insert' ? { data: { id: ITEM } } : { data: null },
    });
    mockResolveCategory.mockResolvedValue({ ok: true, categoryId: null });
    const sources = [{ venueId: MEMBER, sourceServiceId: '55555555-5555-4555-8555-555555555555' }];
    // Provider seeding needs the member row; make the venue lookups say "not a member"
    // so it stops early, which is fine: inheritance is what this test is about.
    const res = await PATCH(req({ action: 'create_item', name: 'Cut', sourceServiceIds: sources }), params);
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.table === 'collective_service_items' && c.op === 'insert');
    expect((insert?.payload as { category_id: string | null }).category_id).toBeNull();
    expect(mockInherit).toHaveBeenCalledWith(expect.anything(), COLLECTIVE, ITEM, sources);
  });

  it('create_item with a chosen heading keeps it and does not inherit', async () => {
    const { calls } = setup({
      responder: (call) =>
        call.table === 'collective_service_items' && call.op === 'insert' ? { data: { id: ITEM } } : { data: null },
    });
    const res = await PATCH(req({ action: 'create_item', name: 'Cut', categoryId: CAT }), params);
    expect(res.status).toBe(200);
    const insert = calls.find((c) => c.table === 'collective_service_items' && c.op === 'insert');
    expect((insert?.payload as { category_id: string | null }).category_id).toBe(CAT);
    expect(mockInherit).not.toHaveBeenCalled();
  });
});
