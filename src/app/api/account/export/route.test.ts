/**
 * P4-5 at the route: who may ask, how often, and how it arrives.
 *
 * The download-not-email rule is asserted here because it is a property of the
 * RESPONSE, not of the document: the same JSON emailed instead would be the
 * thing the plan rules out, and nothing in the builder could tell.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hoisted = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'ada@example.test' } as { id: string; email: string } | null,
  rateOk: true,
  /** The key the limiter was bucketed by, to prove it is per user. */
  rateKeyedOn: null as string | null,
  built: { about: { description: 'x' }, bookings: [] } as unknown,
  buildThrows: false,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: hoisted.user } }) },
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => ({}) }));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (key: string) => {
    hoisted.rateKeyedOn = key;
    return hoisted.rateOk ? { ok: true } : { ok: false, retryAfterSec: 900 };
  },
}));
vi.mock('@/lib/account/account-export', () => ({
  buildAccountExport: async () => {
    if (hoisted.buildThrows) throw new Error('read failed');
    return hoisted.built;
  },
  accountExportFilename: () => 'resneo-account-export-2026-08-30.json',
}));

async function get() {
  const { GET } = await import('./route');
  return GET(new NextRequest('http://localhost:3000/api/account/export'));
}

beforeEach(() => {
  hoisted.user = { id: 'user-1', email: 'ada@example.test' };
  hoisted.rateOk = true;
  hoisted.rateKeyedOn = null;
  hoisted.buildThrows = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('delivery', () => {
  it('arrives as a download, not as a page', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename=/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
  });

  it('is never cached, because it is a personal-data archive', async () => {
    expect((await get()).headers.get('Cache-Control')).toMatch(/no-store/);
  });

  it('is readable rather than minified, since a person may open it', async () => {
    const body = await (await get()).text();
    expect(body).toContain('\n');
  });
});

describe('who may ask', () => {
  it('refuses an anonymous caller', async () => {
    hoisted.user = null;
    const res = await get();
    expect(res.status).toBe(401);
  });

  it('limits PER USER, not per IP', async () => {
    /*
      The cost of this route is several full reads for ONE account, so the
      thing worth bounding is how often that account can ask. Keying on IP
      would let somebody rotate addresses, and would block an office because a
      colleague exported first.
    */
    await get();
    expect(hoisted.rateKeyedOn).toBe('user-1');
  });

  it('refuses politely, with a Retry-After, when the limit is hit', async () => {
    hoisted.rateOk = false;
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('900');
    expect((await res.json()).code).toBe('RATE_LIMITED');
  });

  it('checks the limit BEFORE doing the expensive work', async () => {
    hoisted.rateOk = false;
    hoisted.buildThrows = true;
    // If the build ran first this would be a 500, not a 429.
    expect((await get()).status).toBe(429);
  });
});

describe('failure', () => {
  it('answers 500 rather than a half-written file', async () => {
    hoisted.buildThrows = true;
    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Disposition'), 'a failed export was offered as a download').toBeNull();
  });
});
