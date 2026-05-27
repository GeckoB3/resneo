/**
 * Helpers for venue API routes: resolve authenticated staff and venue.
 *
 * All helpers use the service-role admin client for staff/data lookups so
 * queries are never blocked by the circular RLS policy on the staff table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { getStaffManagedCalendarIds, staffManagesCalendar } from '@/lib/staff-calendar-access';
import { isPlatformSuperuser } from '@/lib/platform-auth';
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

/**
 * Get the current user's staff record for their first venue.
 * Returns null if not authenticated or not a staff member.
 *
 * The returned object includes a `db` property (admin client) that API routes
 * should use for all subsequent data queries. This avoids the circular RLS
 * issue where staff, venue, booking, etc. policies all cross-reference staff.
 */
export async function getVenueStaff(supabase: SupabaseClient): Promise<VenueStaff | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const admin = getSupabaseAdminClient();

  if (isPlatformSuperuser(user)) {
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

  const { data: byUserId, error: userIdErr } = await admin
    .from('staff')
    .select('id, venue_id, email, role, user_id')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (userIdErr) {
    console.error('[getVenueStaff] staff user_id lookup failed:', userIdErr.message, { userId: user.id });
  }

  const fromUserId = resolveUniqueStaffRow((byUserId ?? []) as StaffLookupRow[], 'getVenueStaff');
  if (fromUserId) {
    return {
      id: fromUserId.id,
      venue_id: fromUserId.venue_id,
      email: fromUserId.email ?? user.email ?? '',
      role: fromUserId.role as 'admin' | 'staff',
      db: admin,
    };
  }

  const normalised = user.email?.toLowerCase().trim() ?? '';
  if (!normalised) return null;

  const { data: rows, error } = await admin
    .from('staff')
    .select('id, venue_id, email, role, user_id')
    .ilike('email', normalised)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[getVenueStaff] staff lookup failed:', error.message, { email: normalised });
    return null;
  }

  const row = resolveUniqueStaffRow((rows ?? []) as StaffLookupRow[], 'getVenueStaff');
  if (!row) return null;

  return {
    id: row.id,
    venue_id: row.venue_id,
    email: row.email ?? normalised,
    role: row.role as 'admin' | 'staff',
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { id: null, email: '', venue_id: null, role: null, db: admin };

  if (isPlatformSuperuser(user)) {
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

  const { data: byUserId, error: uidErr } = await admin
    .from('staff')
    .select('id, venue_id, role, user_id')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (uidErr) {
    console.error('[getDashboardStaff] staff user_id lookup failed:', uidErr.message, { userId: user.id });
  }

  const fromUserId = resolveUniqueStaffRow((byUserId ?? []) as StaffLookupRow[], 'getDashboardStaff');
  if (fromUserId) {
    return {
      id: fromUserId.id,
      email: user.email?.toLowerCase().trim() ?? '',
      venue_id: fromUserId.venue_id,
      role: fromUserId.role as 'admin' | 'staff',
      db: admin,
    };
  }

  const normalised = user.email?.toLowerCase().trim() ?? '';
  if (!normalised) {
    return { id: null, email: '', venue_id: null, role: null, db: admin };
  }

  const { data: rows, error } = await admin
    .from('staff')
    .select('id, venue_id, role, user_id')
    .ilike('email', normalised)
    .is('revoked_at', null)
    .order('id', { ascending: true })
    .limit(10);

  if (error) {
    console.error('[getDashboardStaff] staff lookup failed:', error.message, { email: normalised });
    return { id: null, email: normalised, venue_id: null, role: null, db: admin };
  }

  const row = resolveUniqueStaffRow((rows ?? []) as StaffLookupRow[], 'getDashboardStaff');
  return {
    id: row?.id ?? null,
    email: normalised,
    venue_id: row?.venue_id ?? null,
    role: (row?.role as 'admin' | 'staff') ?? null,
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
    .ilike('email', normalised)
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
    .ilike('email', normalised)
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
