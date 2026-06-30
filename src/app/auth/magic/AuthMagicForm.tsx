'use client';

import { useState } from 'react';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createClient } from '@/lib/supabase/browser';

/**
 * Customer "email me a fresh sign-in link" form.
 *
 * Deliberately does NOT send anything on mount. The link in transactional emails
 * ("View or sign in to your account") lands here, and a single accidental click
 * used to auto-send a magic-link email that the recipient never knowingly asked
 * for. The send is now gated behind an explicit button press. Already-signed-in
 * visitors never reach this form: the parent server component redirects them
 * straight to their bookings.
 */
export function AuthMagicForm({
  initialEmail,
  redirect,
}: {
  initialEmail: string;
  redirect: string;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function sendMagicLink(targetEmail: string) {
    setStatus('sending');
    try {
      const trimmed = targetEmail.trim();
      const res = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed, next: redirect }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; fallback?: boolean; error?: string };

      if (!res.ok) {
        setStatus('error');
        return;
      }

      if (json.fallback) {
        const siteOrigin = process.env.NEXT_PUBLIC_BASE_URL
          ? normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL)
          : typeof window !== 'undefined'
            ? window.location.origin
            : '';
        const callbackUrl = `${siteOrigin}/auth/callback?next=${encodeURIComponent(redirect)}`;
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithOtp({
          email: trimmed,
          options: { emailRedirectTo: callbackUrl },
        });
        if (error) {
          setStatus('error');
          return;
        }
      }

      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await sendMagicLink(email);
  }

  if (status === 'sent') {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Check your inbox</h1>
          <p className="mt-2 text-sm text-slate-600">
            If that email is registered, a secure sign-in link is on its way. It may take a minute to arrive.
          </p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-medium">Link sent</p>
          <p className="mt-1">Open the link on this device to see your bookings. The link expires in 1 hour.</p>
          <button
            type="button"
            onClick={() => setStatus('idle')}
            className="mt-3 text-sm font-medium text-green-900 underline underline-offset-2"
          >
            Use a different email address
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in to your bookings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Confirm your email below and we will send a secure sign-in link (no password required). We only send the link
          once you tap the button.
        </p>
      </div>
      <form onSubmit={(ev) => void submit(ev)} className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </label>
        <button
          type="submit"
          disabled={status === 'sending'}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
        {status === 'error' ? (
          <p className="text-sm text-red-700">Something went wrong. Try again shortly.</p>
        ) : null}
      </form>
    </div>
  );
}
