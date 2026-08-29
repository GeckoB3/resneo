import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

/**
 * P0-1c: every `/api/account/*` route refuses an unauthenticated caller.
 *
 * ENUMERATED FROM THE FILESYSTEM, not from a hand-written list. A list is the
 * thing that goes stale: the route added next week is exactly the one nobody
 * writes the auth test for, and nothing would say so.
 * `schedule-fail-closed-coverage.test.ts` records four routes escaping an
 * enumeration for precisely that reason, and P0-11's contract test already
 * pins the route COUNT for the same purpose. This pins their behaviour.
 *
 * What it asserts is narrow and absolute: with no session, every exported HTTP
 * handler returns 401 and writes nothing. It deliberately does not check the
 * happy path or cross-user denial per route, which need per-route fixtures and
 * belong with each route's own test; the plan's acceptance for this piece is
 * that every route has AT LEAST an auth test, and the value of doing it this
 * way is that it cannot fall behind the directory.
 *
 * The 401 must also come BEFORE the body is read. A handler that parses first
 * lets an anonymous caller push work onto the server, and several here take
 * bodies large enough for that to matter.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  bodyReads: 0,
}));

/** No session, on every client shape the routes use. */
vi.mock('@/lib/supabase/server', () => {
  const anonymous = {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
    },
    from: (table: string) => hoisted.db!.db.from(table),
    rpc: (fn: string, args?: unknown) => hoisted.db!.db.rpc(fn, args),
  };
  return {
    createRouteHandlerClient: async () => anonymous,
    createClient: async () => anonymous,
  };
});
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/stripe', () => ({
  stripe: {
    setupIntents: { create: vi.fn() },
    paymentIntents: { create: vi.fn(), retrieve: vi.fn() },
    subscriptions: { create: vi.fn(), update: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    customers: { create: vi.fn(), retrieve: vi.fn() },
    paymentMethods: { list: vi.fn(), detach: vi.fn() },
    refunds: { create: vi.fn() },
  },
}));
vi.mock('@/lib/auth/caller-auth', () => ({
  getCallerAccessToken: async () => null,
  updateAuthUserAsCaller: async () => ({ ok: true }),
  signOutCaller: async () => ({ ok: true }),
  deleteUserDevices: async () => undefined,
}));

/**
 * Every route module under /api/account, discovered at build time.
 *
 * `import.meta.glob` is a Vite feature and is not in TypeScript's ImportMeta,
 * so it is typed here rather than by widening the project's types for one
 * test file.
 */
type RouteModuleLoader = () => Promise<Record<string, unknown>>;
const ROUTE_MODULES = (
  import.meta as unknown as { glob: (pattern: string) => Record<string, RouteModuleLoader> }
).glob('/src/app/api/account/**/route.ts');

const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

function routePath(file: string): string {
  return file.replace('/src/app/api/account/', '').replace('/route.ts', '') || '(index)';
}

/**
 * A request that records whether the handler read its body. `json()` is
 * wrapped rather than the body omitted, because a handler that reads an absent
 * body still reads it.
 */
function makeRequest(method: string): NextRequest {
  const req = new NextRequest('http://localhost:3000/api/account/x', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify({ probe: true }) }),
  });
  const original = req.json.bind(req);
  Object.defineProperty(req, 'json', {
    value: async () => {
      hoisted.bodyReads += 1;
      return original();
    },
  });
  return req;
}

/**
 * Load every route module once before the assertions start.
 *
 * The cost being paid here is module loading, not the check. P2-1's cancel
 * route pulls in the whole cancel service graph (Stripe, card holds, waitlist
 * offers, comms, table lifecycle), and the first test to import it spent more
 * than the 5s default timeout doing so and failed on a route that answers 401
 * correctly. `src/app/api/confirm/characterisation/cancel.test.ts:166` carries
 * the same `beforeAll` for the same reason.
 *
 * Warming every module rather than the heavy one keeps this from having to be
 * revisited each time a route grows a dependency, and it means no single test
 * is charged for an import the whole file shares.
 */
beforeAll(async () => {
  await Promise.all(Object.values(ROUTE_MODULES).map((load) => load()));
}, 120_000);

describe('P0-1c: every /api/account route refuses an anonymous caller', () => {
  beforeEach(() => {
    hoisted.bodyReads = 0;
    // Responds to everything, so a handler that got past the auth check would
    // succeed rather than crash. A crash would look like a pass otherwise.
    hoisted.db = makeRecordingDb(() => ({ data: [], error: null }));
  });

  it('discovers every route file', () => {
    // Without this the glob could match nothing and every assertion below
    // would vacuously pass.
    const found = Object.keys(ROUTE_MODULES);
    expect(found.length, 'no route modules found; the glob is wrong').toBeGreaterThanOrEqual(27);
    expect(found.some((f) => f.includes('/bookings/route.ts'))).toBe(true);
    expect(found.some((f) => f.includes('/profile/route.ts'))).toBe(true);
  });

  for (const [file, load] of Object.entries(ROUTE_MODULES)) {
    const label = routePath(file);

    it(`${label} returns 401 from every handler, and writes nothing`, async () => {
      const mod = await load();
      const exported = METHODS.filter((m) => typeof mod[m] === 'function');
      expect(exported.length, `${label} exports no HTTP handler`).toBeGreaterThan(0);

      for (const method of exported) {
        const handler = mod[method] as (
          req: NextRequest,
          ctx: { params: Promise<Record<string, string>> },
        ) => Promise<Response>;

        const res = await handler(makeRequest(method), {
          // Dynamic segments get a plausible id; a handler that 401s correctly
          // never looks at it.
          params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
        });

        expect(res.status, `${label} ${method} should refuse an anonymous caller`).toBe(401);
      }

      // Nothing anonymous may reach the database.
      const writes = hoisted.db!.calls.filter((c) => c.op !== 'select');
      expect(writes, `${label} wrote to the database while unauthenticated`).toEqual([]);
    });
  }

  it('no handler reads its request body before refusing', async () => {
    // Parsing first lets an anonymous caller push work onto the server, and
    // several of these routes take bodies large enough for that to matter.
    const offenders: string[] = [];
    for (const [file, load] of Object.entries(ROUTE_MODULES)) {
      const mod = await load();
      for (const method of METHODS) {
        if (typeof mod[method] !== 'function') continue;
        if (method === 'GET' || method === 'DELETE') continue;
        hoisted.bodyReads = 0;
        const handler = mod[method] as (
          req: NextRequest,
          ctx: { params: Promise<Record<string, string>> },
        ) => Promise<Response>;
        await handler(makeRequest(method), {
          params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
        });
        if (hoisted.bodyReads > 0) offenders.push(`${routePath(file)} ${method}`);
      }
    }
    expect(offenders, 'these parse the body before checking auth').toEqual([]);
  });
});
