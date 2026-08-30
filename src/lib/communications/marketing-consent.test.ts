import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

/**
 * P0-14 acceptance at the SENDER, not at the helper (G21).
 *
 * A helper that returns the right boolean proves nothing if nothing calls it,
 * and that is exactly the state this task exists to fix: the profile toggles
 * were saved and read by nobody for months. So these tests drive
 * `sendCommunication` itself and assert whether the message reached the
 * channel.
 */

const hoisted = vi.hoisted(() => ({
  db: null as ReturnType<typeof makeRecordingDb> | null,
  sent: [] as string[],
  guest: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase', () => ({ getSupabaseAdminClient: () => hoisted.db!.db }));
vi.mock('./service', () => ({
  communicationService: {
    // The service takes positional arguments, not the request object.
    send: vi.fn(async (type: string) => {
      hoisted.sent.push(type);
    }),
  },
}));

import { sendCommunication } from './index';

function request(type: string) {
  return {
    type,
    recipient: { email: 'a@b.test' },
    payload: {},
    guest_id: 'guest-1',
    venue_id: 'venue-1',
  } as Parameters<typeof sendCommunication>[0];
}

describe('marketing email honours the account preference (P0-14)', () => {
  beforeEach(() => {
    hoisted.sent = [];
    hoisted.guest = { marketing_opt_out: false, user_id: 'user-1' };
    hoisted.profile = { notification_preferences: {} };
    hoisted.db = makeRecordingDb((call) => {
      if (call.table === 'guests') return { data: hoisted.guest };
      if (call.table === 'user_profiles') return { data: hoisted.profile };
      return undefined;
    });
  });

  it('SUPPRESSES marketing when the account has not opted in', async () => {
    // The live defect: this is the default state of 415 of 416 production
    // accounts, and every one of them was receiving marketing.
    await sendCommunication(request('post_visit_thankyou'));
    expect(hoisted.sent).toEqual([]);
  });

  it('sends marketing once the customer opts in', async () => {
    hoisted.profile = { notification_preferences: { marketing_email: true } };
    await sendCommunication(request('post_visit_thankyou'));
    expect(hoisted.sent).toEqual(['post_visit_thankyou']);
  });

  it('suppresses when the account opted in but the VENUE was opted out', async () => {
    // The two checks are independent: per-account and per-venue. Either one
    // saying no is enough, because the customer said no somewhere.
    hoisted.profile = { notification_preferences: { marketing_email: true } };
    hoisted.guest = { marketing_opt_out: true, user_id: 'user-1' };
    await sendCommunication(request('post_visit_thankyou'));
    expect(hoisted.sent).toEqual([]);
  });

  it('reads the preference from the namespaced shape too', async () => {
    // R3 changes the column's shape under this code path.
    hoisted.profile = {
      notification_preferences: { staff: {}, customer: { marketing_email: true } },
    };
    await sendCommunication(request('post_visit_thankyou'));
    expect(hoisted.sent).toEqual(['post_visit_thankyou']);
  });

  it('does not consult the account for an UNLINKED guest', async () => {
    // A guest with no account has no account preference to honour, and the
    // per-venue flag is the whole answer for them.
    hoisted.guest = { marketing_opt_out: false, user_id: null };
    await sendCommunication(request('post_visit_thankyou'));
    expect(hoisted.sent).toEqual(['post_visit_thankyou']);
    expect(hoisted.db!.calls.some((c) => c.table === 'user_profiles')).toBe(false);
  });
});

describe('transactional email is NOT gated by the marketing preference', () => {
  beforeEach(() => {
    hoisted.sent = [];
    // The strictest case: opted out per venue AND no account consent.
    hoisted.guest = { marketing_opt_out: true, user_id: 'user-1' };
    hoisted.profile = { notification_preferences: { marketing_email: false } };
    hoisted.db = makeRecordingDb((call) => {
      if (call.table === 'guests') return { data: hoisted.guest };
      if (call.table === 'user_profiles') return { data: hoisted.profile };
      return undefined;
    });
  });

  for (const type of [
    'booking_confirmation',
    'cancellation_confirmation',
    'pre_visit_reminder',
    'deposit_payment_request',
    'payment_receipt',
  ]) {
    it(`${type} still sends`, async () => {
      // A customer's own booking confirmation is not marketing and must never
      // be suppressed by a marketing preference. Getting this wrong would mean
      // someone books, pays a deposit, and hears nothing.
      await sendCommunication(request(type));
      expect(hoisted.sent).toEqual([type]);
    });
  }

  it('does not even look up the guest for a transactional message', async () => {
    await sendCommunication(request('booking_confirmation'));
    expect(hoisted.db!.calls).toEqual([]);
  });
});
