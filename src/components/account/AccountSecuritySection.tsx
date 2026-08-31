'use client';

import { useCallback, useState } from 'react';
import { Button, FormField, Input } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import Link from 'next/link';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { AccountPasswordForm } from '@/components/account/AccountPasswordForm';

/**
 * Password, sessions and account deletion, as sections of the profile page
 * rather than a route of their own (P1-3, closes part of G18).
 *
 * It rendered a `PageHeader` when it was `/account/security`. That is gone:
 * the profile page owns the `<h1>` now, and a second one here would have put
 * two page titles on one screen. The three `<h2>` cards below are unchanged,
 * including `id="password"`, which is what `/account/security` now redirects
 * to and therefore has to keep its name.
 */
export function AccountSecuritySection() {
  const [message, setMessageState] = useState<string | null>(null);
  const [error, setErrorState] = useState<string | null>(null);

  /**
   * Announcing wrappers (P0-8). Not one of the six sections the plan lists,
   * but account deletion and sign-out-everywhere are the last two outcomes a
   * user should have to discover by looking.
   */
  const { addToast } = useToast();
  const setMessage = useCallback(
    (m: string | null) => {
      setMessageState(m);
      if (m) addToast(m, 'success');
    },
    [addToast],
  );
  const setError = useCallback(
    (m: string | null) => {
      setErrorState(m);
      if (m) addToast(m, 'error');
    },
    [addToast],
  );
  const [loading, setLoading] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  async function requestDeletion() {
    if (deleteConfirmation !== 'DELETE MY ACCOUNT') {
      setError('Type DELETE MY ACCOUNT to confirm deletion.');
      return;
    }
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/account/delete-request', { method: 'POST' });
      const body = (await res.json()) as { deletion_scheduled_at?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Request failed');
        return;
      }
      setMessage(
        `Deletion scheduled. Your access will end after the grace period (${body.deletion_scheduled_at ?? 'see email'}). Venue records are anonymised per policy.`,
      );
      window.setTimeout(() => window.location.assign('/'), 1200);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  async function signOutEverywhere() {
    setSigningOutEverywhere(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/account/sign-out-everywhere', { method: 'POST' });
      if (!res.ok) {
        setError('Could not sign out everywhere.');
        return;
      }
      window.location.assign('/login');
    } catch {
      setError('Network error');
    } finally {
      setSigningOutEverywhere(false);
    }
  }

  async function cancelDeletion() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/account/delete-request/cancel', { method: 'POST' });
      if (!res.ok) {
        setError('Could not cancel deletion request.');
        return;
      }
      setMessage('Account deletion request cancelled.');
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div id="password" className="scroll-mt-28 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7">
        <h2 className="text-lg font-semibold text-slate-900">Password</h2>
        <p className="mt-2 text-sm text-slate-600">
          Create or update the password for <span className="font-medium text-slate-800">email + password</span> sign-in
          on the{' '}
          <Link href="/login" className="font-medium inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
            login
          </Link>{' '}
          page. This does not affect magic links. You can keep using those as well.
        </p>
        <AccountPasswordForm />
        <p className="mt-4 text-xs text-slate-500">
          Arrived from a one-time link in an email instead? You can also use the{' '}
          <Link href="/auth/set-password" className="font-medium inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2">
            dedicated set-password page
          </Link>{' '}
          after opening that link.
        </p>
      </div>

      <SectionCard className="p-6 sm:p-7">
        <h2 className="text-lg font-semibold text-slate-900">Sessions</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign out on this device and invalidate refresh tokens for other devices.
        </p>
        <Button
          type="button"
          variant="secondary"
          loading={signingOutEverywhere}
          onClick={() => void signOutEverywhere()}
          className="mt-4 min-h-10 rounded-xl px-4 py-2.5 shadow-sm"
        >
          {signingOutEverywhere ? 'Signing out...' : 'Sign out everywhere'}
        </Button>
      </SectionCard>

      {/*
        Download beside delete, because they are the same question asked two
        ways: "what do you hold about me, and will you stop holding it?" A
        customer about to delete an account is exactly the customer who wants a
        copy first, and finding that only after the deletion is too late.
      */}
      {/*
        `p-6 sm:p-7` is not decoration. `SectionCard` is a SHELL with no padding
        of its own, meant to be filled with `SectionCard.Body`, which brings
        its own. Rendered with bare children and no className, the heading and
        the button sat flush against the border, and `overflow-hidden` cropped
        them to the rounded corners. Matches the Sessions card above.
      */}
      <SectionCard className="p-6 sm:p-7">
        <h2 className="text-lg font-semibold text-slate-900">Download your data</h2>
        <p className="mt-2 text-sm text-slate-600">
          Everything in your account, as one file: your profile, bookings, payments and waitlist
          places. It downloads to this device rather than arriving by email, so no copy is left in
          an inbox.
        </p>
        {/*
          `asChild` so the link is the real secondary Button rather than a
          hand-copied one: it sat next to "Sign out everywhere" wearing a
          different text colour and carrying no focus ring, which is the half
          of a button a keyboard user needs most.
        */}
        <Button
          asChild
          variant="secondary"
          className="mt-4 min-h-10 rounded-xl px-4 py-2.5 shadow-sm"
        >
          <a href="/api/account/export" download>
            Download my data
          </a>
        </Button>
      </SectionCard>

      <div className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-amber-50/40 p-6 shadow-sm shadow-amber-900/5 sm:p-7">
        <h2 className="text-lg font-semibold text-amber-950">Delete account</h2>
        <p className="mt-2 text-sm text-slate-700">
          Requests a 30-day grace period, then removes platform access and anonymises linked guest PII at venues per
          GDPR retention rules.
        </p>
        {/*
          The amber focus ring is kept: this field sits in the destructive
          panel and its colour is the signal that it does. The important
          modifier is needed because `cn` concatenates rather than resolving
          Tailwind conflicts, so the primitive's brand ring would otherwise win
          by stylesheet order.
        */}
        <FormField label="Type DELETE MY ACCOUNT to confirm" className="mt-4">
          <Input
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            className="min-h-11 !border-amber-200/80 px-3 py-2.5 focus-visible:!border-amber-400 focus-visible:!ring-amber-200"
          />
        </FormField>
        {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">{message}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
        <Button
          type="button"
          disabled={deleteConfirmation !== 'DELETE MY ACCOUNT'}
          loading={loading}
          onClick={() => void requestDeletion()}
          className="mt-4 min-h-10 rounded-xl !bg-amber-800 px-4 py-2.5 shadow-sm hover:!bg-amber-900 disabled:!bg-amber-800/50"
        >
          {loading ? 'Submitting…' : 'Request account deletion'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={loading}
          onClick={() => void cancelDeletion()}
          className="ml-3 mt-4 min-h-10 rounded-xl !border-amber-300/90 px-4 py-2.5 !text-amber-950 shadow-sm hover:!bg-amber-100"
        >
          Cancel deletion request
        </Button>
      </div>
    </div>
  );
}
