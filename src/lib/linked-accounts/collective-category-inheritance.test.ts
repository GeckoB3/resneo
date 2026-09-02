import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./catalogue', () => ({
  loadVenueCatalogueData: vi.fn(),
}));

import { loadVenueCatalogueData } from './catalogue';
import {
  applyCollectiveCategoryAction,
  inheritCategoriesForUncategorisedOfferings,
  inheritCategoryForOffering,
  isCollectiveCategoryAction,
  seedCollectiveCategoriesOnce,
} from './collective-category-inheritance';

const mockVenueData = vi.mocked(loadVenueCatalogueData);

const COLLECTIVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MEMBER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAT_HAIR = '11111111-1111-4111-8111-111111111111';
const CAT_NAILS = '22222222-2222-4222-8222-222222222222';
const ITEM_1 = '33333333-3333-4333-8333-333333333333';
const ITEM_2 = '44444444-4444-4444-8444-444444444444';

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> };

/**
 * A stateful fake of the two tables this module writes, so a test can assert on
 * what ended up in them rather than on query shapes.
 */
function makeAdmin(state: {
  categories: Array<{ id: string; name: string; sort_order: number }>;
  items: Array<{ id: string; category_id: string | null; status: string }>;
  providers?: Array<{ item_id: string; venue_id: string; source_service_id: string; status: string }>;
  collective?: { host_venue_id: string; categories_seeded_at: string | null };
  failInsert?: boolean;
}) {
  const calls: Call[] = [];
  let nextId = 100;
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
      b.delete = chain(() => {
        call.op = 'delete';
      });
      for (const f of ['eq', 'neq', 'in', 'is', 'order', 'limit']) {
        b[f] = chain((...a) => call.filters.push([f, ...a]));
      }
      const eq = (k: string) => call.filters.find(([f, key]) => f === 'eq' && key === k)?.[2];
      const inList = (k: string) => call.filters.find(([f, key]) => f === 'in' && key === k)?.[2] as string[] | undefined;
      const run = (): { data?: unknown; error?: unknown } => {
        if (table === 'collective_service_categories') {
          if (call.op === 'insert') {
            if (state.failInsert) return { error: { code: 'XX000', message: 'boom' } };
            const p = call.payload as { name: string; sort_order: number };
            const dup = state.categories.some((c) => c.name.trim().toLowerCase() === p.name.trim().toLowerCase());
            if (dup) return { error: { code: '23505', message: 'duplicate' } };
            const row = { id: `cat-${nextId++}`, name: p.name, sort_order: p.sort_order };
            state.categories.push(row);
            return { data: row };
          }
          if (call.op === 'update') {
            const row = state.categories.find((c) => c.id === eq('id'));
            if (!row) return { data: null };
            Object.assign(row, call.payload as object);
            return { data: { id: row.id } };
          }
          if (call.op === 'delete') {
            const idx = state.categories.findIndex((c) => c.id === eq('id'));
            if (idx < 0) return { data: null };
            state.categories.splice(idx, 1);
            return { data: { id: eq('id') } };
          }
          const id = eq('id');
          if (id) return { data: state.categories.find((c) => c.id === id) ?? null };
          return { data: [...state.categories].sort((a, b) => a.sort_order - b.sort_order) };
        }
        if (table === 'collective_service_items') {
          if (call.op === 'update') {
            const row = state.items.find((i) => i.id === eq('id'));
            if (row) Object.assign(row, call.payload as object);
            return { data: null };
          }
          const ids = inList('id');
          const wantNullCategory = call.filters.some(([f, k]) => f === 'is' && k === 'category_id');
          return {
            data: state.items
              .filter((i) => (ids ? ids.includes(i.id) : true))
              .filter((i) => (wantNullCategory ? i.category_id == null : true))
              .filter((i) => (eq('status') ? i.status === eq('status') : true))
              .map((i) => ({ id: i.id })),
          };
        }
        if (table === 'collective_service_providers') {
          const ids = inList('item_id') ?? [];
          return { data: (state.providers ?? []).filter((p) => ids.includes(p.item_id) && p.status === 'active') };
        }
        if (table === 'venue_collectives') {
          if (call.op === 'update') {
            if (state.collective) Object.assign(state.collective, call.payload as object);
            return { data: null };
          }
          return { data: state.collective ?? null };
        }
        return { data: null };
      };
      const resolve = () => {
        const r = run();
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      };
      b.maybeSingle = resolve;
      b.single = resolve;
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => resolve().then(res, rej);
      return b;
    },
  };
  return { admin: admin as never, calls, state };
}

