import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb, PG_ERRORS } from '@/lib/testing/recording-supabase';

/**
 * P0-13: device registration has to declare which app it came from, without
 * requiring the shipped build to change.
 *
 * Build 1.0.7 is in the stores and its device payload carries no audience
 * field. If this route required one, every registration from it would fail and
 * staff push would stop for every existing user. So the field is optional and
 * absence means staff, matching the column default and the fact that the staff
 * app is currently the only client that registers devices.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  user: { id: 'user-1' } as { id: string } | null,
  insertError: null as unknown,
}));

vi.mock('@/lib/supabase/server', () => ({
  createRouteHandlerClient: async () => ({
    from: (table: string) => hoisted.db!.db.from(table),
    auth: { getUser: async () => ({ data: { user: hoisted.user }, error: null }) },
  }),
}));

import { GET, POST } from './route';

function post(body: Record<string, unknown>) {
  return POST(
    new NextRequest('http://localhost:3000/api/account/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function insertPayload() {
  const call = hoisted.db!.calls.find((c) => c.op === 'insert');
  return call?.payload as Record<string, unknown> | undefined;
}

describe('POST /api/account/devices audience (P0-13)', () => {
  beforeEach(() => {
    hoisted.user = { id: 'user-1' };
    hoisted.insertError = null;
    hoisted.db = makeRecordingDb((call) =>
      call.table === 'user_devices'
        ? { data: { id: 'device-1' }, error: call.op === 'insert' ? hoisted.insertError : null }
        : undefined,
    );
  });

  it('DEFAULTS to staff, so the shipped build keeps registering', async () => {
    // 1.0.7's exact payload: no audience field.
    const res = await post({ platform: 'ios', push_token: 'ExpoToken[abc]', app_version: '1.0.7' });
    expect(res.status).toBe(201);
    expect(insertPayload()).toMatchObject({ user_id: 'user-1', audience: 'staff' });
  });

  it('records customer when the client declares it', async () => {
    const res = await post({ platform: 'web', audience: 'customer' });
    expect(res.status).toBe(201);
    expect(insertPayload()).toMatchObject({ audience: 'customer' });
  });

  it('rejects an audience that is not one of the two', async () => {
    // The column has a CHECK; failing here gives a 400 rather than a 500.
    const res = await post({ platform: 'web', audience: 'admin' });
    expect(res.status).toBe(400);
    expect(hoisted.db!.calls.filter((c) => c.op === 'insert')).toEqual([]);
  });

  it('carries the audience onto the re-registration path too', async () => {
    // A device re-registering hits 23505 and is refreshed in place. The app
    // that last registered the token owns it, so the audience must travel with
    // the refresh rather than being left at whatever it was.
    hoisted.insertError = PG_ERRORS.uniqueViolation;
    const res = await post({ platform: 'web', push_token: 'ExpoToken[abc]', audience: 'customer' });
    expect(res.status).toBe(200);

    const update = hoisted.db!.calls.find((c) => c.op === 'update');
    expect(update?.payload).toMatchObject({ audience: 'customer' });
  });
});

describe('GET /api/account/devices', () => {
  beforeEach(() => {
    hoisted.user = { id: 'user-1' };
    hoisted.db = makeRecordingDb(() => ({ data: [] }));
  });

  it('projects audience, so a device list can say which app a device is', async () => {
    await GET(new Request('http://localhost:3000/api/account/devices'));
    const read = hoisted.db!.calls.find((c) => c.table === 'user_devices');
    expect(read?.columns).toContain('audience');
  });

  it('does NOT filter by audience: they are all the user own devices', async () => {
    // Deliberate. Sign-out-everywhere and device revocation have to reach a
    // dual-role user's staff phone too, so the list stays complete and the
    // audience is a label rather than a filter.
    await GET(new Request('http://localhost:3000/api/account/devices'));
    const read = hoisted.db!.calls.find((c) => c.table === 'user_devices');
    expect(read?.filters.some((f) => f[1] === 'audience')).toBe(false);
  });
});
