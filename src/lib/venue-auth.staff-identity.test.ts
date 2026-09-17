/**
 * Who the email fallback in `resolveStaffIdentityUncached` is allowed to match.
 *
 * The fallback exists because `POST /api/venue/staff/invite` inserts a staff
 * row with no `user_id` (the invitee has no auth user yet), so an email match
 * is the bootstrap for every invited member's first sign-in. It cannot be
 * deleted.
 *
 * It CAN be bounded. Reaching the fallback means the `user_id` lookup found
 * nothing for this caller, so any matched row that already carries a `user_id`
 * belongs to somebody else, and matching it hands the caller another person's
 * staff identity. `staff.email` goes stale when an auth email changes
 * elsewhere, which is what made that reachable rather than theoretical.
 *
 * Asserted against an in-memory `staff` table rather than a query-shape
 * snapshot, so these say what the resolver DOES, not how it phrases itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/auth/resolve-auth-identity', () => ({
  resolveAuthIdentity: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(),
}));
vi.mock('@/lib/platform-auth', () => ({
  isPlatformRoleInJwt: () => false,
  isPlatformSuperuser: () => false,
}));

import { resolveAuthIdentity } from '@/lib/auth/resolve-auth-identity';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getDashboardStaff, getVenueStaff, staffMembershipElsewhere } from './venue-auth';

const mockIdentity = vi.mocked(resolveAuthIdentity);
const mockAdmin = vi.mocked(getSupabaseAdminClient);

interface StaffRow {
  id: string;
  venue_id: string;
  email: string | null;
  role: 'admin' | 'staff';
  user_id: string | null;
  revoked_at: string | null;
}

/** Records the fire-and-forget backfill so a test can assert it still happens. */
const backfills: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];

/**
 * A `staff` table that actually applies the filters it is given.
 *
 * `ilike` is simulated as a case-insensitive EXACT match, which is faithful
 * here: every caller wraps the value in `escapeLikePattern`, so no wildcard
 * ever reaches the database.
 */
