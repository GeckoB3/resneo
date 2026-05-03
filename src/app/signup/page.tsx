'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { getSignupResumePath } from '@/lib/signup-resume';
import { persistPendingSignupSelection } from '@/lib/signup-pending-client';
import { isSignupPaymentReady, type SignupPendingPlan } from '@/lib/signup-pending-selection';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when sign-up succeeded but Supabase did not return a session (email confirmation required). */
  const [awaitingEmailVerification, setAwaitingEmailVerification] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  // Already signed in (e.g. second tab) with plan chosen: skip straight to payment.
  // Account already linked to a venue: dashboard only (cannot run signup again).
  useEffect(() => {
    let cancelled = false;
    const client = createClient();
    void (async () => {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (cancelled || !session) return;

      const planRes = await fetch('/api/signup/existing-plan', { credentials: 'same-origin' });
      if (planRes.ok) {
        const planData = (await planRes.json()) as { hasVenue?: boolean };
        if (planData.hasVenue) {
          router.replace('/dashboard');
          return;
        }
      }

      const pendingRes = await fetch('/api/signup/pending-selection', { credentials: 'same-origin' });
      if (pendingRes.ok) {
        const pending = (await pendingRes.json()) as {
          plan?: SignupPendingPlan | null;
          business_type?: string | null;
        };
        if (isSignupPaymentReady(pending.plan ?? null, pending.business_type ?? null)) {
          router.replace('/signup/payment');
          return;
        }
      }

      if (getSignupResumePath() === '/signup/payment') {
        router.replace('/signup/payment');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (!acceptedTerms) {
      setError('You must accept the terms and conditions.');
      return;
    }

    const origin =
      process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, '') ||
      (typeof window !== 'undefined' ? window.location.origin : '');
    const resumePath = getSignupResumePath();
    const emailRedirectTo = `${origin}/auth/callback?next=${encodeURIComponent(resumePath)}`;

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo },
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    // With "Confirm email" enabled, Supabase returns user but no session until the link is opened.
    if (!data.session) {
      setAwaitingEmailVerification(true);
      return;
    }

    const storedPlan = sessionStorage.getItem('signup_plan') as SignupPendingPlan | null;
    const storedBt = sessionStorage.getItem('signup_business_type');
    if (storedPlan && isSignupPaymentReady(storedPlan, storedBt)) {
      await persistPendingSignupSelection(
        storedPlan,
        storedPlan === 'appointments' || storedPlan === 'light' ? null : storedBt,
      );
    }

    router.push(getSignupResumePath());
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none';
  const primaryBtn =
    'w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors';

  if (awaitingEmailVerification) {
    const resumePath = getSignupResumePath();
    const toPayment = resumePath === '/signup/payment';
    return (
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900">Check your email</h1>
          <p className="mt-2 text-sm text-slate-500">
            We sent a confirmation link to <span className="font-medium text-slate-700">{email}</span>. Open it to
            verify your account and continue signup.
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <p className="text-sm text-slate-600">
            After you confirm, you&apos;ll be signed in
            {toPayment
              ? ' and can continue to your order summary and payment.'
              : ' and can choose your business type and plan.'}{' '}
            If you already confirmed,{' '}
            <Link
              href={`/login?redirectTo=${encodeURIComponent(resumePath)}`}
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              sign in
            </Link>{' '}
            to continue.
          </p>
          <Link
            href={`/login?redirectTo=${encodeURIComponent(resumePath)}`}
            className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
        <p className="mt-2 text-sm text-slate-500">
          Get started with ReserveNI in minutes.
        </p>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@business.com"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
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
              autoComplete="new-password"
              className={inputClass}
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-xs text-slate-500">
              I agree to the ReserveNI{' '}
              <a href="/terms/customer" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">
                customer terms
              </a>
              {', '}
              <a href="/terms/data-processing" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">
                data processing terms
              </a>
              {', '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">
                Website Terms of Use
              </a>
              {' and '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline hover:text-brand-700">
                Privacy Policy
              </a>.
            </span>
          </label>
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}
          <button type="submit" disabled={loading} className={primaryBtn}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
