/**
 * Whether a venue may act on a staff member's login as if it were the venue's own,
 * for example by setting its password.
 *
 * A login is one person's identity across the whole platform. The same auth user can
 * hold customer bookings at any venue (guests.user_id, created silently at booking
 * time), saved cards (venue_customer_stripe), a team role somewhere else, or platform
 * access (superusers, salespeople). Setting its password hands all of that to whoever
 * chose the password. So the venue only counts as the login's manager when the login
 * is bound to this venue's staff row and has no footprint anywhere else.
 *
 * Nothing records who created a login (user_metadata.venue_id is merged into existing
 * logins by the invite flow, so it proves nothing), which is why this is decided by
 * what the login holds rather than where it came from. A query failure is thrown,
 * never read as "nothing found".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { staffMembershipElsewhere } from '@/lib/venue-auth';

export type StaffLoginOwnership =
  | { ok: true; userId: string }
  /** The row carries no user_id: an invite nobody has accepted, so no login is bound to it. */
  | { ok: false; reason: 'unclaimed' }
  /** The row has been revoked, so the venue no longer manages anyone through it. */
  | { ok: false; reason: 'revoked' }
  /** The login is also used outside this venue's team. */
  | { ok: false; reason: 'used_elsewhere' };

export interface StaffRowForOwnership {
  email: string;
  user_id: string | null;
  revoked_at: string | null;
}

/** Tables whose rows tie a login to something beyond one venue's team. */
const FOOTPRINT_TABLES = ['guests', 'venue_customer_stripe', 'platform_superusers', 'salespeople'] as const;

export async function staffLoginOwnedByVenue(
  admin: SupabaseClient,
  venueId: string,
  row: StaffRowForOwnership,
): Promise<StaffLoginOwnership> {
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  const userId = row.user_id;
  if (!userId) return { ok: false, reason: 'unclaimed' };

  const [elsewhere, ...footprints] = await Promise.all([
    staffMembershipElsewhere(admin, venueId, row.email, userId),
    ...FOOTPRINT_TABLES.map((table) =>
      admin.from(table).select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
    ),
  ]);

  footprints.forEach((res, i) => {
    if (res.error) {
      throw new Error(`login footprint lookup on ${FOOTPRINT_TABLES[i]} failed: ${res.error.message}`);
    }
  });

  if (elsewhere || footprints.some((res) => (res.count ?? 0) > 0)) {
    return { ok: false, reason: 'used_elsewhere' };
  }
  return { ok: true, userId };
}
