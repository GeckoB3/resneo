'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

/**
 * Customer "email me a fresh sign-in link" page (uses branded `/api/auth/send-magic-link`).
 */
function AuthMagicContent() {
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const redirect = searchParams.get('redirect') || '/account/bookings';
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const autoSent = useRef(false);

  async function sendMagicLink(targetEmail: string) {
    setStatus('sending');
    try {
      const res = await fetch('/api/auth/send-magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: targetEmail.trim(),
          next: `/auth/callback?next=${encodeURIComponent(redirect)}`,
        }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
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

  useEffect(() => {
    if (autoSent.current || !initialEmail.trim()) return;
    autoSent.current = true;
    void sendMagicLink(initialEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEmail]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Sign in link</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter the email you use for bookings. We&apos;ll send a secure link (no password required).
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
          {status === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>
      </form>
      {status === 'sent' ? (
        <p className="text-sm text-green-800">If that email is registered, we&apos;ve sent a link. Check your inbox.</p>
      ) : null}
      {status === 'error' ? (
        <p className="text-sm text-red-700">Something went wrong. Try again shortly.</p>
      ) : null}
    </div>
  );
}

export default function AuthMagicPage() {
  return (
    <Suspense fallback={<div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">Loading…</div>}>
      <AuthMagicContent />
    </Suspense>
  );
}
