import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { hasActiveVenueSupportSession } from '@/lib/support-session-server';
import { LoginForm } from './login-form';
import { AuthCallbackErrorBanner } from './AuthCallbackErrorBanner';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; error?: string; reason?: string; detail?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const sp = await searchParams;
  if (user) {
    const explicit = sp.redirectTo;
    if (explicit) {
      redirect(explicit);
    }
    if (isPlatformSuperuser(user)) {
      const allowVenueShell = await hasActiveVenueSupportSession(supabase);
      redirect(allowVenueShell ? '/dashboard' : '/super');
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
            <img src="/Logo.png" alt="ReserveNI" className="h-12 w-auto" />
          </Link>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm redirectTo={sp.redirectTo} />
          {sp.reason === 'session_expired' && (
            <p className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center text-sm text-amber-700">
              Your session has expired due to inactivity. Please sign in again.
            </p>
          )}
          <AuthCallbackErrorBanner error={sp.error} detail={sp.detail} />
        </div>
      </div>
    </main>
  );
}