function adminOver(rows: StaffRow[]): SupabaseClient {
  const from = () => {
    let working = [...rows];
    let patch: Record<string, unknown> | null = null;
    const filters: Array<[string, unknown]> = [];

    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      update: (values: Record<string, unknown>) => {
        patch = values;
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        working = working.filter((r) => (r as unknown as Record<string, unknown>)[col] === val);
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filters.push([col, val]);
        working = working.filter((r) => (r as unknown as Record<string, unknown>)[col] !== val);
        return builder;
      },
      is: (col: string, val: null) => {
        filters.push([col, val]);
        working = working.filter((r) => (r as unknown as Record<string, unknown>)[col] === null);
        return builder;
      },
      ilike: (col: string, pattern: string) => {
        const want = pattern.toLowerCase();
        working = working.filter(
          (r) => String((r as unknown as Record<string, unknown>)[col] ?? '').toLowerCase() === want,
        );
        return builder;
      },
      then: (resolve: (v: { data: StaffRow[]; error: null; count: number }) => unknown) => {
        if (patch) {
          backfills.push({ patch, filters });
          // Mirror the write, so a later read in the same test sees the claim.
          working.forEach((r) => Object.assign(r, patch));
        }
        return Promise.resolve(resolve({ data: working, error: null, count: working.length }));
      },
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const VENUE = 'venue-1';
let seq = 0;
/** The identity cache is module state keyed by user id, so every test needs a fresh one. */
function freshUserId(): string {
  seq += 1;
  return `user-${seq}-${process.pid}`;
}

function signedInAs(userId: string, email: string) {
  mockIdentity.mockResolvedValue({
    id: userId,
    email,
    appMetadata: {},
  } as unknown as Awaited<ReturnType<typeof resolveAuthIdentity>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  backfills.length = 0;
});

describe('the staff email fallback', () => {
  it('still signs in an invited member whose row has no user_id', async () => {
    /*
      The bootstrap case, and the reason the fallback cannot simply be deleted.
      This test is also the vacuity guard for the one below: if this stopped
      passing, "does not match a claimed row" would be true for the boring
      reason that nothing matches at all.
    */
    const userId = freshUserId();
    signedInAs(userId, 'invited@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-invited',
          venue_id: VENUE,
          email: 'invited@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: null,
        },
      ]),
    );

    const staff = await getVenueStaff({} as SupabaseClient);

    expect(staff?.id).toBe('staff-invited');
    expect(staff?.venue_id).toBe(VENUE);
  });

  it('claims the row it matched, so the next sign-in resolves by user_id', async () => {
    // The lazy backfill is the ONLY writer of user_id for invited rows. Without
    // it the fragile email match would be load-bearing forever.
    const userId = freshUserId();
    signedInAs(userId, 'invited2@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-invited-2',
          venue_id: VENUE,
          email: 'invited2@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: null,
        },
      ]),
    );

    await getVenueStaff({} as SupabaseClient);

    expect(backfills).toHaveLength(1);
    expect(backfills[0].patch).toEqual({ user_id: userId });
    // The `.is('user_id', null)` guard on the WRITE is what stops two
    // concurrent requests both claiming the row.
    expect(backfills[0].filters).toContainEqual(['user_id', null]);
  });

  it('does NOT match a row already claimed by somebody else', async () => {
    /*
      The fix. `staff.email` is not kept in step when an auth email changes
      elsewhere, so a stale row can carry an address its owner no longer uses.
      Before `.is('user_id', null)`, a NEW user signing up on that address
      matched it by email and inherited that venue's dashboard, with the
      original owner's staff id and role.
    */
    const userId = freshUserId();
    signedInAs(userId, 'stale@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-owned-by-someone-else',
          venue_id: VENUE,
          email: 'stale@example.test',
          role: 'admin',
          user_id: 'a-different-user',
          revoked_at: null,
        },
      ]),
    );

    const staff = await getVenueStaff({} as SupabaseClient);

    expect(staff).toBeNull();
    expect(backfills, 'a claimed row must never be re-claimed').toEqual([]);
  });

  it('still resolves the owner of that same row by user_id', async () => {
    // The claimed row is not invisible, only unreachable BY EMAIL. Its actual
    // owner keeps resolving through the first lookup, which is the whole point
    // of preferring user_id over the email match.
    const userId = freshUserId();
    signedInAs(userId, 'stale@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-owned',
          venue_id: VENUE,
          email: 'stale@example.test',
          role: 'admin',
          user_id: userId,
          revoked_at: null,
        },
      ]),
    );

    const staff = await getVenueStaff({} as SupabaseClient);

    expect(staff?.id).toBe('staff-owned');
    expect(staff?.role).toBe('admin');
  });

  it('ignores a revoked row, claimed or not', async () => {
    // Revocation has to win over both paths, or removing someone from a venue
    // would not actually remove them.
    const userId = freshUserId();
    signedInAs(userId, 'revoked@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-revoked',
          venue_id: VENUE,
          email: 'revoked@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: '2026-08-01T00:00:00Z',
        },
      ]),
    );

    expect(await getVenueStaff({} as SupabaseClient)).toBeNull();
  });

  it("no longer lets a stranger's row at another venue make a real match ambiguous", async () => {
    /*
      A side effect worth locking in. The ambiguity check refuses to pick a
      venue when the matched rows span more than one, which is right. But it
      used to count rows belonging to OTHER people: an invitee with one genuine
      unclaimed row could be refused because an unrelated claimed row at a
      different venue carried the same stale address. Filtering in SQL removes
      those before the check ever sees them.
    */
    const userId = freshUserId();
    signedInAs(userId, 'shared@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-mine',
          venue_id: VENUE,
          email: 'shared@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: null,
        },
        {
          id: 'staff-theirs',
          venue_id: 'venue-2',
          email: 'shared@example.test',
          role: 'admin',
          user_id: 'a-different-user',
          revoked_at: null,
        },
      ]),
    );

    const staff = await getVenueStaff({} as SupabaseClient);

    expect(staff?.id).toBe('staff-mine');
    expect(staff?.venue_id).toBe(VENUE);
  });

  it('still refuses when two UNCLAIMED rows span different venues', async () => {
    // The ambiguity guard itself must survive the change: picking a venue
    // implicitly would silently drop someone into the wrong dashboard.
    const userId = freshUserId();
    signedInAs(userId, 'both@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        {
          id: 'staff-a',
          venue_id: VENUE,
          email: 'both@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: null,
        },
        {
          id: 'staff-b',
          venue_id: 'venue-2',
          email: 'both@example.test',
          role: 'staff',
          user_id: null,
          revoked_at: null,
        },
      ]),
    );

    expect(await getVenueStaff({} as SupabaseClient)).toBeNull();
  });
});

