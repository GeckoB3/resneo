import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { isSalesAgent } from '@/lib/sales/auth';
import { hasActiveVenueSupportSession } from '@/lib/support-session-server';
import { safeSameOriginPath } from '@/lib/safe-auth-redirect';
import { LoginForm } from './login-form';
import { AuthCallbackErrorBanner } from './AuthCallbackErrorBanner';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirectTo?: string;
    error?: string;
    reason?: string;
    detail?: string;
    /** Prefill, so an expired portal link does not make the customer retype it (P3-4c). */
    email?: string;
  }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const sp = await searchParams;
  if (user) {
    const explicit = sp.redirectTo;
    if (explicit) {
      // Never redirect to a raw query parameter. Middleware currently shadows this
      // branch for authenticated users, so it is not reachable today, but that is
      // an accident of routing rather than a guard.
      redirect(safeSameOriginPath(explicit, '/dashboard'));
    }
    if (isPlatformSuperuser(user)) {
      const allowVenueShell = await hasActiveVenueSupportSession(supabase);
      redirect(allowVenueShell ? '/dashboard' : '/super');
    }
    if (isSalesAgent(user)) {
      // Dual-role salespeople (venue staff / customer too) pick a surface on login.
      redirect('/auth/choose-destination');
    }
    redirect('/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, rgba(13,148,136,0.06) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(5,150,105,0.04) 0%, transparent 50%)' }} />
      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center">
          <Link href="/">
            <img src="/Logo.png" alt="ResNeo" className="h-12 w-auto" />
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm redirectTo={sp.redirectTo} initialEmail={sp.email} />
          {sp.reason === 'session_expired' && (
            <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center text-sm text-amber-700">
              Your session has expired due to inactivity. Please sign in again.
            </p>
          )}
          {/*
            P3-4c. A one-click link from a booking email that has passed its
            window, been revoked, or was never valid, lands here. Saying so
            matters: a bare sign-in form reads as the LINK having been broken,
            and the customer telephones the venue instead of signing in. One
            sentence for every reason, because the customer's next step is the
            same in each case and the distinction is only useful in a log.
          */}
          {sp.reason?.startsWith('portal_') && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-center text-sm text-amber-700">
              That link has expired. Sign in below and we will take you straight to your booking.
            </p>
          )}
          <AuthCallbackErrorBanner error={sp.error} detail={sp.detail} />
        </div>
      </div>
    </main>
  );
}
