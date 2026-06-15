'use client';

import { useMemo, useState } from 'react';
import { BILLING_ACCESS_SOURCE_SUPERUSER_FREE } from '@/lib/billing/billing-access-source';

type PlanValue = 'light' | 'plus' | 'appointments' | 'restaurant';
type AuthMode = 'password' | 'magic_link';

const PLANS: { value: PlanValue; label: string }[] = [
  { value: 'light', label: 'Appointments Light' },
  { value: 'plus', label: 'Appointments Plus' },
  { value: 'appointments', label: 'Appointments Pro' },
  { value: 'restaurant', label: 'Restaurant' },
];

export function SuperProvisionPanel({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [plan, setPlan] = useState<PlanValue>('appointments');
  const [authMode, setAuthMode] = useState<AuthMode>('magic_link');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const planLabel = useMemo(() => PLANS.find((p) => p.value === plan)?.label ?? plan, [plan]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (authMode === 'password' && password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        owner_email: ownerEmail.trim(),
        plan,
        auth_mode: authMode,
        free_access_reason: reason.trim() || undefined,
      };
      if (authMode === 'password') {
        body.password = password;
      }

      const res = await fetch('/api/platform/provision-venue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        venue_id?: string;
        owner_next_path?: string;
        auth_mode?: string;
      };

      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      const next = data.owner_next_path ?? '/onboarding';
      setSuccess(
        data.auth_mode === 'magic_link'
          ? `Venue created. Magic link sent to ${ownerEmail.trim()}. Owner should open it, set a password, then sign in — next: ${next}`
          : `Venue created. Owner can sign in with email + password — next after login: ${next}`,
      );
      setPassword('');
      setPasswordConfirm('');
      setShowPassword(false);
      onCreated?.();
    } catch {
      setError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Create venue (free access)</h2>
          <p className="text-xs text-slate-500">
            Comped ResNeo billing ({BILLING_ACCESS_SOURCE_SUPERUSER_FREE}). No subscription checkout. Appointment-plan owners start at booking model selection, then complete onboarding (and Stripe Connect for guest payments when needed).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen((o) => !o);
            setError(null);
            setSuccess(null);
          }}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          {open ? 'Close' : 'Create account'}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="space-y-4 px-4 py-4">
          <label className="block text-xs font-medium text-slate-700">
            Owner email
            <input
              required
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="owner@example.com"
              autoComplete="off"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Plan
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value as PlanValue)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {PLANS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="text-xs font-medium text-slate-700">
              <legend className="mb-1">Login</legend>
              <div className="flex flex-wrap gap-3">
                <label className="flex items-center gap-2 font-normal">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === 'magic_link'}
                    onChange={() => setAuthMode('magic_link')}
                  />
                  Magic link (set password on first visit)
                </label>
                <label className="flex items-center gap-2 font-normal">
                  <input
                    type="radio"
                    name="authMode"
                    checked={authMode === 'password'}
                    onChange={() => setAuthMode('password')}
                  />
                  Set password now
                </label>
              </div>
            </fieldset>
          </div>

          {authMode === 'password' && (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700">Password (min 8 characters)</span>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  required={authMode === 'password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  autoComplete="new-password"
                />
              </div>
              <label className="block text-xs font-medium text-slate-700">
                Confirm password
                <input
                  required={authMode === 'password'}
                  type={showPassword ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm ${
                    passwordConfirm && password !== passwordConfirm
                      ? 'border-red-300 bg-red-50'
                      : 'border-slate-200'
                  }`}
                  autoComplete="new-password"
                />
                {passwordConfirm && password !== passwordConfirm && (
                  <span className="mt-1 block text-xs text-red-600">Passwords do not match.</span>
                )}
              </label>
            </div>
          )}

          <label className="block text-xs font-medium text-slate-700">
            Internal note (optional)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Why is this account comped?"
            />
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          )}
          {success && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {success}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : `Create ${planLabel} venue`}
            </button>
            <span className="text-xs text-slate-400">Creates admin staff + venue on {planLabel}.</span>
          </div>
        </form>
      )}
    </div>
  );
}
