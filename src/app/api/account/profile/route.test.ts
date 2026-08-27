import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { readPreferenceNamespace } from '@/lib/notifications/notification-preferences';
import { parseStaffNotificationPrefs } from '@/lib/push/staff-notification-prefs';

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
  profile: {} as Record<string, unknown>,
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

import { GET, PATCH } from './route';

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest('http://localhost:3000/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

// File-level, not per-describe: a recorder shared across blocks carries the
// previous test's calls, and an assertion that looks for "the update" then
// finds one from a test that never ran the code under test.
beforeEach(() => {
  hoisted.user = { id: 'user-1', email: 'a@b.test' };
  hoisted.profile = { id: 'user-1', notification_preferences: {} };
  hoisted.db = makeRecordingDb((call) =>
    call.table === 'user_profiles' ? { data: hoisted.profile, error: null } : undefined,
  );
});

describe('PATCH /api/account/profile timezone validation (G23)', () => {
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


/**
 * P0-13's R2 half at the route. `/api/v1/me/profile` re-exports this handler,
 * so the customer portal and the shipped staff app PATCH the same free-form
 * jsonb column through it.
 */
describe('PATCH /api/account/profile notification preferences (P0-13)', () => {
  const DUAL_ROLE_FLAT = {
    // What build 1.0.7 wrote.
    push_enabled: true,
    new_booking: false,
    quiet_hours_enabled: true,
    quiet_hours_start: '22:00',
    // What the portal wrote, into the same object.
    operational_email: true,
    marketing_email: false,
  };

  function currentPrefs() {
    const update = hoisted.db!.calls.find((c) => c.op === 'update');
    return (update?.payload as { notification_preferences?: Record<string, unknown> })
      ?.notification_preferences;
  }

  it('a customer save DOES NOT ERASE staff push preferences', async () => {
    // The live defect: the route assigned the incoming object straight onto the
    // column, so a client sending only its own two keys wiped the other set.
    // Linked accounts actively create users who have both.
    hoisted.profile = { id: 'user-1', notification_preferences: DUAL_ROLE_FLAT };

    const res = await patch({ notification_preferences: { marketing_email: true } });
    expect(res.status).toBe(200);

    const next = currentPrefs()!;
    expect(parseStaffNotificationPrefs(next).new_booking).toBe(false);
    expect(parseStaffNotificationPrefs(next).quiet_hours_start).toBe('22:00');
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(true);
  });

  it('does the same once the column is namespaced', async () => {
    // The same request, on the far side of R3. Neither shape may lose data.
    hoisted.profile = {
      id: 'user-1',
      notification_preferences: {
        staff: { new_booking: false, quiet_hours_start: '22:00' },
        customer: { operational_email: true, marketing_email: false },
      },
    };

    await patch({ notification_preferences: { marketing_email: true } });

    const next = currentPrefs()!;
    expect(parseStaffNotificationPrefs(next).new_booking).toBe(false);
    expect(readPreferenceNamespace(next, 'customer').marketing_email).toBe(true);
  });

  it("routes the shipped app's flat staff keys into the staff namespace", async () => {
    // 1.0.7 PATCHes flat keys and will keep doing so after R3. They must land
    // where the staff reader looks.
    hoisted.profile = {
      id: 'user-1',
      notification_preferences: { staff: { new_booking: false }, customer: {} },
    };

    await patch({ notification_preferences: { new_booking: true, quiet_hours_enabled: true } });

    const next = currentPrefs()!;
    expect(parseStaffNotificationPrefs(next).new_booking).toBe(true);
    expect(parseStaffNotificationPrefs(next).quiet_hours_enabled).toBe(true);
  });

  it('leaves the column alone when the request does not mention it', async () => {
    hoisted.profile = { id: 'user-1', notification_preferences: DUAL_ROLE_FLAT };
    await patch({ first_name: 'Ada' });
    const update = hoisted.db!.calls.find((c) => c.op === 'update');
    expect(update?.payload).not.toHaveProperty('notification_preferences');
  });
});

describe('GET /api/account/profile mirrors staff keys (§5D.0 B7)', () => {
  it('a flat reader still sees its keys after the column is namespaced', async () => {
    // Build 1.0.7 reads notification_preferences.new_booking off this response.
    // Without the mirror it would read undefined the moment R3 lands, show
    // defaults, and write them back on the user's next save.
    hoisted.profile = {
      id: 'user-1',
      notification_preferences: {
        staff: { new_booking: false, quiet_hours_start: '22:00' },
        customer: { marketing_email: true },
      },
    };

    const res = await GET(new Request('http://localhost:3000/api/account/profile'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      profile: { notification_preferences: Record<string, unknown> };
    };

    expect(body.profile.notification_preferences.new_booking).toBe(false);
    expect(body.profile.notification_preferences.quiet_hours_start).toBe('22:00');
    // The real shape is still there for a client that understands it.
    expect(body.profile.notification_preferences.staff).toMatchObject({ new_booking: false });
    // Customer keys are not mirrored: 1.0.7 has no use for them.
    expect(body.profile.notification_preferences.marketing_email).toBeUndefined();
  });

  it('is a no-op before R3', async () => {
    hoisted.profile = {
      id: 'user-1',
      notification_preferences: { new_booking: false, marketing_email: true },
    };
    const res = await GET(new Request('http://localhost:3000/api/account/profile'));
    const body = (await res.json()) as {
      profile: { notification_preferences: Record<string, unknown> };
    };
    expect(body.profile.notification_preferences).toEqual({
      new_booking: false,
      marketing_email: true,
    });
  });
});
