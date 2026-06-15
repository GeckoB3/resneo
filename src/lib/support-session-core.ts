import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  SUPPORT_SESSION_DURATION_MS,
  type SupportSessionRow,
} from '@/lib/support-session-constants';

export { SUPPORT_SESSION_COOKIE_NAME, SUPPORT_SESSION_DURATION_MS } from '@/lib/support-session-constants';
export type { SupportSessionRow } from '@/lib/support-session-constants';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseSupportSessionCookieValue(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!UUID_RE.test(trimmed)) return null;
  return trimmed;
}

export function superuserDisplayNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const meta = user.user_metadata ?? {};
  const full =
    typeof meta.full_name === 'string' ? meta.full_name.trim()
    : typeof meta.name === 'string' ? meta.name.trim()
    : '';
  if (full) return full;
  const email = (user.email ?? '').trim();
  if (email) return email.split('@')[0] ?? email;
  return 'ResNeo support';
}

export async function fetchActiveSupportSession(
  admin: SupabaseClient,
  sessionId: string,
  superuserId: string,
): Promise<SupportSessionRow | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('support_sessions')
    .select(
      'id, superuser_id, superuser_email, superuser_display_name, venue_id, apparent_staff_id, reason, started_at, expires_at, ended_at',
    )
    .eq('id', sessionId)
    .eq('superuser_id', superuserId)
    .is('ended_at', null)
    .gt('expires_at', nowIso)
    .maybeSingle();

  if (error) {
    console.error('[support-session] fetchActiveSupportSession failed:', error.message, { sessionId });
    return null;
  }
  return data as SupportSessionRow | null;
}

export async function fetchStaffRowForSupport(
  admin: SupabaseClient,
  staffId: string,
  expectedVenueId: string,
): Promise<{ id: string; venue_id: string; email: string; role: 'admin' | 'staff' } | null> {
  const { data, error } = await admin
    .from('staff')
    .select('id, venue_id, email, role')
    .eq('id', staffId)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[support-session] staff fetch failed:', error.message, { staffId });
    return null;
  }
  const row = data as { id: string; venue_id: string; email: string | null; role: string };
  if (row.venue_id !== expectedVenueId) {
    console.error('[support-session] staff venue mismatch', { staffId, expectedVenueId, actual: row.venue_id });
    return null;
  }
  const role = row.role === 'admin' ? 'admin' : 'staff';
  const email = (row.email ?? '').toLowerCase().trim();
  return { id: row.id, venue_id: row.venue_id, email: email || 'unknown@venue.local', role };
}

