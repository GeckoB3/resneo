'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { type AuthErrorDetail, getAuthCode, getAuthErrorDetail, getAuthOtpParams, mapAuthErrorMessageToDetail, parseHashSearchParams, SET_PASSWORD_PATH } from '@/lib/auth-link';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import { createClient } from '@/lib/supabase/browser';

const LOGIN_REDIRECT = `/login?redirectTo=${encodeURIComponent(SET_PASSWORD_PATH)}`;

function SetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<AuthErrorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    function finishReady() {
      if (cancelled) return;
      setAuthError(null);
      setChecking(false);
    }

    function finishWithAuthError(detail: AuthErrorDetail) {
      if (cancelled) return;
      syncUrl(detail);
      setAuthError(detail);
      setChecking(false);
    }

    function syncUrl(detail?: AuthErrorDetail) {
      if (typeof window === 'undefined') return;

      const url = new URL(window.location.href);
      url.hash = '';
      url.searchParams.delete('code');
      url.searchParams.delete('token_hash');
      url.searchParams.delete('type');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      url.searchParams.delete('error_code');
      url.searchParams.delete('detail');
      if (detail) {
        url.searchParams.set('error', 'auth_callback_error');
        url.searchParams.set('detail', detail);
      }
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }

    async function waitForSession() {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) {
          return session;
        }

        if (attempt < 4) {
          await new Promise((resolve) => window.setTimeout(resolve, 150));
        }
      }

      return null;
    }

    async function run() {
      const hashParams = typeof window === 'undefined' ? undefined : parseHashSearchParams(window.location.hash);

      const existingSession = await waitForSession();
      if (existingSession) {
        syncUrl();
        finishReady();
        return;
      }

      const detail = getAuthErrorDetail(searchParams, hashParams);
      if (detail) {
        finishWithAuthError(detail);
        return;
      }

      const code = getAuthCode(searchParams, hashParams);
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          console.error('[auth/set-password] exchangeCodeForSession:', exchangeError.message);
          finishWithAuthError(mapAuthErrorMessageToDetail(exchangeError.message));
          return;
        }

        const exchangedSession = await waitForSession();
        if (exchangedSession) {
          syncUrl();
          finishReady();
          return;
        }

        finishWithAuthError('exchange_failed');
        return;
      }

      const otpParams = getAuthOtpParams(searchParams, hashParams);
      if (otpParams) {
        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: otpParams.tokenHash,
          type: otpParams.type,
        });
        if (otpError) {
          console.error('[auth/set-password] verifyOtp:', otpError.message);
          finishWithAuthError(mapAuthErrorMessageToDetail(otpError.message));
          return;
        }

        const verifiedSession = await waitForSession();
        if (verifiedSession) {
          syncUrl();
          finishReady();
          return;
        }

        finishWithAuthError('exchange_failed');
        return;
      }

      router.replace(LOGIN_REDIRECT);
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Could not set password');
      }
      const after = sanitizeAuthNextPath(searchParams.get('next'));
      router.push(after);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set password');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none';
  const primaryBtn =
    'w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors';
  const authErrorMessage =
    authError === 'otp_expired'
      ? 'This password link was already used or has expired. Ask your venue admin to resend the invitation, or use forgot password if you have already signed in before.'
      : 'We could not confirm that password link. Try the latest email again, or continue from the login page.';

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </main>
    );
  }

  if (authError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'radial-gradient(circle at 30% 30%, rgba(13,148,136,0.06) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(5,150,105,0.04) 0%, transparent 50%)',
          }}
        />
        <div className="relative w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center">
            <Link href="/">
              <img src="/Logo.png" alt="ResNeo" className="h-12 w-auto" />
            </Link>
            <h1 className="mt-4 text-center text-lg font-bold text-slate-900">Password link unavailable</h1>
            <p className="mt-2 text-center text-sm text-slate-500">
              {authErrorMessage}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-3">
              <Link href={LOGIN_REDIRECT} className={primaryBtn + ' block text-center'}>
                Go to login
              </Link>
              <p className="text-center text-xs text-slate-500">
                The login page can send you a fresh magic link or password reset email.
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'radial-gradient(circle at 30% 30%, rgba(13,148,136,0.06) 0%, transparent 50%), radial-gradient(circle at 70% 70%, rgba(5,150,105,0.04) 0%, transparent 50%)',
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <Link href="/">
            <img src="/Logo.png" alt="ResNeo" className="h-12 w-auto" />
          </Link>
          <h1 className="mt-4 text-center text-lg font-bold text-slate-900">Create your password</h1>
          <p className="mt-2 text-center text-sm text-slate-500">
            Use this page after you open the invitation or sign-in link from your email. Choose a password for your
            Reserve NI account — then you can sign in with email and password from the login page, or continue using magic
            links. You can change your password anytime under{' '}
            <Link href="/account/security#password" className="font-medium text-brand-700 hover:underline">
              My account → Security
            </Link>
            .
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="Repeat password"
                className={inputClass}
              />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={loading} className={primaryBtn}>
              {loading ? 'Saving…' : 'Continue to dashboard'}
            </button>
            <p className="text-center text-xs text-slate-500">
              Need a new link? <Link href={LOGIN_REDIRECT} className="font-medium text-brand-700">Go to login</Link>
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function SetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        </main>
      }
    >
      <SetPasswordContent />
    </Suspense>
  );
}
