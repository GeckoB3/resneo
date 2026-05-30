'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';
import {
  signupPlanToFamily,
  SIGNUP_PLAN_CONFLICT_MESSAGE,
  type SignupPlanFamily,
} from '@/lib/signup-plan-family';

type BannerState = 'loading' | 'hidden' | 'same_family' | 'mismatch';

export function SignupPlanConflictBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<BannerState>('loading');

  useEffect(() => {
    let cancelled = false;
    const client = createClient();

    void (async () => {
      const {
        data: { session },
      } = await client.auth.getSession();
      if (cancelled || !session) {
        setState('hidden');
        return;
      }

      const res = await fetch('/api/signup/existing-plan', { credentials: 'same-origin' });
      if (!res.ok || cancelled) {
        setState('hidden');
        return;
      }

      const data = (await res.json()) as {
        hasVenue?: boolean;
        planFamily?: SignupPlanFamily;
        onboarding_completed?: boolean;
      };

      if (!data.hasVenue || !data.planFamily) {
        setState('hidden');
        return;
      }

      const fromQuery = searchParams.get('plan');
      const fromStorage =
        typeof window !== 'undefined' ? sessionStorage.getItem('signup_plan') : null;
      const raw = (fromQuery ?? fromStorage ?? 'appointments') as 'appointments' | 'restaurant' | 'founding';
      const attemptedFamily = signupPlanToFamily(raw);

      if (attemptedFamily !== data.planFamily) {
        setState('mismatch');
        return;
      }
      // New signups have a venue and subscription but have not finished onboarding yet — do not
      // tell them to "use the dashboard" while they are still in the signup/onboarding funnel.
      if (data.onboarding_completed !== true) {
        setState('hidden');
        return;
      }
      setState('same_family');
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams]);

  if (state === 'loading' || state === 'hidden') return null;

  if (state === 'mismatch') {
    return (
      <div className="mx-auto mb-6 w-full max-w-2xl rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm">
        <p className="font-semibold">Cannot subscribe to a second plan type</p>
        <p className="mt-1 leading-relaxed">{SIGNUP_PLAN_CONFLICT_MESSAGE}</p>
        <Link href="/dashboard" className="mt-2 inline-block font-medium text-brand-700 underline hover:text-brand-800">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto mb-6 w-full max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
      <p className="font-semibold">Your account already has a plan</p>
      <p className="mt-1 text-amber-900/90">
        You are signed in with an account that already has a Resneo subscription. Use the dashboard to manage your
        venue.
      </p>
      <Link href="/dashboard" className="mt-2 inline-block font-medium text-brand-700 underline hover:text-brand-800">
        Open dashboard
      </Link>
    </div>
  );
}
