import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { resolveAuthIdentity, type AuthIdentity } from '@/lib/auth/resolve-auth-identity';

/**
 * Dashboard layout gate: resolve session from JWT claims (no Auth `/user` round-trip).
 * Middleware already blocks unauthenticated access to `/dashboard/*`.
 */
export async function requireDashboardIdentity(
  supabase: SupabaseClient,
  redirectTo = '/dashboard',
): Promise<AuthIdentity> {
  const identity = await resolveAuthIdentity(supabase);
  if (!identity) {
    redirect(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  }
  return identity;
}
