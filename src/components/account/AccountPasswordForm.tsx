'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, FormField, Input } from '@/components/ui/primitives';

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

  return (
    <form onSubmit={(ev) => void onSubmit(ev)} className="mt-4 space-y-4">
      {/*
        Like-for-like: these two labels were already `text-sm font-medium
        text-slate-700`, which is exactly what FormField's Label renders, so
        nothing about them moves. FormField also owns the htmlFor wiring now,
        which is why the explicit ids stay: autofill and password managers key
        off them, and letting FormField generate one would change them on every
        render.
      */}
      <FormField label="New password" htmlFor="account-new-password">
        <Input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
      </FormField>
      <FormField label="Confirm password" htmlFor="account-confirm-password">
        <Input
          id="account-confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          placeholder="Repeat password"
        />
      </FormField>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-800">{message}</p> : null}
      <Button type="submit" loading={loading} className="rounded-md">
        {loading ? 'Saving…' : 'Save password'}
      </Button>
    </form>
  );
}
