'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { createClient } from '@/lib/supabase/browser';
import {
  getAuthCode,
  getAuthErrorDetail,
  getAuthFailurePath,
  mapAuthErrorMessageToDetail,
  parseHashSearchParams,
} from '@/lib/auth-link';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';

/**
 * Email invite / magic-link flows must exchange the auth code in the **browser**.
 * A Route Handler cannot reliably complete PKCE: the code verifier cookie is tied to the
 * browser session when the user follows the link from email, not to the server callback request.
 *
 * @see https://supabase.com/docs/guides/auth/server-side/nextjs
 */
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    async function run() {
      const supabase = createClient();

      async function redirectAfterSession() {
        const { error: claimErr } = await supabase.rpc('claim_user_account');
        if (claimErr) {
          console.warn('[auth/callback] claim_user_account:', claimErr.message);
        }

        const nextParam = searchParams.get('next') ?? '';
        let destination = sanitizeAuthNextPath(nextParam);
        try {
          const res = await fetch(
            `/api/auth/resolve-next?next=${encodeURIComponent(nextParam)}`,
            { credentials: 'include' },
          );
          if (res.ok) {
            const body = (await res.json()) as { destination?: string };
            if (body.destination && typeof body.destination === 'string') {
              destination = body.destination;
            }
          }
        } catch (e) {
          console.error('[auth/callback] resolve-next failed:', e instanceof Error ? e.message : e);
        }

        router.replace(destination);
        router.refresh();
      }

      const hashParams = typeof window === 'undefined' ? undefined : parseHashSearchParams(window.location.hash);

      const authErrorDetail = getAuthErrorDetail(searchParams, hashParams);
      if (authErrorDetail) {
        router.replace(getAuthFailurePath(searchParams.get('next'), authErrorDetail));
        return;
      }

      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession();
      if (existingSession) {
        await redirectAfterSession();
        return;
      }

      const code = getAuthCode(searchParams, hashParams);
      if (!code) {
        router.replace(getAuthFailurePath(searchParams.get('next'), 'exchange_failed'));
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        const detail = mapAuthErrorMessageToDetail(error.message);
        console.error('[auth/callback] exchangeCodeForSession:', error.message);
        router.replace(getAuthFailurePath(searchParams.get('next'), detail));
        return;
      }

      await redirectAfterSession();
    }

    void run();
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-4">
      <div
        className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600"
        aria-hidden
      />
      <p className="text-sm text-slate-600">Signing you in…</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