describe('a login that works at more than one venue (D38)', () => {
  function row(id: string, venueId: string, email: string, userId: string | null): StaffRow {
    return { id, venue_id: venueId, email, role: 'staff', user_id: userId, revoked_at: null };
  }

  it('is told apart from "not staff" when both claimed rows carry its user_id', async () => {
    /*
      Both cases leave venue_id null, and the dashboard used to treat them the
      same: straight into the signup flow, with no message. The flag is what
      lets the layout send this person to an explanation instead.
    */
    const userId = freshUserId();
    signedInAs(userId, 'two@example.test');
    mockAdmin.mockReturnValue(
      adminOver([row('s-a', VENUE, 'two@example.test', userId), row('s-b', 'venue-2', 'two@example.test', userId)]),
    );

    const dashboard = await getDashboardStaff({} as SupabaseClient);

    expect(dashboard.venue_id).toBeNull();
    expect(dashboard.multipleVenues).toBe(true);
    expect(await getVenueStaff({} as SupabaseClient), 'API routes still refuse to pick a venue').toBeNull();
  });

  it('is flagged too when the two rows are unclaimed invites', async () => {
    const userId = freshUserId();
    signedInAs(userId, 'invited-twice@example.test');
    mockAdmin.mockReturnValue(
      adminOver([
        row('s-a', VENUE, 'invited-twice@example.test', null),
        row('s-b', 'venue-2', 'invited-twice@example.test', null),
      ]),
    );

    expect((await getDashboardStaff({} as SupabaseClient)).multipleVenues).toBe(true);
  });

  it('is not flagged for someone who is simply not staff, or staff at one venue', async () => {
    const outsider = freshUserId();
    signedInAs(outsider, 'nobody@example.test');
    mockAdmin.mockReturnValue(adminOver([]));
    expect((await getDashboardStaff({} as SupabaseClient)).multipleVenues).toBeUndefined();

    const member = freshUserId();
    signedInAs(member, 'one@example.test');
    mockAdmin.mockReturnValue(adminOver([row('s-one', VENUE, 'one@example.test', member)]));
    const dashboard = await getDashboardStaff({} as SupabaseClient);
    expect(dashboard.venue_id).toBe(VENUE);
    expect(dashboard.multipleVenues).toBeUndefined();
  });
});

describe('staffMembershipElsewhere', () => {
  const at = (venueId: string, email: string, userId: string | null, revokedAt: string | null = null): StaffRow => ({
    id: `s-${venueId}-${email}`,
    venue_id: venueId,
    email,
    role: 'staff',
    user_id: userId,
    revoked_at: revokedAt,
  });

  it('finds an unrevoked row for the email at another venue, whatever its case', async () => {
    const admin = adminOver([at('venue-2', 'Person@Example.test', null)]);
    expect(await staffMembershipElsewhere(admin, VENUE, ' person@example.TEST ')).toBe(true);
  });

  it('ignores a row at the inviting venue itself and a revoked row elsewhere', async () => {
    const admin = adminOver([
      at(VENUE, 'person@example.test', null),
      at('venue-2', 'person@example.test', null, '2026-08-01T00:00:00Z'),
    ]);
    expect(await staffMembershipElsewhere(admin, VENUE, 'person@example.test')).toBe(false);
  });

  it('finds a claimed row elsewhere by user id when its stored email has gone stale', async () => {
    const admin = adminOver([at('venue-2', 'old-address@example.test', 'user-known')]);
    expect(await staffMembershipElsewhere(admin, VENUE, 'new-address@example.test')).toBe(false);
    expect(await staffMembershipElsewhere(admin, VENUE, 'new-address@example.test', 'user-known')).toBe(true);
  });
});
