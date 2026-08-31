/**
 * P5-2: push to a customer, without reaching a staff device.
 *
 * The audience filter is the whole reason this is a separate function. Linked
 * accounts actively create people who are both a venue's staff and somebody
 * else's customer, and they hold devices for both apps under one `user_id`.
 * Most of what follows is about that one boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  bookingGuestId: 'guest-1' as string | null,
  guestUserId: 'user-1' as string | null,
  prefs: {} as Record<string, unknown>,
  devices: [{ push_token: 'ExponentPushToken[customer]' }] as Array<{ push_token: string | null }>,
  /** Filters the device SELECT applied, so the audience scoping is assertable. */
  deviceFilters: {} as Record<string, unknown>,
  /** Filters the prune DELETE applied. */
  deleteFilters: {} as Record<string, unknown>,
  deleted: false,
  sentMessage: null as Record<string, unknown> | null,
  invalidTokens: [] as string[],
  sendThrows: false,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { guest_id: hoisted.bookingGuestId } }) }),
          }),
        };
      }
      if (table === 'guests') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { user_id: hoisted.guestUserId } }) }),
          }),
        };
      }
      if (table === 'user_devices') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          delete: () => {
            hoisted.deleted = true;
            return chain;
          },
          eq: (col: string, val: unknown) => {
            hoisted.deviceFilters[col] = val;
            if (hoisted.deleted) hoisted.deleteFilters[col] = val;
            return chain;
          },
          in: (col: string, val: unknown) => {
            if (hoisted.deleted) hoisted.deleteFilters[col] = val;
            return chain;
          },
          not: () => Promise.resolve({ data: hoisted.devices, error: null }),
        };
        return chain;
      }
      if (table === 'user_profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { notification_preferences: { customer: hoisted.prefs } },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

vi.mock('@/lib/push/expo-push', () => ({
  sendExpoPush: async (_tokens: string[], message: Record<string, unknown>) => {
    if (hoisted.sendThrows) throw new Error('expo down');
    hoisted.sentMessage = message;
    return { sent: 1, invalidTokens: hoisted.invalidTokens };
  },
}));

async function send(event: 'reminder' | 'booking_changed' | 'waitlist_offer' = 'reminder') {
  const { sendCustomerPush } = await import('./customer-push-notification');
  return sendCustomerPush({ bookingId: 'bk-1', event, body: 'Tomorrow at 10:00' });
}

beforeEach(() => {
  hoisted.bookingGuestId = 'guest-1';
  hoisted.guestUserId = 'user-1';
  hoisted.prefs = {};
  hoisted.devices = [{ push_token: 'ExponentPushToken[customer]' }];
  hoisted.deviceFilters = {};
  hoisted.deleteFilters = {};
  hoisted.deleted = false;
  hoisted.sentMessage = null;
  hoisted.invalidTokens = [];
  hoisted.sendThrows = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the audience boundary', () => {
  it('selects CUSTOMER devices only', async () => {
    /*
      The reason this is not a parameter on the staff sender. A dual-role
      person holds devices for both apps under one user_id, and without this
      filter a customer reminder lands on their work phone in the staff app.
    */
    await send();
    expect(hoisted.deviceFilters.audience).toBe('customer');
    expect(hoisted.deviceFilters.user_id).toBe('user-1');
  });

  it('prunes a dead token within this audience only', async () => {
    // Unscoped, a dead customer token would deregister the staff device that
    // happens to share the value.
    hoisted.invalidTokens = ['ExponentPushToken[dead]'];
    await send();
    expect(hoisted.deleteFilters.audience).toBe('customer');
    expect(hoisted.deleteFilters.user_id).toBe('user-1');
  });

  it('uses customer channel ids, not the staff ones', async () => {
    // bookings-new and friends are what a venue's staff app means by those
    // words, and a customer may have configured that channel for something
    // else entirely.
    await send('booking_changed');
    expect(String(hoisted.sentMessage?.channelId)).toMatch(/^customer-/);
    expect(hoisted.sentMessage?.channelId).not.toBe('bookings-changed');
  });
});

describe('who gets nothing', () => {
  it('a booking with no guest', async () => {
    hoisted.bookingGuestId = null;
    expect(await send()).toEqual({ sent: false, reason: 'no_guest' });
  });

  it('a guest who has never signed in', async () => {
    // No account means no devices and no preferences to honour.
    hoisted.guestUserId = null;
    expect(await send()).toEqual({ sent: false, reason: 'no_account' });
  });

  it('an account with no customer device registered', async () => {
    hoisted.devices = [];
    expect(await send()).toEqual({ sent: false, reason: 'no_tokens' });
  });
});

describe('the payload', () => {
  it('carries the booking id the app routes on', async () => {
    await send();
    expect((hoisted.sentMessage?.data as Record<string, unknown>).booking_id).toBe('bk-1');
  });

  it('sends a badge, which the staff sender never does', async () => {
    // Recorded in 5D: the app is fully wired to display and clear a badge, so
    // without this the iOS badge can never increment.
    await send();
    expect(hoisted.sentMessage?.badge).toBe(1);
  });
});

describe('failure', () => {
  it('fails soft when the transport throws', async () => {
    // A push is a courtesy on top of an email that has already gone. Nothing
    // here is worth failing a booking flow over.
    hoisted.sendThrows = true;
    expect(await send()).toEqual({ sent: false, reason: 'send_error' });
  });
});