/** Member venue catalogue data: which category each source service carries at home. */
function venueDataWith(categories: Record<string, { name: string; sort_order: number } | null>) {
  const services = new Map(
    Object.entries(categories).map(([id, cat]) => [
      id,
      {
        name: `Service ${id}`,
        durationMinutes: 30,
        pricePence: 1000,
        description: null,
        sortOrder: 0,
        category: cat ? { id: `src-${cat.name}`, ...cat } : null,
      },
    ]),
  );
  return { services, calendars: new Map(), serviceCalendars: new Map(), serviceList: [], calendarList: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inheritCategoryForOffering', () => {
  it('files the offering under the host venue\'s category, creating the heading', async () => {
    mockVenueData.mockImplementation(async (_admin, venueId) =>
      venueId === HOST
        ? venueDataWith({ 'svc-host': { name: 'Hair', sort_order: 0 } })
        : venueDataWith({ 'svc-member': { name: 'Barbering', sort_order: 0 } }),
    );
    const { admin, state } = makeAdmin({
      categories: [],
      items: [{ id: ITEM_1, category_id: null, status: 'active' }],
      collective: { host_venue_id: HOST, categories_seeded_at: null },
    });
    const ref = await inheritCategoryForOffering(admin, COLLECTIVE, ITEM_1, [
      { venueId: MEMBER, sourceServiceId: 'svc-member' },
      { venueId: HOST, sourceServiceId: 'svc-host' },
    ]);
    expect(ref?.name).toBe('Hair');
    expect(state.categories.map((c) => c.name)).toEqual(['Hair']);
    expect(state.items[0]!.category_id).toBe(ref!.id);
  });

  it('reuses an existing heading regardless of case, and does nothing when no source is categorised', async () => {
    mockVenueData.mockResolvedValue(venueDataWith({ 'svc-1': { name: 'nails', sort_order: 0 } }));
    const { admin, state } = makeAdmin({
      categories: [{ id: CAT_NAILS, name: 'Nails', sort_order: 0 }],
      items: [{ id: ITEM_1, category_id: null, status: 'active' }],
      collective: { host_venue_id: HOST, categories_seeded_at: null },
    });
    const ref = await inheritCategoryForOffering(admin, COLLECTIVE, ITEM_1, [{ venueId: MEMBER, sourceServiceId: 'svc-1' }]);
    expect(ref?.id).toBe(CAT_NAILS);
    expect(state.categories).toHaveLength(1);

    mockVenueData.mockResolvedValue(venueDataWith({ 'svc-2': null }));
    const none = await inheritCategoryForOffering(admin, COLLECTIVE, ITEM_1, [{ venueId: MEMBER, sourceServiceId: 'svc-2' }]);
    expect(none).toBeNull();
  });
});

