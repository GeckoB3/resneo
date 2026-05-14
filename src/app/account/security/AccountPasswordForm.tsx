'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AccountPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not update password.');
        return;
      }
      setMessage('Your password has been saved. You can sign in with your email and this password from the login page.');
      setPassword('');
      setConfirm('');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <form onSubmit={(ev) => void onSubmit(ev)} className="mt-4 space-y-4">
      <div>
        <label htmlFor="account-new-password" className="block text-sm font-medium text-slate-700">
          New password
        </label>
        <input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className={inputClass}
          placeholder="At least 8 characters"
        />
      </div>
      <div>
        <label htmlFor="account-confirm-password" className="block text-sm font-medium text-slate-700">
          Confirm password
        </label>
        <input
          id="account-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          className={inputClass}
          placeholder="Repeat password"
        />
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {loading ? 'Saving…' : 'Save password'}
      </button>
    </form>
  );
}
