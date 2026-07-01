import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthMagicForm } from './AuthMagicForm';

/**
 * Customer sign-in landing page.
 *
 * Reached from the "View or sign in to your account" link in transactional
 * emails. Two cases:
 *   - Already signed in: link any unclaimed guest rows for this user's email
 *     (claim_user_account), then go straight to the bookings page (or the
 *     requested `redirect` path).
 *   - Signed out: show a button-gated form that only emails a magic link when the
 *     visitor explicitly asks for it (avoids accidental "I never requested this"
 *     sign-in emails from a stray click).
 */
export default async function AuthMagicPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string; redirect?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const rawRedirect = sp.redirect;
  // Same-origin guard (blocks `//evil.com` protocol-relative open redirects).
  const redirectPath =
    rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')
      ? rawRedirect
      : '/account/bookings';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // Backfill guest rows whose email matches this user but were created without a
    // user_id (phone / walk-in / imported / pre-account, or a first booking at a new
    // venue). Every other auth entry point already claims on the way in; this signed-in
    // redirect used to skip it, leaving those bookings invisible on /account/bookings.
    const { error: claimErr } = await supabase.rpc('claim_user_account');
    if (claimErr) {
      console.warn('[auth/magic] claim_user_account:', claimErr.message);
    }
    redirect(redirectPath);
  }

  return <AuthMagicForm initialEmail={sp.email?.trim() ?? ''} redirect={redirectPath} />;
}
