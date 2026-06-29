/**
 * Helpers for venue API routes: resolve authenticated staff and venue.
 *
 * All helpers use the service-role admin client for staff/data lookups so
 * queries are never blocked by the circular RLS policy on the staff table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAuthIdentity } from '@/lib/auth/resolve-auth-identity';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { escapeLikePattern } from '@/lib/db/like-escape';
import { getStaffManagedCalendarIds, staffManagesCalendar } from '@/lib/staff-calendar-access';
import { isPlatformSuperuser, isPlatformRoleInJwt } from '@/lib/platform-auth';
import {
  fetchActiveSupportSession,
  fetchStaffRowForSupport,
  superuserDisplayNameFromUser,
} from '@/lib/support-session-core';
import { getSupportSessionCookieIdFromCookies } from '@/lib/support-session-server';

export { getStaffManagedCalendarIds, staffManagesCalendar };
export const NO_ASSIGNED_CALENDARS_ERROR =
  'No calendars are assigned to your account. Ask an admin to assign at least one calendar.';
export const OUTSIDE_ASSIGNED_CALENDARS_ERROR =
  'You can only manage calendars assigned to your account.';

/** Present when a platform superuser is acting as venue staff via an active support session. */
export interface ActiveSupportSessionContext {
  sessionId: string;
  superuserDisplayName: string;
  superuserEmail: string;
  expiresAt: string;
  reason: string;
}

export interface VenueStaff {
  id: string;
  venue_id: string;
  email: string;
  role: 'admin' | 'staff';
  /** Admin client for data queries - bypasses RLS, safe to use after auth. */
  db: SupabaseClient;
  /** Set only for superuser support sign-in-as flows. */
  support?: ActiveSupportSessionContext;
}

type StaffLookupRow = {
  id: string;
  venue_id: string;
  email?: string | null;
  user_id?: string | null;
  role: 'admin' | 'staff';
};

function resolveUniqueStaffRow(rows: StaffLookupRow[], context: string): StaffLookupRow | null {
  if (rows.length === 0) return null;
  const uniqueVenueIds = new Set(rows.map((r) => r.venue_id));
  if (uniqueVenueIds.size > 1) {
    console.error(`[${context}] Ambiguous staff membership for email (multiple venues). Refusing implicit venue selection.`, {
      venueIds: [...uniqueVenueIds],
    });
    return null;
  }
  return rows[0] ?? null;
}

interface StaffIdentity {
  id: string;
  venue_id: string;
  email: string;
  role: 'admin' | 'staff';
}

/**
 * Short-lived in-process cache for the `userId -> staff row` resolution.
 *
 * Each authenticated venue request previously cost up to two `staff` lookups
 * (by `user_id`, then an email fallthrough). For a busy dashboard that is a
 * large, repetitive share of database egress. Caching the resolution per warm
 * serverless instance collapses that to ~zero on the hot path.
 *
 * Trade-off: staff role / venue / revocation changes take up to
 * {@link STAFF_IDENTITY_TTL_MS} to take effect. Keep this short.
 */
const STAFF_IDENTITY_TTL_MS = 30_000;
const staffIdentityCache = new Map<string, { value: StaffIdentity | null; expires: number }>();

/** Drop a cached staff identity (call after mutating a user's staff membership). */
export function invalidateCachedStaffIdentity(userId: string): void {
  staffIdentityCache.delete(userId);
}

async function resolveStaffIdentityUncached(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  context: string,
): Promise<StaffIdentity | null> {
  const { data: byUserId, error: userIdErr } = await admin
    .from('staff')
    .select('id, venue_id, email, role, user_id')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (userIdErr) {
    console.error(`[${context}] staff user_id lookup failed:`, userIdErr.message, { userId });
  }

  const fromUserId = resolveUniqueStaffRow((byUserId ?? []) as StaffLookupRow[], context);
  if (fromUserId) {
    return {
      id: fromUserId.id,
      venue_id: fromUserId.venue_id,
      email: fromUserId.email ?? email ?? '',
      role: fromUserId.role,
    };
  }

  const normalised = email?.toLowerCase().trim() ?? '';
  if (!normalised) return null;

  const { data: rows, error } = await admin
    .from('staff')
    .select('id, venue_id, email, role, user_id')
    .ilike('email', escapeLikePattern(normalised))
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (error) {
    console.error(`[${context}] staff lookup failed:`, error.message, { email: normalised });
    return null;
  }

  const row = resolveUniqueStaffRow((rows ?? []) as StaffLookupRow[], context);
  if (!row) return null;

  // Lazy backfill: rows created before user_id was set at insert only resolve
  // via this fragile email match. When the match is a single unclaimed row,
  // persist the durable auth link so future resolution survives email changes.
  // Fire-and-forget — resolution must not block on it; .is('user_id', null)
  // guards against racing another request that already claimed the row.
  if (row.user_id == null && (rows ?? []).length === 1) {
    void admin
      .from('staff')
      .update({ user_id: userId })
      .eq('id', row.id)
      .is('user_id', null)
      .then(({ error: backfillErr }) => {
        if (backfillErr) {
          console.warn(`[${context}] staff user_id backfill failed:`, backfillErr.message, {
            staffId: row.id,
          });
        }
      });
  }

  return {
    id: row.id,
    venue_id: row.venue_id,
    email: row.email ?? normalised,
    role: row.role,
  };
}

