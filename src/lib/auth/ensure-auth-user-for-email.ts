/**
 * Silent signup: ensure there is an auth.users row for this email (passwordless).
 * Used by public online booking flows; venue/admin paths should not call this.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function lookupAuthUserIdByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const normalised = normaliseEmail(email);
  const { data, error } = await admin.rpc('lookup_auth_user_id_by_email', {
    p_email: normalised,
  });
  if (error) {
    console.error('[lookupAuthUserIdByEmail] rpc failed', {
      message: error.message,
      code: error.code,
    });
    return null;
  }
  if (data == null || typeof data !== 'string') return null;
  return data;
}

/**
 * Returns auth user id for the email, creating a passwordless user when missing.
 */
export async function ensureAuthUserForEmail(
  admin: SupabaseClient,
  email: string,
  displayName: string | null,
): Promise<string> {
  const normalised = normaliseEmail(email);
  const existing = await lookupAuthUserIdByEmail(admin, normalised);
  if (existing) return existing;

  const meta =
    displayName && displayName.trim()
      ? { full_name: displayName.trim(), name: displayName.trim() }
      : undefined;

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: normalised,
    email_confirm: false,
    user_metadata: meta,
  });

  if (!createErr && created?.user?.id) {
    return created.user.id;
  }

  const msg = createErr?.message ?? '';
  if (msg.toLowerCase().includes('already') || createErr?.status === 422) {
    const again = await lookupAuthUserIdByEmail(admin, normalised);
    if (again) return again;
  }

  console.error('[ensureAuthUserForEmail] createUser failed', {
    message: createErr?.message,
    email: normalised,
  });
  throw createErr ?? new Error('Failed to create auth user');
}
