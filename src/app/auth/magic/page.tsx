import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthMagicForm } from './AuthMagicForm';

/**
 * Customer sign-in landing page.
 *
 * Reached from the "View or sign in to your account" link in transactional
 * emails. Two cases:
 *   - Already signed in: skip sign-in entirely and go straight to the bookings
 *     page (or the requested `redirect` path).
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
    redirect(redirectPath);
  }

  return <AuthMagicForm initialEmail={sp.email?.trim() ?? ''} redirect={redirectPath} />;
}