async function resolveCachedStaffIdentity(
  admin: SupabaseClient,
  userId: string,
  email: string | null,
  context: string,
): Promise<StaffIdentity | null> {
  const now = Date.now();
  const cached = staffIdentityCache.get(userId);
  if (cached && cached.expires > now) return cached.value;

  const value = await resolveStaffIdentityUncached(admin, userId, email, context);
  staffIdentityCache.set(userId, { value, expires: now + STAFF_IDENTITY_TTL_MS });
  return value;
}

/**
 * Get the current user's staff record for their first venue.
 * Returns null if not authenticated or not a staff member.
 *
 * The returned object includes a `db` property (admin client) that API routes
 * should use for all subsequent data queries. This avoids the circular RLS
 * issue where staff, venue, booking, etc. policies all cross-reference staff.
 */
export async function getVenueStaff(supabase: SupabaseClient): Promise<VenueStaff | null> {
  const identity = await resolveAuthIdentity(supabase);
  if (!identity) return null;

  const admin = getSupabaseAdminClient();

  // Superuser support sign-in-as: only the rare platform-admin path resolves the
  // full user object (an Auth-server call); normal staff never hit it here.
  if (isPlatformRoleInJwt(identity.appMetadata, identity.email ?? undefined)) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && isPlatformSuperuser(user)) {
      const cookieSessionId = await getSupportSessionCookieIdFromCookies();
      if (cookieSessionId) {
        const session = await fetchActiveSupportSession(admin, cookieSessionId, user.id);
        if (session) {
          const staffRow = await fetchStaffRowForSupport(admin, session.apparent_staff_id, session.venue_id);
          if (staffRow) {
            return {
              id: staffRow.id,
              venue_id: staffRow.venue_id,
              email: staffRow.email,
              role: staffRow.role,
              db: admin,
              support: {
                sessionId: session.id,
                superuserDisplayName:
                  session.superuser_display_name?.trim() || superuserDisplayNameFromUser(user),
                superuserEmail: session.superuser_email,
                expiresAt: session.expires_at,
                reason: session.reason,
              },
            };
          }
        }
      }
    }
  }

  const staff = await resolveCachedStaffIdentity(admin, identity.id, identity.email, 'getVenueStaff');
  if (!staff) return null;

  return {
    id: staff.id,
    venue_id: staff.venue_id,
    email: staff.email || identity.email || '',
    role: staff.role,
    db: admin,
  };
}

/**
 * Resolve the authenticated user and their venue for a dashboard page.
 * Returns null venue_id if not authenticated or no staff record.
 */
export async function getDashboardStaff(
  supabase: SupabaseClient
): Promise<{
  id: string | null;
  email: string;
  venue_id: string | null;
  role: 'admin' | 'staff' | null;
  db: SupabaseClient;
  support?: ActiveSupportSessionContext;
}> {
  const admin = getSupabaseAdminClient();
  const identity = await resolveAuthIdentity(supabase);
  if (!identity) return { id: null, email: '', venue_id: null, role: null, db: admin };

  if (isPlatformRoleInJwt(identity.appMetadata, identity.email ?? undefined)) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && isPlatformSuperuser(user)) {
      const cookieSessionId = await getSupportSessionCookieIdFromCookies();
      if (cookieSessionId) {
        const session = await fetchActiveSupportSession(admin, cookieSessionId, user.id);
        if (session) {
          const staffRow = await fetchStaffRowForSupport(admin, session.apparent_staff_id, session.venue_id);
          if (staffRow) {
            return {
              id: staffRow.id,
              email: staffRow.email,
              venue_id: staffRow.venue_id,
              role: staffRow.role,
              db: admin,
              support: {
                sessionId: session.id,
                superuserDisplayName:
                  session.superuser_display_name?.trim() || superuserDisplayNameFromUser(user),
                superuserEmail: session.superuser_email,
                expiresAt: session.expires_at,
                reason: session.reason,
              },
            };
          }
        }
      }
    }
  }

  const normalised = identity.email?.toLowerCase().trim() ?? '';
  const staff = await resolveCachedStaffIdentity(admin, identity.id, identity.email, 'getDashboardStaff');
  if (!staff) {
    return { id: null, email: normalised, venue_id: null, role: null, db: admin };
  }

  return {
    id: staff.id,
    email: normalised,
    venue_id: staff.venue_id,
    role: staff.role,
    db: admin,
  };
}

/**
 * Resolve a single venue_id for an authenticated user (middleware billing gate, etc.).
 * Uses the service-role client so lookups are not blocked by staff RLS recursion.
 */
