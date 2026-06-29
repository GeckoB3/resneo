import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePostLoginDestination } from './post-login-destination';

type LoginPref = 'account' | 'dashboard' | 'ask' | null;

interface VenueBilling {
  plan_status?: string | null;
  billing_access_source?: string | null;
  subscription_current_period_end?: string | null;
  pricing_tier?: string | null;
}

/**
 * Chainable Supabase admin stub that resolves per-table results for the exact query
 * shapes resolvePostLoginDestination issues:
 *  - user_profiles → .select().eq().maybeSingle()
 *  - staff         → .select('id, venue_id').eq|ilike().is().limit()
 *  - guests        → .select('id', { count, head }).eq|ilike()   (awaited directly)
 *  - venues        → .select().in('id', ids)
 */
function makeAdmin(opts: {
  pref?: LoginPref;
  /** venue_ids returned by the staff lookups (one staff row per id). */
  staffVenueIds?: string[];
  guestCount?: number;
  /** Billing fields keyed by venue id; venues missing here resolve with empty billing. */
  venues?: Record<string, VenueBilling>;
}): SupabaseClient {
  const pref = opts.pref ?? null;
  const staffVenueIds = opts.staffVenueIds ?? [];
  const guestCount = opts.guestCount ?? 0;
  const venues = opts.venues ?? {};

  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      ilike: () => chain,
      is: () => chain,
      order: () => chain,
      limit: async () =>
        table === 'staff'
          ? { data: staffVenueIds.map((vid, i) => ({ id: `staff-${i}`, venue_id: vid })), error: null }
          : { data: [], error: null },
      in: async (_col: string, ids: string[]) =>
        table === 'venues'
          ? { data: ids.map((id) => ({ id, ...(venues[id] ?? {}) })), error: null }
          : { data: [], error: null },
      maybeSingle: async () =>
        table === 'user_profiles'
          ? { data: { default_login_destination: pref }, error: null }
          : { data: null, error: null },
      // guests count queries await the builder directly.
      then: (resolve: (value: unknown) => void) =>
        resolve(table === 'guests' ? { count: guestCount, data: null, error: null } : { data: null, error: null }),
    };
    return chain;
  };

  return { from } as unknown as SupabaseClient;
}

const base = {
  userId: 'user-1',
  userEmail: 'owner@example.com',
  rawNext: null,
  isPlatformSuperuser: false,
  needsSetPassword: false,
};

const ACTIVE: VenueBilling = { plan_status: 'active', pricing_tier: 'appointments' };
const EXPIRED: VenueBilling = {
  plan_status: 'cancelled',
  pricing_tier: 'appointments',
  subscription_current_period_end: '2000-01-01T00:00:00.000Z',
};