export async function insertSupportAuditEvent(params: {
  admin: SupabaseClient;
  supportSessionId: string | null;
  venueId: string;
  apparentStaffId: string | null;
  superuserId: string;
  superuserEmail?: string | null;
  eventType: string;
  httpMethod?: string | null;
  httpPath?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  const { error } = await params.admin.from('support_audit_events').insert({
    support_session_id: params.supportSessionId,
    venue_id: params.venueId,
    apparent_staff_id: params.apparentStaffId,
    superuser_id: params.superuserId,
    superuser_email: params.superuserEmail?.trim() || null,
    event_type: params.eventType,
    http_method: params.httpMethod ?? null,
    http_path: params.httpPath ?? null,
    summary: params.summary,
    metadata: params.metadata ?? null,
  });
  if (error) {
    console.error('[support-session] insertSupportAuditEvent failed:', error.message, {
      eventType: params.eventType,
      venueId: params.venueId,
    });
  }
}

/** Human-readable mutation line for audit (pathname-based). */
export function describeVenueMutationPath(pathname: string): string {
  const p = pathname.toLowerCase();
  if (p.includes('/opening-hours')) return 'updated opening hours';
  if (p.includes('/venue-opening-exceptions')) return 'updated opening exceptions';
  if (p.includes('/booking-rules')) return 'updated booking rules';
  if (p.includes('/booking-restriction')) return 'updated booking restrictions';
  if (p.includes('/communication-templates')) return 'updated communication templates';
  if (p.includes('/communication-settings')) return 'updated communication settings';
  if (p.includes('/communication-policies')) return 'updated communication policies';
  if (p.includes('/notification-settings')) return 'updated notification settings';
  if (p.includes('/availability-config')) return 'updated availability configuration';
  if (p.includes('/availability')) return 'updated availability';
  if (p.includes('/appointments-plan')) return 'updated appointments plan';
  if (p.includes('/staff')) return 'updated staff or access settings';
  if (p.includes('/bookings')) return 'updated bookings';
  if (p.includes('/guests')) return 'updated guest records';
  if (p.includes('/stripe-connect')) return 'updated Stripe Connect settings';
  if (p.includes('/change-plan') || p.includes('/light-plan')) return 'updated subscription or billing';
  if (p.includes('/tables')) return 'updated table management';
  if (p.includes('/floor-plans')) return 'updated floor plans';
  if (p.includes('/onboarding')) return 'updated onboarding';
  if (p.includes('/classes') || p.includes('/class-')) return 'updated classes';
  if (p.includes('/services')) return 'updated services';
  if (p.includes('/resources')) return 'updated resources';
  if (p.includes('/experience-events')) return 'updated events';
  if (p.includes('/export')) return 'ran an export';
  if (p.includes('/support')) return 'used support contact';
  return `performed an action (${pathname})`;
}

export async function listVenueAdminEmails(admin: SupabaseClient, venueId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('staff')
    .select('email')
    .eq('venue_id', venueId)
    .eq('role', 'admin');

  if (error) {
    console.error('[support-session] listVenueAdminEmails failed:', error.message, { venueId });
    return [];
  }
  const emails = (data ?? [])
    .map((r) => (r as { email?: string | null }).email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e));
  return [...new Set(emails)];
}

export async function getStaffDisplayName(admin: SupabaseClient, staffId: string): Promise<string | null> {
  const { data, error } = await admin.from('staff').select('name, email').eq('id', staffId).maybeSingle();
  if (error || !data) return null;
  const row = data as { name?: string | null; email?: string | null };
  const n = row.name?.trim();
  if (n) return n;
  return row.email?.trim() ?? null;
}

