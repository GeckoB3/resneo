import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import {
  accountAllowsMarketingEmail,
  accountAllowsPlatformEmail,
  accountUserIdForGuest,
} from './customer-email-consent';

/**
 * P0-14 / G21: the profile toggles now do something.
 *
 * Until this, `/account/profile` offered two switches, saved them, and nothing
 * anywhere read either one. A customer could turn marketing email off, watch
 * the setting persist across a reload, and keep receiving it.
 *
 * Every case below runs against BOTH column shapes, because R3's migration
 * changes it and a reader on the wrong side reads defaults rather than failing.
 */

const FLAT = { marketing_email: true, operational_email: false };
const NAMESPACED = { staff: {}, customer: { marketing_email: true, operational_email: false } };
/** What R3 actually writes: namespaced, with the flat staff keys retained. */
const MIGRATED = { no_show: false, staff: { no_show: false }, customer: { marketing_email: true } };

function db(prefs: unknown, opts: { error?: { message: string } } = {}) {
  return makeRecordingDb((call) =>
    call.table === 'user_profiles'
      ? { data: opts.error ? null : { notification_preferences: prefs }, error: opts.error ?? null }
      : undefined,
  ).db;
}

describe('marketing consent', () => {
  it('reads the account preference from either shape', async () => {
    for (const [label, prefs] of [
      ['flat', FLAT],
      ['namespaced', NAMESPACED],
      ['migrated dual shape', MIGRATED],
    ] as const) {
      expect(await accountAllowsMarketingEmail(db(prefs), 'user-1'), label).toBe(true);
    }
  });

  it('is OPT-IN: an unset preference means no marketing', async () => {
    // Matches the profile UI, which reads `marketing_email === true`. Treating
    // absence as consent would opt in 415 of the 416 production accounts.
    for (const prefs of [{}, { staff: {}, customer: {} }, null, { customer: {} }]) {
      expect(await accountAllowsMarketingEmail(db(prefs), 'user-1')).toBe(false);
    }
  });

  it('honours an explicit false', async () => {
    expect(await accountAllowsMarketingEmail(db({ marketing_email: false }), 'user-1')).toBe(false);
    expect(
      await accountAllowsMarketingEmail(db({ customer: { marketing_email: false }, staff: {} }), 'u'),
    ).toBe(false);
  });

  it('does not mistake a STAFF key for a customer preference', async () => {
    // The collision the namespace exists to end: both key sets shared one
    // object, so a staff-only row must not read as customer consent.
    const staffOnly = { staff: { new_booking: true }, customer: {} };
    expect(await accountAllowsMarketingEmail(db(staffOnly), 'user-1')).toBe(false);
  });
});

describe('platform email consent', () => {
  it('NEVER suppresses a security email, whatever the preference says', async () => {
    // A setting that could switch off a sign-in link or a password-change
    // notice is a setting whose worst case is an attacker turning it on.
    const off = db({ operational_email: false });
    expect(await accountAllowsPlatformEmail(off, 'user-1', 'security')).toBe(true);
  });

  it('does not even read the column for a security email', async () => {
    // So an outage on user_profiles cannot delay a sign-in link.
    const recording = makeRecordingDb(() => ({ data: null, error: { message: 'down' } }));
    expect(await accountAllowsPlatformEmail(recording.db, 'user-1', 'security')).toBe(true);
    expect(recording.calls).toEqual([]);
  });

  it('suppresses operational email when the customer turned it off', async () => {
    for (const prefs of [FLAT, NAMESPACED]) {
      expect(await accountAllowsPlatformEmail(db(prefs), 'user-1', 'operational')).toBe(false);
    }
  });

  it('defaults to ON when unset, matching the profile UI', async () => {
    for (const prefs of [{}, { staff: {}, customer: {} }, null]) {
      expect(await accountAllowsPlatformEmail(db(prefs), 'user-1', 'operational')).toBe(true);
    }
  });

  it('FAILS OPEN on a read error rather than silently stopping mail', async () => {
    // The opposite policy to an authorisation check, deliberately. Failing
    // closed here means a customer's email quietly stops, and silence is the
    // one failure nobody reports.
    const broken = db(null, { error: { message: 'connection reset' } });
    expect(await accountAllowsPlatformEmail(broken, 'user-1', 'operational')).toBe(true);
  });

  it('fails CLOSED for marketing on the same error', async () => {
    // Marketing is opt-in, so an unreadable preference is not consent.
    const broken = db(null, { error: { message: 'connection reset' } });
    expect(await accountAllowsMarketingEmail(broken, 'user-1')).toBe(false);
  });
});

describe('accountUserIdForGuest', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the linked account', async () => {
    const recording = makeRecordingDb((call) =>
      call.table === 'guests' ? { data: { user_id: 'user-1' } } : undefined,
    );
    expect(await accountUserIdForGuest(recording.db, 'guest-1')).toBe('user-1');
  });

  it('returns null for an unlinked guest, who has no account preference', async () => {
    const recording = makeRecordingDb((call) =>
      call.table === 'guests' ? { data: { user_id: null } } : undefined,
    );
    expect(await accountUserIdForGuest(recording.db, 'guest-1')).toBeNull();
  });
});
