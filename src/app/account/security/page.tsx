'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { AccountPasswordForm } from './AccountPasswordForm';

export default function AccountSecurityPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      <PageHeader
        eyebrow="Account"
        title="Security & data"
        subtitle="Manage how you sign in, active sessions, and account deletion. If you usually use a magic link from email, you can still add a password for quicker sign-in."
      />

      <div id="password" className="scroll-mt-28 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7">
        <h2 className="text-lg font-semibold text-slate-900">Password</h2>
        <p className="mt-2 text-sm text-slate-600">
          Create or update the password for <span className="font-medium text-slate-800">email + password</span> sign-in
          on the{' '}
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            login
          </Link>{' '}
          page. This does not affect magic links — you can keep using those as well.
        </p>
        <AccountPasswordForm />
        <p className="mt-4 text-xs text-slate-500">
          Arrived from a one-time link in an email instead? You can also use the{' '}
          <Link href="/auth/set-password" className="font-medium text-brand-700 hover:underline">
            dedicated set-password page
          </Link>{' '}
          after opening that link.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7">
        <h2 className="text-lg font-semibold text-slate-900">Sessions</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign out on this device and invalidate refresh tokens for other devices.
        </p>
        <button
          type="button"
          disabled={signingOutEverywhere}
          onClick={() => void signOutEverywhere()}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
        >
          {signingOutEverywhere ? 'Signing out...' : 'Sign out everywhere'}
        </button>
      </div>

      <div className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/90 to-amber-50/40 p-6 shadow-sm shadow-amber-900/5 sm:p-7">
        <h2 className="text-lg font-semibold text-amber-950">Delete account</h2>
        <p className="mt-2 text-sm text-slate-700">
          Requests a 30-day grace period, then removes platform access and anonymises linked guest PII at venues per
          GDPR retention rules.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Type DELETE MY ACCOUNT to confirm
          <input
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            className="mt-1 w-full rounded-xl border border-amber-200/80 bg-white px-3 py-2.5 text-slate-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
          />
        </label>
        {message ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">{message}</p> : null}
        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{error}</p> : null}
        <button
          type="button"
          disabled={loading || deleteConfirmation !== 'DELETE MY ACCOUNT'}
          onClick={() => void requestDeletion()}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-xl bg-amber-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-900 disabled:opacity-60"
        >
          {loading ? 'Submitting…' : 'Request account deletion'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void cancelDeletion()}
          className="ml-3 mt-4 inline-flex min-h-10 items-center justify-center rounded-xl border border-amber-300/90 bg-white px-4 py-2.5 text-sm font-semibold text-amber-950 shadow-sm transition-colors hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel deletion request
        </button>
      </div>
    </div>
  );
}
