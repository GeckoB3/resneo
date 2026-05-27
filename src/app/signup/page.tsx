'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import { getSignupResumePath } from '@/lib/signup-resume';
import { persistPendingSignupSelection } from '@/lib/signup-pending-client';
import { isSignupPaymentReady, type SignupPendingPlan } from '@/lib/signup-pending-selection';
import {
  loadReferralCodeFromCookieOrUrl,
  persistReferralCodeCookie,
  clearReferralCodeCookie,
  validateReferralCodeClient,
  type ReferralValidationOk,
} from '@/lib/referrals/client';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when sign-up succeeded but Supabase did not return a session (email confirmation required). */
  const [awaitingEmailVerification, setAwaitingEmailVerification] = useState(false);
  // Referral state — loaded from ?ref= or the reserveni_ref cookie.
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [referralValid, setReferralValid] = useState<ReferralValidationOk | null>(null);
  const [referralCheckedAt, setReferralCheckedAt] = useState(0);
  const [showReferralInput, setShowReferralInput] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Backward-compat: /signup?ref=CODE used to drop users straight here and force
  // them through the appointments-defaulted business-type flow. If no plan has
  // been selected yet, redirect them to the plan chooser so they can pick.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refFromUrl = searchParams?.get('ref');
    if (!refFromUrl) return;
    const planInStorage = sessionStorage.getItem('signup_plan');
    if (planInStorage) return;
    let cancelled = false;
    void (async () => {
      const client = createClient();
      const { data: { session } } = await client.auth.getSession();
      if (cancelled || session) return;
      router.replace(`/signup/choose-plan?ref=${encodeURIComponent(refFromUrl)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

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

  // On mount, hydrate the referral code from ?ref= (URL wins) or cookie, and
  // validate it server-side so we can show the "Referred by X" banner.
  // All setState calls happen inside async callbacks to avoid synchronous
  // updates inside an effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromUrl = searchParams?.get('ref') ?? null;
      const initial = loadReferralCodeFromCookieOrUrl(fromUrl);
      if (!initial) {
        if (!cancelled) setReferralCheckedAt(Date.now());
        return;
      }
      if (cancelled) return;
      setReferralCodeInput(initial);
      setShowReferralInput(true);
      const result = await validateReferralCodeClient(initial);
      if (cancelled) return;
      if (result.ok) {
        setReferralValid(result);
        persistReferralCodeCookie(result.code);
      } else {
        setReferralValid(null);
        clearReferralCodeCookie();
      }
      setReferralCheckedAt(Date.now());
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  // Debounced validation when the user manually edits the code.
  useEffect(() => {
    const code = referralCodeInput.trim();
    if (!code) {
      // Schedule async so setState does not fire synchronously in the effect body.
      const t = setTimeout(() => {
        setReferralValid(null);
        clearReferralCodeCookie();
      }, 0);
      return () => clearTimeout(t);
    }
    if (referralValid && referralValid.code === code.toUpperCase()) return;
    const t = setTimeout(async () => {
      const result = await validateReferralCodeClient(code);
      if (result.ok) {
        setReferralValid(result);
        persistReferralCodeCookie(result.code);
      } else {
        setReferralValid(null);
        clearReferralCodeCookie();
      }
      setReferralCheckedAt(Date.now());
    }, 400);
    return () => clearTimeout(t);
  }, [referralCodeInput, referralValid]);

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
      {referralValid && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">Referred by {referralValid.referrer_venue_name}</p>
          <p className="mt-1 text-emerald-800">
            Your first month is free after your 14-day trial.
          </p>
        </div>
      )}
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
          {!referralValid && (
            <div>
              {!showReferralInput ? (
                <button
                  type="button"
                  onClick={() => setShowReferralInput(true)}
                  className="text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  Have a referral code?
                </button>
              ) : (
                <div>
                  <label htmlFor="referral-code" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Referral code
                  </label>
                  <input
                    id="referral-code"
                    type="text"
                    value={referralCodeInput}
                    onChange={(e) => setReferralCodeInput(e.target.value.toUpperCase())}
                    autoComplete="off"
                    placeholder="e.g. GREENWAY-X4F2"
                    className={inputClass}
                  />
                  {referralCheckedAt > 0 && referralCodeInput.trim() && !referralValid && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      We couldn&apos;t find that code. You can still sign up without it.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
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