describe('inheritCategoriesForUncategorisedOfferings and seeding', () => {
  it('creates headings host-first, then in the member venue\'s order, and files every offering', async () => {
    mockVenueData.mockImplementation(async (_admin, venueId) =>
      venueId === HOST
        ? venueDataWith({ 'h-cut': { name: 'Hair', sort_order: 5 } })
        : venueDataWith({ 'm-mani': { name: 'Nails', sort_order: 1 }, 'm-wax': { name: 'Waxing', sort_order: 0 } }),
    );
    const { admin, state } = makeAdmin({
      categories: [],
      items: [
        { id: ITEM_1, category_id: null, status: 'active' },
        { id: ITEM_2, category_id: null, status: 'active' },
        { id: 'item-3', category_id: null, status: 'active' },
        { id: 'item-4', category_id: CAT_HAIR, status: 'active' },
      ],
      providers: [
        { item_id: ITEM_1, venue_id: MEMBER, source_service_id: 'm-mani', status: 'active' },
        { item_id: ITEM_2, venue_id: HOST, source_service_id: 'h-cut', status: 'active' },
        { item_id: 'item-3', venue_id: MEMBER, source_service_id: 'm-wax', status: 'active' },
      ],
      collective: { host_venue_id: HOST, categories_seeded_at: null },
    });
    const { assigned } = await inheritCategoriesForUncategorisedOfferings(admin, COLLECTIVE);
    expect(assigned).toBe(3);
    expect(state.categories.map((c) => [c.name, c.sort_order])).toEqual([
      ['Hair', 0],
      ['Waxing', 1],
      ['Nails', 2],
    ]);
    const byName = new Map(state.categories.map((c) => [c.name, c.id]));
    expect(state.items.find((i) => i.id === ITEM_1)!.category_id).toBe(byName.get('Nails'));
    expect(state.items.find((i) => i.id === ITEM_2)!.category_id).toBe(byName.get('Hair'));
    // Already-categorised offerings are never touched.
    expect(state.items.find((i) => i.id === 'item-4')!.category_id).toBe(CAT_HAIR);
  });

  it('seeds once: runs when unseeded and the page has no headings, then records it', async () => {
    mockVenueData.mockResolvedValue(venueDataWith({ 's': { name: 'Hair', sort_order: 0 } }));
    const { admin, state } = makeAdmin({
      categories: [],
      items: [{ id: ITEM_1, category_id: null, status: 'active' }],
      providers: [{ item_id: ITEM_1, venue_id: HOST, source_service_id: 's', status: 'active' }],
      collective: { host_venue_id: HOST, categories_seeded_at: null },
    });
    await seedCollectiveCategoriesOnce(admin, COLLECTIVE);
    expect(state.categories.map((c) => c.name)).toEqual(['Hair']);
    expect(state.collective!.categories_seeded_at).toBeTruthy();

    // A second visit changes nothing, even with a new uncategorised offering.
    state.items.push({ id: ITEM_2, category_id: null, status: 'active' });
    state.providers!.push({ item_id: ITEM_2, venue_id: HOST, source_service_id: 's', status: 'active' });
    await seedCollectiveCategoriesOnce(admin, COLLECTIVE);
    expect(state.items.find((i) => i.id === ITEM_2)!.category_id).toBeNull();
  });

  it('does not seed a page whose host already curated headings, but still records the visit', async () => {
    const { admin, state } = makeAdmin({
      categories: [{ id: CAT_HAIR, name: 'Hair', sort_order: 0 }],
      items: [{ id: ITEM_1, category_id: null, status: 'active' }],
      providers: [{ item_id: ITEM_1, venue_id: HOST, source_service_id: 's', status: 'active' }],
      collective: { host_venue_id: HOST, categories_seeded_at: null },
    });
    await seedCollectiveCategoriesOnce(admin, COLLECTIVE);
    expect(mockVenueData).not.toHaveBeenCalled();
    expect(state.items[0]!.category_id).toBeNull();
    expect(state.collective!.categories_seeded_at).toBeTruthy();
  });
});

