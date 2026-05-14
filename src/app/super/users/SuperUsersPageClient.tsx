'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

interface SuperuserRow {
  user_id: string;
  email: string;
  created_at: string;
  created_by: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return '—';
  }
}

export function SuperUsersPageClient() {
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [rows, setRows] = useState<SuperuserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [method, setMethod] = useState<'magic_link' | 'password'>('magic_link');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/platform/superusers', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as { users?: SuperuserRow[]; error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? `Failed to load (${res.status})`);
      }
      setRows(body.users ?? []);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to load');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!cancelled) setActorUserId(data.user?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const trimmed = email.trim().toLowerCase();
    if (method === 'password') {
      if (password !== passwordConfirm) {
        setFormError('Passwords do not match.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = { email: trimmed, method };
      if (method === 'password') payload.password = password;

      const res = await fetch('/api/platform/superusers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        channel?: string;
        method?: string;
      };
      if (!res.ok) {
        setFormError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      if (method === 'magic_link') {
        const via = data.channel === 'sendgrid' ? 'email (SendGrid)' : 'Supabase invite email';
        setFormSuccess(`Sign-in instructions were sent via ${via} to ${trimmed}.`);
      } else {
        setFormSuccess(`Superuser created for ${trimmed}. They can sign in with email and password.`);
      }
      setEmail('');
      setPassword('');
      setPasswordConfirm('');
      setShowPassword(false);
      await load();
    } catch {
      setFormError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(userId: string, rowEmail: string) {
    if (userId === actorUserId) {
      return;
    }
    if (!window.confirm(`Revoke platform superuser access for ${rowEmail}? They will lose /super access unless listed in PLATFORM_SUPERUSER_EMAILS.`)) {
      return;
    }
    setRevokingId(userId);
    setListError(null);
    try {
      const res = await fetch(`/api/platform/superusers/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setListError(body.error ?? `Revoke failed (${res.status})`);
        return;
      }
      await load();
    } catch {
      setListError('Network error while revoking');
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform superusers</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          Active superusers are stored in <span className="font-mono text-xs text-slate-600">platform_superusers</span>{' '}
          with matching Auth app metadata. Revoking removes database access and clears superuser metadata; it does not
          delete the underlying login account.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Add superuser</h2>
        <p className="mt-1 text-xs text-slate-500">
          Magic link uses SendGrid when configured; otherwise Supabase sends an invite (new accounts only). For existing
          accounts without SendGrid, use password.
        </p>
        <form onSubmit={handleCreate} className="mt-4 space-y-4">
          <label className="block text-xs font-medium text-slate-700">
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="ops@example.com"
              autoComplete="off"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-700">How they sign in</legend>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="method"
                checked={method === 'magic_link'}
                onChange={() => setMethod('magic_link')}
                className="text-blue-600"
              />
              Magic link / invite email
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="method"
                checked={method === 'password'}
                onChange={() => setMethod('password')}
                className="text-blue-600"
              />
              Set password now (min 8 characters)
            </label>
          </fieldset>

          {method === 'password' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Password
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  className={`${inputClass} mt-1`}
                  autoComplete="new-password"
                />
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Confirm password
                <input
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  minLength={8}
                  className={`${inputClass} mt-1`}
                  autoComplete="new-password"
                />
              </label>
              <div className="sm:col-span-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                  Show passwords
                </label>
              </div>
            </div>
          )}

          {formError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>
          )}
          {formSuccess && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {formSuccess}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create superuser'}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <h2 className="text-sm font-semibold text-slate-900">Active superusers</h2>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>

        {listError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800 sm:px-6">{listError}</div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 sm:px-6">Email</th>
                <th className="hidden px-3 py-3 md:table-cell">Added</th>
                <th className="hidden px-3 py-3 lg:table-cell">Last sign-in</th>
                <th className="px-4 py-3 text-right sm:px-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500 sm:px-6">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500 sm:px-6">
                    No active superusers found.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isSelf = r.user_id === actorUserId;
                  return (
                    <tr key={r.user_id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 sm:px-6">
                        <div className="font-medium text-slate-900">{r.email}</div>
                        {isSelf && <span className="mt-0.5 inline-block text-xs text-amber-700">You</span>}
                        <div className="mt-1 text-xs text-slate-500 md:hidden">
                          Added {formatShortDate(r.created_at)}
                          {r.last_sign_in_at ? ` · Last ${formatShortDate(r.last_sign_in_at)}` : ''}
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-slate-600 md:table-cell">{formatShortDate(r.created_at)}</td>
                      <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">
                        {formatShortDate(r.last_sign_in_at)}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-6">
                        <button
                          type="button"
                          disabled={isSelf || revokingId === r.user_id}
                          title={isSelf ? 'You cannot revoke your own access while signed in' : undefined}
                          onClick={() => void handleRevoke(r.user_id, r.email)}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {revokingId === r.user_id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
