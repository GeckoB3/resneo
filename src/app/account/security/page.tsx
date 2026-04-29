'use client';

import { useState } from 'react';
import Link from 'next/link';

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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Security &amp; data</h1>
        <p className="mt-1 text-slate-600">
          Password changes use the venue/staff password flow from your magic link email.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Password</h2>
        <p className="mt-2 text-sm text-slate-600">
          Use <Link href="/auth/set-password">set password</Link> after signing in with a magic link if you want a
          password on your account.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Sessions</h2>
        <p className="mt-2 text-sm text-slate-600">
          Sign out on this device and invalidate refresh tokens for other devices.
        </p>
        <button
          type="button"
          disabled={signingOutEverywhere}
          onClick={() => void signOutEverywhere()}
          className="mt-4 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
        >
          {signingOutEverywhere ? 'Signing out...' : 'Sign out everywhere'}
        </button>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Delete account</h2>
        <p className="mt-2 text-sm text-slate-700">
          Requests a 30-day grace period, then removes platform access and anonymises linked guest PII at venues per
          GDPR retention rules.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Type DELETE MY ACCOUNT to confirm
          <input
            value={deleteConfirmation}
            onChange={(e) => setDeleteConfirmation(e.target.value)}
            className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2 text-slate-900"
          />
        </label>
        {message ? <p className="mt-3 text-sm text-green-800">{message}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
        <button
          type="button"
          disabled={loading || deleteConfirmation !== 'DELETE MY ACCOUNT'}
          onClick={() => void requestDeletion()}
          className="mt-4 rounded-md bg-amber-800 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-60"
        >
          {loading ? 'Submitting…' : 'Request account deletion'}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => void cancelDeletion()}
          className="ml-3 mt-4 rounded-md border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel deletion request
        </button>
      </div>
    </div>
  );
}
