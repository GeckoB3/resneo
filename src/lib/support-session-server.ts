import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPPORT_SESSION_COOKIE_NAME, SUPPORT_SESSION_DURATION_MS } from '@/lib/support-session-constants';
import {
  fetchActiveSupportSession,
  parseSupportSessionCookieValue,
} from '@/lib/support-session-core';
import { resolveAuthIdentity } from '@/lib/auth/resolve-auth-identity';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuserFromIdentity } from '@/lib/platform-auth';

const maxAgeSeconds = Math.floor(SUPPORT_SESSION_DURATION_MS / 1000);

export function supportSessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export async function getSupportSessionCookieIdFromCookies(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(SUPPORT_SESSION_COOKIE_NAME)?.value;
  return parseSupportSessionCookieValue(raw);
}

export async function setSupportSessionCookie(sessionId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SUPPORT_SESSION_COOKIE_NAME, sessionId, supportSessionCookieOptions());
}

export async function clearSupportSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SUPPORT_SESSION_COOKIE_NAME);
}

/** True when the signed-in platform superuser has a valid, non-expired support session cookie. */
export async function hasActiveVenueSupportSession(supabase: SupabaseClient): Promise<boolean> {
  const identity = await resolveAuthIdentity(supabase);
  if (!identity || !isPlatformSuperuserFromIdentity(identity)) return false;
  const sid = await getSupportSessionCookieIdFromCookies();
  if (!sid) return false;
  const admin = getSupabaseAdminClient();
  const session = await fetchActiveSupportSession(admin, sid, identity.id);
  return Boolean(session);
}

export async function getActiveSupportSessionForBanner(
  supabase: SupabaseClient,
): Promise<{
  superuserDisplayName: string;
  expiresAt: string;
} | null> {
  const identity = await resolveAuthIdentity(supabase);
  if (!identity || !isPlatformSuperuserFromIdentity(identity)) return null;
  const sid = await getSupportSessionCookieIdFromCookies();
  if (!sid) return null;
  const admin = getSupabaseAdminClient();
  const session = await fetchActiveSupportSession(admin, sid, identity.id);
  if (!session) return null;
  return {
    superuserDisplayName:
      session.superuser_display_name?.trim() ||
      identity.email?.split('@')[0] ||
      'Support',
    expiresAt: session.expires_at,
  };
}
