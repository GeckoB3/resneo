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
  /** Rows the address lookup returns, as `guests` would for (venue, email). */
  guestsByEmail: [] as Array<{ user_id: string | null }>,
  /** Filters the guest lookup applied, so the venue scoping is assertable. */
  guestFilters: {} as Record<string, unknown>,
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
        /*
          Two shapes, because the sender has two ways in. By booking it reads
          one guest by id and takes `maybeSingle`. By address it filters
          venue AND email and takes the rows, which is the query the venue
          scoping lives in, so the mock records those filters rather than
          ignoring them.
        */
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (col: string, val: unknown) => {
            hoisted.guestFilters[col] = val;
            return chain;
          },
          maybeSingle: async () => ({ data: { user_id: hoisted.guestUserId } }),
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: hoisted.guestsByEmail, error: null }),
        };
        return chain;
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
  hoisted.guestsByEmail = [{ user_id: 'user-1' }];
  hoisted.guestFilters = {};
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

describe('reaching a waitlist joiner, who has no booking', () => {
  /**
   * The address path exists because `waitlist_entries` stores no id for the
   * person: an entry is made before there is a booking, often by somebody with
   * no account. So the only key is the address they typed, and a typed address
   * is not proof of anything, which is what the venue scoping is for.
   */
  async function sendWaitlist(email: string | null = 'cass@example.com') {
    const { sendCustomerPush } = await import('./customer-push-notification');
    return sendCustomerPush({
      venueId: 'venue-1',
      guestEmail: email,
      bookingPageUrl: 'https://www.resneo.com/book/the-studio',
      event: 'waitlist_offer',
      body: 'A place has come up at The Studio.',
    });
  }

  it('reaches a claimed account at that venue', async () => {
    expect(await sendWaitlist()).toEqual({ sent: true, reason: undefined });
  });

  it('looks the address up AT THAT VENUE, never across ResNeo', async () => {
    /*
      The security property of this path. Without the venue filter, typing a
      stranger's address into any venue's waitlist form would push to their
      phone. With it, the reach of a typed address is bounded by a relationship
      that venue already has, and is already emailing about this same offer.
    */
    await sendWaitlist();
    expect(hoisted.guestFilters.venue_id).toBe('venue-1');
    expect(hoisted.guestFilters.email).toBe('cass@example.com');
  });

  it('normalises the address the way the join routes store it', async () => {
    await sendWaitlist('  Cass@Example.COM ');
    expect(hoisted.guestFilters.email).toBe('cass@example.com');
  });

  it('says no_guest for an address this venue does not know', async () => {
    hoisted.guestsByEmail = [];
    expect(await sendWaitlist()).toEqual({ sent: false, reason: 'no_guest' });
  });

  it('says no_account for one it knows who has never signed in', async () => {
    // A different silence from the one above, and the reason both are logged:
    // this customer becomes reachable the day they make an account.
    hoisted.guestsByEmail = [{ user_id: null }];
    expect(await sendWaitlist()).toEqual({ sent: false, reason: 'no_account' });
  });

  it('takes the claimed row when the venue holds several for one address', async () => {
    hoisted.guestsByEmail = [{ user_id: null }, { user_id: 'user-9' }];
    expect(await sendWaitlist()).toEqual({ sent: true, reason: undefined });
    expect(hoisted.deviceFilters.user_id).toBe('user-9');
  });

  it('sends nothing at all when the entry has no address', async () => {
    expect(await sendWaitlist(null)).toEqual({ sent: false, reason: 'no_guest' });
  });

  it('carries no booking_id, since a tap has no booking to open', async () => {
    // A fabricated id would route the tap to a 404. The venue and the booking
    // page are what the offer email already points at.
    await sendWaitlist();
    const data = hoisted.sentMessage?.data as Record<string, unknown>;
    expect(data.booking_id, 'absent, not null, so a client can test for it').toBeUndefined();
    expect(data).toMatchObject({
      type: 'waitlist_offer',
      venue_id: 'venue-1',
      url: 'https://www.resneo.com/book/the-studio',
    });
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
