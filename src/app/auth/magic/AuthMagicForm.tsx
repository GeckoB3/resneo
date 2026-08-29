'use client';

import { useEffect, useState } from 'react';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { createClient } from '@/lib/supabase/browser';
import { magicLinkLifetimeLabel } from '@/lib/auth/magic-link-lifetime';

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
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error' | 'throttled'>('idle');
  /** The address the link actually went to, which may not be what is typed now. */
  const [sentTo, setSentTo] = useState('');
  /**
   * Seconds until a resend is allowed (P3-4g).
   *
   * Seeded from the server's OWN `Retry-After` when it throttles, rather than
   * from a number guessed here: `send-magic-link` allows 3 per address per 15
   * minutes and returns the real remaining time, so the countdown a customer
   * watches is the one the server is actually keeping. The default between
   * ordinary sends is short, and exists to stop double-taps rather than to
   * enforce anything.
   */
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

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

      if (res.status === 429) {
        // The server knows how long is left; asking it beats guessing.
        const retryAfter = Number(res.headers.get('Retry-After'));
        setCooldown(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : 60);
        setStatus('throttled');
        return;
      }

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
        // Target `/auth/confirm`, not `/auth/callback`. This fallback is the only web path that
        // still uses Supabase's own "Magic Link" template, which the mobile app also depends on.
        // That template sends `?token_hash=`, which only `/auth/confirm` verifies; `/auth/callback`
        // handles `?code=` alone and would reject it. `/auth/confirm` forwards a `code` or an
        // error back to `/auth/callback`, so this works under either template shape.
        const callbackUrl = `${siteOrigin}/auth/confirm?next=${encodeURIComponent(redirect)}`;
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

      setSentTo(trimmed);
      // Enough to stop a double-tap; the server's own limit is the real bound.
      setCooldown(30);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await sendMagicLink(email);
  }

  /*
    Stays on this screen while a RESEND is in flight. Written as `sending` too
    because the resend button lives here: without it the screen flipped back to
    the form the moment it was pressed, and the customer lost the confirmation
    they were reading. TypeScript found that, by narrowing `status` inside the
    block and pointing out that `sending` could never occur there.
  */
  if (sentTo && (status === 'sent' || status === 'throttled' || status === 'sending')) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Check your inbox</h1>
          {/*
            P3-4g: NAME THE ADDRESS. "If that email is registered" told a
            customer who mistyped their address nothing at all, and the most
            common reason a link never arrives is that it went somewhere else.
            The wording still does not confirm whether the account exists.
          */}
          <p className="mt-2 text-sm text-slate-600">
            If <span className="font-medium text-slate-900">{sentTo}</span> is registered, a secure
            sign-in link is on its way. It may take a minute to arrive.
          </p>
        </div>
        <div
          role="status"
          className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900"
        >
          <p className="font-medium">Link sent</p>
          <p className="mt-1">
            Open the link on this device to see your bookings. The link expires in{' '}
            {magicLinkLifetimeLabel()}.
          </p>
        </div>

        {/*
          The resend, behind the cooldown. Offered here rather than making the
          customer go back and retype: not receiving the email is exactly when
          they need this screen to do something.
        */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void sendMagicLink(sentTo)}
            disabled={cooldown > 0 || status === 'sending'}
            className="w-full rounded-md border border-slate-300 bg-white py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send it again'}
          </button>
          {status === 'throttled' ? (
            <p role="alert" className="text-sm text-amber-800">
              We have sent several sign-in links to this address already. Check your inbox and spam
              folder before asking for another.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setStatus('idle');
              setCooldown(0);
            }}
            className="w-full text-sm font-medium text-slate-600 underline underline-offset-2"
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
        {/*
          The cooldown binds HERE too, not only on the "check your inbox"
          screen. A first attempt that is throttled never reaches that screen,
          so without this the server's own `Retry-After` was recorded and then
          shown to nobody, and the button invited a press that would be refused.
        */}
        <button
          type="submit"
          disabled={status === 'sending' || cooldown > 0}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {status === 'sending'
            ? 'Sending…'
            : cooldown > 0
              ? `Try again in ${cooldown}s`
              : 'Email me a sign-in link'}
        </button>
        {status === 'error' ? (
          <p role="alert" className="text-sm text-red-700">
            Something went wrong. Try again shortly.
          </p>
        ) : null}
        {status === 'throttled' ? (
          <p role="alert" className="text-sm text-amber-800">
            We have sent several sign-in links to this address already. Check your inbox and spam folder, then try
            again in a few minutes.
          </p>
        ) : null}
      </form>
    </div>
  );
}
