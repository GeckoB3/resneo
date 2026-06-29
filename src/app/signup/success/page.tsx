'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearReferralCodeCookie } from '@/lib/referrals/client';
import { clearSalesCodeCookie } from '@/lib/sales/client';

export default function SignupSuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [status, setStatus] = useState<'loading' | 'error'>(() => (sessionId ? 'loading' : 'error'));
  const [error, setError] = useState<string | null>(() =>
    sessionId ? null : 'No session ID found. Please try again.',
  );

  // Bumping `attempt` re-runs the completion effect. Provisioning is idempotent
  // (it re-checks existing venue/staff), so "Try again" safely re-runs
  // /api/signup/complete rather than starting a SECOND paid checkout.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    async function completeSignup(sid: string) {
      try {
        const res = await fetch('/api/signup/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sid }),
        });

        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setStatus('error');
          setError(data.error || 'Failed to complete signup.');
          return;
        }

        // Signup complete — clear the referral and sales cookies so they don't bleed
        // into another person's signup on a shared computer (mis-attribution + wrong trial).
        clearReferralCodeCookie();
        clearSalesCodeCookie();

        router.push(data.redirect_url || '/onboarding');
      } catch {
        if (!cancelled) {
          setStatus('error');
          setError('Network error. Please refresh the page.');
        }
      }
    }

    void completeSignup(sessionId);
    return () => {
      cancelled = true;
    };
  }, [sessionId, router, attempt]);

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">Something went wrong</h2>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={() => {
              if (sessionId) {
                setStatus('loading');
                setError(null);
                setAttempt((n) => n + 1);
              } else {
                router.push('/signup/payment');
              }
            }}
            className="mt-6 rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50">
          <svg className="h-6 w-6 animate-spin text-brand-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">Setting up your account...</h2>
        <p className="mt-2 text-sm text-slate-500">This will only take a moment.</p>
      </div>
    </div>
  );
}
