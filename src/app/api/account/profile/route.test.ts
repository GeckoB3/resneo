import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

/**
 * G23: the timezone field was free text validated only for length.
 *
 * A customer could save `GMT+1`, and from then on every server render that
 * called `toLocaleDateString({ timeZone })` with it threw a RangeError. The
 * profile page was one of those, so the screen that would let them fix the
 * value was the screen the value had broken. Rejecting the write is the half
 * that stops it happening; `resolveDisplayTimeZone` degrading on read is the
 * half that rescues rows already carrying one.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  user: { id: 'user-1', email: 'a@b.test' } as { id: string; email: string } | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    from: (table: string) => hoisted.db!.db.from(table),
    rpc: (fn: string, args?: unknown) => hoisted.db!.db.rpc(fn, args),
    auth: { getUser: async () => ({ data: { user: hoisted.user }, error: null }) },
  }),
}));
vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/auth/caller-auth', () => ({
  getCallerAccessToken: async () => 'token',
  updateAuthUserAsCaller: async () => ({ ok: true }),
}));

import { PATCH } from './route';

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('PATCH /api/account/profile timezone validation (G23)', () => {
  beforeEach(() => {
    hoisted.user = { id: 'user-1', email: 'a@b.test' };
    hoisted.db = makeRecordingDb((call) =>
      call.table === 'user_profiles' ? { data: { id: 'user-1' }, error: null } : undefined,
    );
  });

  it('REJECTS GMT+1 with a 400 and writes nothing', async () => {
    const res = await patch({ timezone: 'GMT+1' });
    expect(res.status).toBe(400);
    // The specific failure this closes: it must not reach the database.
    expect(hoisted.db!.calls.filter((c) => c.op === 'update')).toEqual([]);
  });

  it('rejects the other shapes a free-text field collects', async () => {
    for (const bad of ['EST', 'Europe/Lundon', 'london', 'UTC+1']) {
      expect((await patch({ timezone: bad })).status, bad).toBe(400);
    }
  });

  it('accepts a real IANA zone and persists it', async () => {
    const res = await patch({ timezone: 'Australia/Sydney' });
    expect(res.status).toBe(200);
    const update = hoisted.db!.calls.find((c) => c.op === 'update');
    expect(update?.table).toBe('user_profiles');
    expect(update?.payload).toMatchObject({ timezone: 'Australia/Sydney' });
  });

  it('leaves the field alone when it is not in the request', async () => {
    const res = await patch({ first_name: 'Ada' });
    expect(res.status).toBe(200);
    const update = hoisted.db!.calls.find((c) => c.op === 'update');
    expect(update?.payload).not.toHaveProperty('timezone');
  });
});