export async function resolveStaffVenueIdForAuthenticatedUser(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null | undefined,
): Promise<string | null> {
  const { data: byUserId, error: userIdErr } = await admin
    .from('staff')
    .select('venue_id')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (userIdErr) {
    console.error('[resolveStaffVenueIdForAuthenticatedUser] user_id lookup failed:', userIdErr.message, {
      userId,
    });
  }

  const fromUserId = resolveUniqueStaffRow(
    (byUserId ?? []).map((r) => ({ ...r, id: '', role: 'staff' as const })),
    'resolveStaffVenueIdForAuthenticatedUser',
  );
  if (fromUserId) return fromUserId.venue_id;

  const normalised = userEmail?.trim().toLowerCase() ?? '';
  if (!normalised) return null;

  const { data: byEmail, error: emailErr } = await admin
    .from('staff')
    .select('venue_id')
    .ilike('email', escapeLikePattern(normalised))
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (emailErr) {
    console.error('[resolveStaffVenueIdForAuthenticatedUser] email lookup failed:', emailErr.message, {
      email: normalised,
    });
    return null;
  }

  const fromEmail = resolveUniqueStaffRow(
    (byEmail ?? []).map((r) => ({ ...r, id: '', role: 'staff' as const })),
    'resolveStaffVenueIdForAuthenticatedUser',
  );
  return fromEmail?.venue_id ?? null;
}

/** True when the signed-in user has at least one active staff row (any venue). */
export async function authenticatedUserHasStaffMembership(
  admin: SupabaseClient,
  userId: string,
  userEmail: string | null | undefined,
): Promise<boolean> {
  const { count: byUserId } = await admin
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('revoked_at', null);

  if ((byUserId ?? 0) > 0) return true;

  const normalised = userEmail?.trim().toLowerCase() ?? '';
  if (!normalised) return false;

  const { count: byEmail } = await admin
    .from('staff')
    .select('id', { count: 'exact', head: true })
    .ilike('email', escapeLikePattern(normalised))
    .is('revoked_at', null);

  return (byEmail ?? 0) > 0;
}

/**
 * Require admin role. Use after getVenueStaff; narrows to venue admin when true.
 */
export function requireAdmin(staff: VenueStaff | null): staff is VenueStaff & { role: 'admin' } {
  return staff !== null && staff.role === 'admin';
}

export async function requireManagedCalendarIds(
  admin: SupabaseClient,
  venueId: string,
  staff: Pick<VenueStaff, 'id' | 'role'>,
): Promise<{ ok: true; managedCalendarIds: string[] } | { ok: false; error: string }> {
  if (staff.role === 'admin') {
    return { ok: true, managedCalendarIds: [] };
  }

  const managedCalendarIds = await getStaffManagedCalendarIds(admin, venueId, staff.id);
  if (managedCalendarIds.length === 0) {
    return { ok: false, error: NO_ASSIGNED_CALENDARS_ERROR };
  }

  return { ok: true, managedCalendarIds };
}

export async function requireManagedCalendarAccess(
  admin: SupabaseClient,
  venueId: string,
  staff: Pick<VenueStaff, 'id' | 'role'>,
  calendarId: string | null | undefined,
  errorMessage = OUTSIDE_ASSIGNED_CALENDARS_ERROR,
): Promise<{ ok: true; managedCalendarIds: string[] } | { ok: false; error: string }> {
  if (!calendarId) {
    return { ok: false, error: errorMessage };
  }

  const scope = await requireManagedCalendarIds(admin, venueId, staff);
  if (!scope.ok) {
    return scope;
  }
  if (staff.role === 'admin' || scope.managedCalendarIds.includes(calendarId)) {
    return scope;
  }

  return { ok: false, error: errorMessage };
}

export function filterIdsToManagedCalendars(
  managedCalendarIds: string[],
  requestedCalendarIds: string[],
): { allowedIds: string[]; rejectedIds: string[] } {
  const managedSet = new Set(managedCalendarIds);
  const allowedIds: string[] = [];
  const rejectedIds: string[] = [];

  for (const calendarId of requestedCalendarIds) {
    if (managedSet.has(calendarId)) {
      allowedIds.push(calendarId);
    } else {
      rejectedIds.push(calendarId);
    }
  }

  return { allowedIds, rejectedIds };
}

/**
 * First bookable calendar linked to this staff (legacy `practitioners` or unified junction).
 * Prefer `getStaffManagedCalendarIds` when multiple calendars are possible.
 */
export async function getLinkedPractitionerId(
  admin: SupabaseClient,
  venueId: string,
  staffId: string,
): Promise<string | null> {
  const { data: venue } = await admin.from('venues').select('booking_model').eq('id', venueId).maybeSingle();
  const bookingModel = (venue as { booking_model?: string } | null)?.booking_model;

  if (bookingModel === 'unified_scheduling') {
    const ids = await getStaffManagedCalendarIds(admin, venueId, staffId);
    return ids[0] ?? null;
  }

  const { data, error } = await admin
    .from('practitioners')
    .select('id')
    .eq('venue_id', venueId)
    .eq('staff_id', staffId)
    .maybeSingle();

  if (error) {
    console.error('[getLinkedPractitionerId] practitioners lookup failed:', error.message, { venueId, staffId });
    return null;
  }

  return data?.id ?? null;
}