describe('applyCollectiveCategoryAction', () => {
  const base = () =>
    makeAdmin({
      categories: [
        { id: CAT_HAIR, name: 'Hair', sort_order: 0 },
        { id: CAT_NAILS, name: 'Nails', sort_order: 1 },
      ],
      items: [{ id: ITEM_1, category_id: null, status: 'active' }, { id: ITEM_2, category_id: null, status: 'active' }],
      collective: { host_venue_id: HOST, categories_seeded_at: '2026-09-02T00:00:00Z' },
    });

  it('recognises exactly the category actions', () => {
    expect(isCollectiveCategoryAction('create_category')).toBe(true);
    expect(isCollectiveCategoryAction('sync_categories')).toBe(true);
    expect(isCollectiveCategoryAction('update_item')).toBe(false);
  });

  it('create: cleans the name, refuses a duplicate with 409, appends at the end', async () => {
    const { admin, state } = base();
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'create_category', categoryName: '   ' })).toMatchObject({ ok: false, status: 400 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'create_category', categoryName: ' hair ' })).toMatchObject({ ok: false, status: 409 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'create_category', categoryName: '  Massage   Therapy ' })).toEqual({ ok: true });
    expect(state.categories.at(-1)).toMatchObject({ name: 'Massage Therapy', sort_order: 2 });
  });

  it('rename: refuses a clash with another heading, 404s a missing id, otherwise renames', async () => {
    const { admin, state } = base();
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'rename_category', categoryId: CAT_HAIR, categoryName: 'NAILS' })).toMatchObject({ ok: false, status: 409 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'rename_category', categoryId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', categoryName: 'X' })).toMatchObject({ ok: false, status: 404 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'rename_category', categoryId: CAT_HAIR, categoryName: 'Hair' })).toEqual({ ok: true });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'rename_category', categoryId: CAT_HAIR, categoryName: 'Barbering' })).toEqual({ ok: true });
    expect(state.categories.find((c) => c.id === CAT_HAIR)!.name).toBe('Barbering');
  });

  it('delete: removes the heading and 404s an unknown one', async () => {
    const { admin, state } = base();
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'delete_category', categoryId: CAT_HAIR })).toEqual({ ok: true });
    expect(state.categories.map((c) => c.id)).toEqual([CAT_NAILS]);
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'delete_category', categoryId: CAT_HAIR })).toMatchObject({ ok: false, status: 404 });
  });

  it('reorder categories and items: rejects repeats and foreign ids, writes index order', async () => {
    const { admin, state } = base();
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'reorder_categories', categoryIds: [CAT_HAIR, CAT_HAIR] })).toMatchObject({ ok: false, status: 400 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'reorder_categories', categoryIds: [CAT_HAIR, 'ffffffff-ffff-4fff-8fff-ffffffffffff'] })).toMatchObject({ ok: false, status: 400 });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'reorder_categories', categoryIds: [CAT_NAILS, CAT_HAIR] })).toEqual({ ok: true });
    expect(state.categories.map((c) => [c.id, c.sort_order])).toEqual([
      [CAT_HAIR, 1],
      [CAT_NAILS, 0],
    ]);
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'reorder_items', itemIds: [ITEM_2, ITEM_1] })).toEqual({ ok: true });
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'reorder_items', itemIds: [ITEM_1, 'ffffffff-ffff-4fff-8fff-ffffffffffff'] })).toMatchObject({ ok: false, status: 400 });
  });

  it('sync: files uncategorised offerings from their venues', async () => {
    mockVenueData.mockResolvedValue(venueDataWith({ s: { name: 'Nails', sort_order: 0 } }));
    const { admin, state } = base();
    state.providers = [{ item_id: ITEM_1, venue_id: MEMBER, source_service_id: 's', status: 'active' }];
    expect(await applyCollectiveCategoryAction(admin, COLLECTIVE, { action: 'sync_categories' })).toEqual({ ok: true });
    expect(state.items.find((i) => i.id === ITEM_1)!.category_id).toBe(CAT_NAILS);
    expect(state.items.find((i) => i.id === ITEM_2)!.category_id).toBeNull();
  });
});