export async function startSupportSession(params: {
  superuser: { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
  staffId: string;
  reason: string;
}): Promise<{ ok: true; session: SupportSessionRow } | { ok: false; error: string; status: number }> {
  const admin = getSupabaseAdminClient();
  const reason = params.reason.trim();
  if (reason.length < 3) {
    return { ok: false, error: 'Reason must be at least 3 characters.', status: 400 };
  }
  if (reason.length > 2000) {
    return { ok: false, error: 'Reason is too long (max 2000 characters).', status: 400 };
  }

  const { data: staffRow, error: staffErr } = await admin
    .from('staff')
    .select('id, venue_id, email, role')
    .eq('id', params.staffId)
    .maybeSingle();

  if (staffErr || !staffRow) {
    return { ok: false, error: 'Staff member not found.', status: 404 };
  }

  const venueId = (staffRow as { venue_id: string }).venue_id;
  const superEmail = (params.superuser.email ?? '').toLowerCase().trim();
  const displayName = superuserDisplayNameFromUser(params.superuser);
  const expiresAt = new Date(Date.now() + SUPPORT_SESSION_DURATION_MS).toISOString();

  const nowCloseOthers = new Date().toISOString();
  const { error: closeErr } = await admin
    .from('support_sessions')
    .update({ ended_at: nowCloseOthers })
    .eq('superuser_id', params.superuser.id)
    .is('ended_at', null);
  if (closeErr) {
    console.warn('[support-session] closing prior sessions:', closeErr.message);
  }

  const { data: inserted, error: insErr } = await admin
    .from('support_sessions')
    .insert({
      superuser_id: params.superuser.id,
      superuser_email: superEmail || 'unknown@platform.local',
      superuser_display_name: displayName,
      venue_id: venueId,
      apparent_staff_id: params.staffId,
      reason,
      expires_at: expiresAt,
    })
    .select(
      'id, superuser_id, superuser_email, superuser_display_name, venue_id, apparent_staff_id, reason, started_at, expires_at, ended_at',
    )
    .single();

  if (insErr || !inserted) {
    console.error('[support-session] insert session failed:', insErr);
    return { ok: false, error: 'Could not start support session.', status: 500 };
  }

  const session = inserted as SupportSessionRow;

  const apparentName = await getStaffDisplayName(admin, params.staffId);
  await insertSupportAuditEvent({
    admin,
    supportSessionId: session.id,
    venueId: venueId,
    apparentStaffId: params.staffId,
    superuserId: params.superuser.id,
    superuserEmail: superEmail,
    eventType: 'session_started',
    summary: 'Support session started',
    metadata: {
      reason,
      apparent_staff_name: apparentName,
    },
  });

  return { ok: true, session };
}

export async function endSupportSession(params: {
  sessionId: string;
  superuserId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = getSupabaseAdminClient();
  const session = await fetchActiveSupportSession(admin, params.sessionId, params.superuserId);
  if (!session) {
    return { ok: false, error: 'No active session.' };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from('support_sessions')
    .update({ ended_at: nowIso })
    .eq('id', session.id)
    .eq('superuser_id', params.superuserId);

  if (error) {
    console.error('[support-session] end session failed:', error.message);
    return { ok: false, error: 'Could not end session.' };
  }

  await insertSupportAuditEvent({
    admin,
    supportSessionId: session.id,
    venueId: session.venue_id,
    apparentStaffId: session.apparent_staff_id,
    superuserId: params.superuserId,
    superuserEmail: session.superuser_email,
    eventType: 'session_ended',
    summary: 'Support session ended',
  });

  return { ok: true };
}

export async function extendSupportSession(params: {
  sessionId: string;
  superuserId: string;
}): Promise<{ ok: boolean; session?: SupportSessionRow; error?: string }> {
  const admin = getSupabaseAdminClient();
  const session = await fetchActiveSupportSession(admin, params.sessionId, params.superuserId);
  if (!session) {
    return { ok: false, error: 'No active session to extend.' };
  }

  const newExpires = new Date(Date.now() + SUPPORT_SESSION_DURATION_MS).toISOString();
  const { data, error } = await admin
    .from('support_sessions')
    .update({ expires_at: newExpires })
    .eq('id', session.id)
    .eq('superuser_id', params.superuserId)
    .is('ended_at', null)
    .select(
      'id, superuser_id, superuser_email, superuser_display_name, venue_id, apparent_staff_id, reason, started_at, expires_at, ended_at',
    )
    .single();

  if (error || !data) {
    console.error('[support-session] extend failed:', error?.message);
    return { ok: false, error: 'Could not extend session.' };
  }

  const updated = data as SupportSessionRow;

  await insertSupportAuditEvent({
    admin,
    supportSessionId: updated.id,
    venueId: updated.venue_id,
    apparentStaffId: updated.apparent_staff_id,
    superuserId: params.superuserId,
    superuserEmail: updated.superuser_email,
    eventType: 'session_extended',
    summary: 'Support session extended by 60 minutes',
    metadata: { new_expires_at: newExpires },
  });

  return { ok: true, session: updated };
}

export async function logSupportApiMutationFromMiddleware(params: {
  session: SupportSessionRow;
  method: string;
  pathname: string;
}): Promise<void> {
  const admin = getSupabaseAdminClient();
  const summary = describeVenueMutationPath(params.pathname);
  await insertSupportAuditEvent({
    admin,
    supportSessionId: params.session.id,
    venueId: params.session.venue_id,
    apparentStaffId: params.session.apparent_staff_id,
    superuserId: params.session.superuser_id,
    superuserEmail: params.session.superuser_email,
    eventType: 'api_mutation',
    httpMethod: params.method,
    httpPath: params.pathname,
    summary,
  });
}
