'use client';

import { useState } from 'react';
import { SET_PASSWORD_PATH } from '@/lib/auth-link';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createClient } from '@/lib/supabase/browser';
import { hasPlatformSuperuserJwtRole } from '@/lib/platform-auth';

export type LoginFormVariant = 'default' | 'booking';

export function LoginForm({
  redirectTo,
  variant = 'default',
}: {
  redirectTo?: string;
  variant?: LoginFormVariant;
}) {
  const isBookingFlow = variant === 'booking';
  const [mode, setMode] = useState<'password' | 'magic'>(isBookingFlow ? 'magic' : 'password');
  const [forgotPassword, setForgotPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const supabase = createClient();
  const siteOrigin = process.env.NEXT_PUBLIC_BASE_URL
    ? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)
    : (typeof window !== 'undefined' ? window.location.origin : '');
  const callbackUrl =
    redirectTo?.trim()
      ? `${siteOrigin}/auth/callback?next=${encodeURIComponent(redirectTo.trim())}`
      : `${siteOrigin}/auth/callback`;
  const passwordSetupCallbackUrl = `${siteOrigin}/auth/callback?next=${encodeURIComponent(SET_PASSWORD_PATH)}`;

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    const { data: { user } } = await supabase.auth.getUser();
    let destination = redirectTo ?? '/dashboard';
    if (!redirectTo && hasPlatformSuperuserJwtRole(user)) {
      destination = '/super';
    }
    window.location.href = destination;
  }

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      const res = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          ...(redirectTo?.trim() ? { next: redirectTo.trim() } : {}),
        }),
      });

      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; fallback?: boolean; error?: string };

      if (!res.ok) {
        setError(json.error ?? 'Could not send magic link. Please try again.');
        return;
      }

      if (res.ok && json.fallback) {
        const { error: err } = await supabase.auth.signInWithOtp({
          email: trimmedEmail,
          options: { emailRedirectTo: callbackUrl },
        });
        if (err) {
          setError(err.message);
          return;
        }
        setSent(true);
        return;
      }

      if (res.ok && json.ok) {
        setSent(true);
        return;
      }

      setError('Could not send magic link. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: passwordSetupCallbackUrl });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSuccessMessage('Check your inbox for a link to reset your password.');
  }

  const inputClass =
    'min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500';
  const primaryBtn = 'w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50';
  const secondaryLink = 'text-sm font-medium text-slate-500 hover:text-brand-600';

  if (forgotPassword) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Enter your email and we&apos;ll send you a reset link.</p>
        <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input id="forgot-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className={inputClass} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {successMessage && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>}
          <button type="submit" disabled={loading} className={primaryBtn}>{loading ? 'Sending...' : 'Send Reset Link'}</button>
          <div className="text-center">
            <button type="button" onClick={() => { setForgotPassword(false); setError(null); setSuccessMessage(null); }} className={secondaryLink}>Back to sign in</button>
          </div>
        </form>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
          <svg className="h-6 w-6 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
        </div>
        <p className="text-sm text-slate-600">
          {isBookingFlow
            ? 'Check your inbox for the sign-in link. Open it on this device and you will return here to finish your booking.'
            : 'Check your inbox for the sign-in link.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setMode(isBookingFlow ? 'magic' : 'password');
          }}
          className={secondaryLink}
        >
          {isBookingFlow ? 'Use password instead' : 'Sign in with password instead'}
        </button>
      </div>
    );
  }

  const magicTabLabel = isBookingFlow ? 'Email link' : 'Magic Link';
  const passwordTabLabel = 'Password';

  return (
    <div className="space-y-4">
      {isBookingFlow ? (
        <div className="rounded-xl border border-brand-100 bg-brand-50/80 px-3.5 py-3 text-sm text-brand-950">
          <p className="font-medium">New to ReserveNI?</p>
          <p className="mt-1 text-brand-900/90">
            Enter your Email to create a free account automatically. No separate signup and no password required.
          </p>
        </div>
      ) : null}

      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {isBookingFlow ? (
          <>
            <button
              type="button"
              onClick={() => {
                setMode('magic');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'magic' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {magicTabLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {passwordTabLabel}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setMode('password');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'password' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {passwordTabLabel}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('magic');
                setError(null);
              }}
              className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'magic' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {magicTabLabel}
            </button>
          </>
        )}
      </div>

      {mode === 'password' ? (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {isBookingFlow ? (
            <p className="text-sm text-slate-600">Already set a password on ReserveNI? Sign in here.</p>
          ) : null}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className={inputClass} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className={primaryBtn}>{loading ? 'Signing in...' : 'Sign In'}</button>
          <div className="text-center">
            <button type="button" onClick={() => setForgotPassword(true)} className={secondaryLink}>Forgot password?</button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => void handleMagicSubmit(e)} className="space-y-4">
          {isBookingFlow ? (
            <p className="text-sm text-slate-600">
              Enter the email you want on the booking. We will email you a one-time link to sign in.
            </p>
          ) : null}
          <div>
            <label htmlFor="magic-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input id="magic-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@example.com" className={inputClass} />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? 'Sending...' : isBookingFlow ? 'Email me a sign-in link' : 'Send Magic Link'}
          </button>
        </form>
      )}
    </div>
  );
}
