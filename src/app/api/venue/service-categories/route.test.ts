import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/venue-route-client', () => ({
  createVenueRouteClient: vi.fn(async () => ({})),
}));
vi.mock('@/lib/venue-auth', () => ({
  getVenueStaff: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));

import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { DELETE, GET, PATCH, POST } from './route';
import { PUT as REORDER } from './reorder/route';

const mockStaff = vi.mocked(getVenueStaff);
const mockAdmin = vi.mocked(getSupabaseAdminClient);

const VENUE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_A = '11111111-1111-4111-8111-111111111111';
const CAT_B = '22222222-2222-4222-8222-222222222222';
const CAT_X = '99999999-9999-4999-8999-999999999999';

type Call = { table: string; op: string; payload?: unknown; filters: Array<[string, ...unknown[]]> };

/** Responder-driven fake for the admin client; records every query for assertions. */
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
      b.delete = chain(() => {
        call.op = 'delete';
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

function req(method: string, body?: unknown, query = ''): NextRequest {
  return {
    method,
    nextUrl: { searchParams: new URLSearchParams(query) },
    json: async () => body,
  } as unknown as NextRequest;
}

function staff(role: 'admin' | 'staff' = 'admin') {
  return { id: 's1', venue_id: VENUE, email: 'a@b.c', role, db: {} } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/venue/service-categories', () => {
  it('401 without a staff session', async () => {
    mockStaff.mockResolvedValue(null);
    const res = await GET(req('GET'));
    expect(res.status).toBe(401);
  });

  it('lists the venue\'s categories in order for any staff member', async () => {
    mockStaff.mockResolvedValue(staff('staff'));
    const { admin, calls } = makeAdmin(() => ({
      data: [
        { id: CAT_A, name: 'Hair', sort_order: 0 },
        { id: CAT_B, name: 'Nails', sort_order: null },
      ],
    }));
    mockAdmin.mockReturnValue(admin as never);
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      categories: [
        { id: CAT_A, name: 'Hair', sort_order: 0 },
        { id: CAT_B, name: 'Nails', sort_order: 0 },
      ],
    });
    expect(calls[0]!.filters).toContainEqual(['eq', 'venue_id', VENUE]);
  });
});

describe('POST /api/venue/service-categories', () => {
  it('403 for non-admin staff', async () => {
    mockStaff.mockResolvedValue(staff('staff'));
    const res = await POST(req('POST', { name: 'Hair' }));
    expect(res.status).toBe(403);
  });

  it('400 on a blank name', async () => {
    mockStaff.mockResolvedValue(staff());
    mockAdmin.mockReturnValue(makeAdmin(() => ({})).admin as never);
    const res = await POST(req('POST', { name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('appends after the last category with a cleaned name', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin, calls } = makeAdmin((call) => {
      if (call.op === 'select') return { data: { sort_order: 4 } };
      return { data: { id: CAT_A, name: 'Hair & Beauty', sort_order: 5 } };
    });
    mockAdmin.mockReturnValue(admin as never);
    const res = await POST(req('POST', { name: '  Hair   &  Beauty ' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ category: { id: CAT_A, name: 'Hair & Beauty', sort_order: 5 } });
    const insert = calls.find((c) => c.op === 'insert');
    expect(insert?.payload).toEqual({ venue_id: VENUE, name: 'Hair & Beauty', sort_order: 5 });
  });

  it('409 when the name already exists for the venue', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin } = makeAdmin((call) =>
      call.op === 'insert' ? { error: { code: '23505', message: 'duplicate' } } : { data: null },
    );
    mockAdmin.mockReturnValue(admin as never);
    const res = await POST(req('POST', { name: 'Hair' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already have a category called "Hair"/);
  });
});

describe('PATCH and DELETE /api/venue/service-categories', () => {
  it('renames within the venue and 404s a foreign or missing id', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin, calls } = makeAdmin((call) =>
      call.filters.some(([f, k, v]) => f === 'eq' && k === 'id' && v === CAT_A)
        ? { data: { id: CAT_A, name: 'Colour', sort_order: 0 } }
        : { data: null },
    );
    mockAdmin.mockReturnValue(admin as never);

    const ok = await PATCH(req('PATCH', { id: CAT_A, name: 'Colour' }));
    expect(ok.status).toBe(200);
    const update = calls.find((c) => c.op === 'update');
    expect(update?.filters).toContainEqual(['eq', 'venue_id', VENUE]);
    expect((update?.payload as { name: string }).name).toBe('Colour');

    const missing = await PATCH(req('PATCH', { id: CAT_X, name: 'Colour' }));
    expect(missing.status).toBe(404);
  });

  it('deletes by body id or query id, scoped to the venue', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin, calls } = makeAdmin(() => ({ data: { id: CAT_A } }));
    mockAdmin.mockReturnValue(admin as never);

    expect((await DELETE(req('DELETE', { id: CAT_A }))).status).toBe(200);
    expect((await DELETE(req('DELETE', undefined, `id=${CAT_A}`))).status).toBe(200);
    for (const call of calls) {
      expect(call.op).toBe('delete');
      expect(call.filters).toContainEqual(['eq', 'venue_id', VENUE]);
    }
  });
});

describe('PUT /api/venue/service-categories/reorder', () => {
  it('403 for non-admin staff', async () => {
    mockStaff.mockResolvedValue(staff('staff'));
    expect((await REORDER(req('PUT', { category_ids: [CAT_A] }))).status).toBe(403);
  });

  it('400 on a repeated id or an id from another venue', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin } = makeAdmin(() => ({ data: [{ id: CAT_A }] }));
    mockAdmin.mockReturnValue(admin as never);
    expect((await REORDER(req('PUT', { category_ids: [CAT_A, CAT_A] }))).status).toBe(400);
    expect((await REORDER(req('PUT', { category_ids: [CAT_A, CAT_X] }))).status).toBe(400);
  });

  it('writes sort_order = index for every id', async () => {
    mockStaff.mockResolvedValue(staff());
    const { admin, calls } = makeAdmin((call) =>
      call.op === 'select' ? { data: [{ id: CAT_A }, { id: CAT_B }] } : { data: null },
    );
    mockAdmin.mockReturnValue(admin as never);
    const res = await REORDER(req('PUT', { category_ids: [CAT_B, CAT_A] }));
    expect(res.status).toBe(200);
    const updates = calls.filter((c) => c.op === 'update');
    expect(updates.map((u) => [(u.payload as { sort_order: number }).sort_order, u.filters[0]![2]])).toEqual([
      [0, CAT_B],
      [1, CAT_A],
    ]);
  });
});
