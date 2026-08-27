import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb, type RecordedCall } from '@/lib/testing/recording-supabase';

/**
 * P0-13: `sendStaffPush` must only reach STAFF devices.
 *
 * It selected every row for a staff member's user_id. That is harmless while
 * the staff app is the only writer to `user_devices`, and stops being harmless
 * the moment the customer app registers one: a dual-role person, which linked
 * accounts actively create, gets staff booking alerts pushed to the customer
 * app on their personal phone, complete with a guest's name and appointment.
 *
 * There is no column that recovers the origin after the fact, which is why the
 * discriminator and this filter have to be in place BEFORE the second writer,
 * not after it.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  pushed: [] as string[][],
  invalidTokens: [] as string[],
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('@/lib/push/expo-push', () => ({
  sendExpoPush: async (tokens: string[]) => {
    hoisted.pushed.push(tokens);
    return { sent: tokens.length, invalidTokens: hoisted.invalidTokens };
  },
}));

import { sendStaffPush } from './staff-push-notification';

/** A dual-role user: one staff device and one customer device, same person. */
const DEVICE_ROWS = [
  { push_token: 'ExpoToken[staff-phone]', audience: 'staff', user_id: 'user-1' },
  { push_token: 'ExpoToken[customer-phone]', audience: 'customer', user_id: 'user-1' },
];

function audienceFilter(call: RecordedCall): unknown {
  return call.filters.find((f) => f[0] === 'eq' && f[1] === 'audience')?.[2];
}

function responder(call: RecordedCall) {
  switch (call.table) {
    case 'staff':
      return { data: [{ user_id: 'user-1' }] };
    case 'user_profiles':
      // Push on, no quiet hours, all events allowed: the defaults.
      return { data: [{ id: 'user-1', notification_preferences: {} }] };
    case 'venues':
      return { data: { timezone: 'Europe/London' } };
    case 'user_devices': {
      // Honour the audience filter, so the test can tell a filtered query from
      // an unfiltered one by what comes back.
      const wanted = audienceFilter(call);
      const rows = wanted ? DEVICE_ROWS.filter((d) => d.audience === wanted) : DEVICE_ROWS;
      return { data: rows };
    }
    default:
      return undefined;
  }
}

const BOOKING = { id: 'booking-1', guest_name: 'Ada', booking_date: '2026-09-01', booking_time: '18:00' };

describe('sendStaffPush device audience (P0-13)', () => {
  beforeEach(() => {
    hoisted.pushed = [];
    hoisted.invalidTokens = [];
    hoisted.db = makeRecordingDb(responder);
  });

  it('pushes ONLY to staff devices, never to the customer app', async () => {
    const result = await sendStaffPush(BOOKING, { name: 'The Wharf' }, 'venue-1', 'new_booking');
    expect(result.sent).toBe(true);

    expect(hoisted.pushed).toEqual([['ExpoToken[staff-phone]']]);
    // The specific leak: a guest's name and appointment time, delivered to the
    // same person's customer app.
    expect(hoisted.pushed.flat()).not.toContain('ExpoToken[customer-phone]');
  });

  it('asks the database for the filter rather than filtering afterwards', async () => {
    await sendStaffPush(BOOKING, { name: 'The Wharf' }, 'venue-1', 'new_booking');
    const deviceRead = hoisted.db!.calls.find(
      (c) => c.table === 'user_devices' && c.op === 'select',
    );
    expect(audienceFilter(deviceRead!)).toBe('staff');
  });

  it('scopes the dead-token prune to staff rows as well', async () => {
    // Expo tokens are per app install, but they are user-supplied strings on a
    // shared table. An unscoped delete by token value would deregister the
    // customer device that happened to hold the same one.
    hoisted.invalidTokens = ['ExpoToken[staff-phone]'];
    await sendStaffPush(BOOKING, { name: 'The Wharf' }, 'venue-1', 'new_booking');

    const del = hoisted.db!.calls.find((c) => c.table === 'user_devices' && c.op === 'delete');
    expect(del, 'a dead token should be pruned').toBeDefined();
    expect(audienceFilter(del!)).toBe('staff');
    // And still scoped to the users this send addressed (P0-12).
    expect(del!.filters.some((f) => f[0] === 'in' && f[1] === 'user_id')).toBe(true);
  });

  it('reports no_tokens when the user has only a customer device', async () => {
    hoisted.db = makeRecordingDb((call) =>
      call.table === 'user_devices'
        ? { data: DEVICE_ROWS.filter((d) => d.audience === 'customer' && audienceFilter(call) === 'customer') }
        : responder(call),
    );
    const result = await sendStaffPush(BOOKING, { name: 'The Wharf' }, 'venue-1', 'new_booking');
    expect(result).toEqual({ sent: false, reason: 'no_tokens' });
    expect(hoisted.pushed).toEqual([]);
  });
});