describe('resolvePostLoginDestination — active subscription routing', () => {
  it('sends an active subscriber (not a customer) to the venue surface even with a stale account preference', async () => {
    const admin = makeAdmin({ pref: 'account', staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/dashboard');
  });

  it('sends an active subscriber (not a customer) to the venue surface when no preference is set', async () => {
    const admin = makeAdmin({ pref: null, staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/dashboard');
  });

  it('offers the chooser to a customer who is also an active subscriber (no explicit preference)', async () => {
    const admin = makeAdmin({ pref: 'ask', staffVenueIds: ['v1'], guestCount: 1, venues: { v1: ACTIVE } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/auth/choose-destination');
  });

  it('honours an explicit account preference for a customer who is also an active subscriber', async () => {
    const admin = makeAdmin({ pref: 'account', staffVenueIds: ['v1'], guestCount: 1, venues: { v1: ACTIVE } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/account');
  });

  it('honours an explicit dashboard preference for a customer who is also an active subscriber', async () => {
    const admin = makeAdmin({ pref: 'dashboard', staffVenueIds: ['v1'], guestCount: 1, venues: { v1: ACTIVE } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/dashboard');
  });

  it('treats a user with at least one active venue as an active subscriber', async () => {
    const admin = makeAdmin({
      staffVenueIds: ['v1', 'v2'],
      venues: { v1: EXPIRED, v2: ACTIVE },
    });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/dashboard');
  });
});

describe('resolvePostLoginDestination — no active subscription (existing behaviour preserved)', () => {
  it('keeps an expired-subscription staff user on the dashboard (to resubscribe)', async () => {
    const admin = makeAdmin({ pref: null, staffVenueIds: ['v1'], venues: { v1: EXPIRED } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/dashboard');
  });

  it('routes a customer-only user to the account dashboard', async () => {
    const admin = makeAdmin({ guestCount: 1 });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/account');
  });

  it('routes a dual-role user with no subscription through the chooser', async () => {
    const admin = makeAdmin({ pref: 'ask', staffVenueIds: ['v1'], guestCount: 1, venues: { v1: EXPIRED } });
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/auth/choose-destination');
  });

  it('falls back to the account dashboard for a user with no venue and no bookings', async () => {
    const admin = makeAdmin({});
    await expect(resolvePostLoginDestination({ ...base, admin })).resolves.toBe('/account');
  });
});

describe('resolvePostLoginDestination — signup resume (pendingSignup)', () => {
  it('resumes a payment-ready, venue-less user to /signup/payment', async () => {
    const admin = makeAdmin({});
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: 'appointments', businessType: null },
      }),
    ).resolves.toBe('/signup/payment');
  });

  it('resumes to /signup/payment even when the user already has a guest account', async () => {
    const admin = makeAdmin({ guestCount: 1 });
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: 'plus', businessType: null },
      }),
    ).resolves.toBe('/signup/payment');
  });

  it('sends a partial selection (restaurant, no business type) to /signup/business-type', async () => {
    const admin = makeAdmin({ guestCount: 1 });
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: 'restaurant', businessType: null },
      }),
    ).resolves.toBe('/signup/business-type');
  });

  it('does NOT resume a user who already finished (active subscription wins)', async () => {
    const admin = makeAdmin({ staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: 'appointments', businessType: null },
      }),
    ).resolves.toBe('/dashboard');
  });

  it('does NOT resume a user who already has a venue (no stale yank into signup)', async () => {
    const admin = makeAdmin({ staffVenueIds: ['v1'], venues: { v1: EXPIRED } });
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: 'appointments', businessType: null },
      }),
    ).resolves.toBe('/dashboard');
  });

  it('ignores junk pending metadata and falls back to /account', async () => {
    const admin = makeAdmin({});
    await expect(
      resolvePostLoginDestination({
        ...base,
        admin,
        pendingSignup: { plan: null, businessType: null },
      }),
    ).resolves.toBe('/account');
  });

  it('honours an explicit /signup resume next for a venue-less user', async () => {
    const admin = makeAdmin({ guestCount: 1 });
    await expect(
      resolvePostLoginDestination({ ...base, admin, rawNext: '/signup/payment' }),
    ).resolves.toBe('/signup/payment');
  });

  it('does NOT honour an explicit /signup next once the user has a venue', async () => {
    const admin = makeAdmin({ staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(
      resolvePostLoginDestination({ ...base, admin, rawNext: '/signup/payment' }),
    ).resolves.toBe('/dashboard');
  });
});

describe('resolvePostLoginDestination — explicit intent and platform roles', () => {
  it('honours an explicit ?next= even for an active subscriber', async () => {
    const admin = makeAdmin({ staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(
      resolvePostLoginDestination({ ...base, admin, rawNext: '/account' }),
    ).resolves.toBe('/account');
  });

  it('always routes platform superusers to /super', async () => {
    const admin = makeAdmin({ staffVenueIds: ['v1'], venues: { v1: ACTIVE } });
    await expect(
      resolvePostLoginDestination({ ...base, admin, isPlatformSuperuser: true }),
    ).resolves.toBe('/super');
  });
});
