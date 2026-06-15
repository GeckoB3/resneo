'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SALES_BONUS_TIERS } from '@/lib/sales/constants';

interface BonusTier {
  threshold: number;
  amount_pence: number;
}

interface SalespersonRow {
  id: string;
  user_id: string;
  email: string;
  name: string | null;
  active: boolean;
  lump_sum_per_signup_pence: number;
  revenue_share_percent: number;
  revenue_share_months: number;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  codes: string[];
  total_signups: number;
  active_paying_subscribers: number;
  lifetime_earnings_pence: number;
  bonus_tiers: BonusTier[];
}

interface TierDraft {
  threshold: string;
  amountPounds: string;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

function formatGbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

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

function poundsToPence(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function tiersToDrafts(tiers: BonusTier[]): TierDraft[] {
  const source = tiers.length ? tiers : [...DEFAULT_SALES_BONUS_TIERS];
  return source.map((t) => ({
    threshold: String(t.threshold),
    amountPounds: (t.amount_pence / 100).toFixed(2).replace(/\.00$/, ''),
  }));
}

export function SalespeoplePageClient() {
  const [rows, setRows] = useState<SalespersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'magic_link' | 'password'>('magic_link');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [lumpSumPounds, setLumpSumPounds] = useState('0');
  const [revenueSharePercent, setRevenueSharePercent] = useState('0');
  const [revenueShareMonths, setRevenueShareMonths] = useState('12');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Edit panel
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editLumpSum, setEditLumpSum] = useState('');
  const [editRevShare, setEditRevShare] = useState('');
  const [editRevMonths, setEditRevMonths] = useState('');
  const [editTiers, setEditTiers] = useState<TierDraft[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch('/api/platform/salespeople', { credentials: 'same-origin' });
      const body = (await res.json().catch(() => ({}))) as {
        salespeople?: SalespersonRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Failed to load (${res.status})`);
      setRows(body.salespeople ?? []);
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

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      // Clipboard unavailable — code remains visible to copy manually.
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/platform/salespeople', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim(),
          method,
          password: method === 'password' ? password : undefined,
          lump_sum_per_signup_pence: poundsToPence(lumpSumPounds),
          revenue_share_percent: parseFloat(revenueSharePercent) || 0,
          revenue_share_months: parseInt(revenueShareMonths, 10) || 12,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        channel?: string;
      };
      if (!res.ok) {
        setFormError(data.error ?? `Request failed (${res.status})`);
        return;
      }
      setFormSuccess(
        method === 'magic_link'
          ? `Salesperson created with code ${data.code}. A sign-in email has been sent.`
          : `Salesperson created with code ${data.code}. They can sign in at /sales with email and password.`,
      );
      setEmail('');
      setName('');
      setPassword('');
      setLumpSumPounds('0');
      setRevenueSharePercent('0');
      setRevenueShareMonths('12');
      await load();
    } catch {
      setFormError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(row: SalespersonRow) {
    setEditingId(row.id);
    setEditError(null);
    setEditName(row.name ?? '');
    setEditLumpSum((row.lump_sum_per_signup_pence / 100).toFixed(2).replace(/\.00$/, ''));
    setEditRevShare(String(row.revenue_share_percent));
    setEditRevMonths(String(row.revenue_share_months));
    setEditTiers(tiersToDrafts(row.bonus_tiers));
  }

  function updateTierDraft(index: number, patch: Partial<TierDraft>) {
    setEditTiers((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function addTierDraft() {
    setEditTiers((prev) => [...prev, { threshold: '', amountPounds: '' }]);
  }

  function removeTierDraft(index: number) {
    setEditTiers((prev) => prev.filter((_, i) => i !== index));
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    setEditError(null);
    try {
      const bonus_tiers: BonusTier[] = [];
      const seen = new Set<number>();
      for (const draft of editTiers) {
        if (!draft.threshold.trim() && !draft.amountPounds.trim()) continue;
        const threshold = parseInt(draft.threshold, 10);
        if (!Number.isFinite(threshold) || threshold < 1) {
          throw new Error('Each bonus tier needs a subscriber threshold of at least 1.');
        }
        if (seen.has(threshold)) {
          throw new Error(`Duplicate tier threshold: ${threshold}.`);
        }
        seen.add(threshold);
        bonus_tiers.push({ threshold, amount_pence: poundsToPence(draft.amountPounds) });
      }
      bonus_tiers.sort((a, b) => a.threshold - b.threshold);

      const res = await fetch(`/api/platform/salespeople/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: editName.trim() || undefined,
          lump_sum_per_signup_pence: poundsToPence(editLumpSum),
          revenue_share_percent: parseFloat(editRevShare) || 0,
          revenue_share_months: parseInt(editRevMonths, 10) || 12,
          bonus_tiers,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Update failed');
      setEditingId(null);
      await load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRevoke(id: string, rowEmail: string) {
    if (!window.confirm(`Revoke salesperson access for ${rowEmail}? Their codes stop working and they lose /sales access. Historic attributions are kept.`)) {
      return;
    }
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/platform/salespeople/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Revoke failed');
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Revoke failed');
    } finally {
      setBusyId(null);
    }
  }

  async function addCode(id: string) {
    setBusyId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/platform/salespeople/${encodeURIComponent(id)}/codes`, {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to add code');
      await load();
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Failed to add code');
    } finally {
      setBusyId(null);
    }
  }

  const totals = rows.reduce(
    (acc, r) => ({
      signups: acc.signups + r.total_signups,
      paying: acc.paying + r.active_paying_subscribers,
      earnings: acc.earnings + r.lifetime_earnings_pence,
    }),
    { signups: 0, paying: 0, earnings: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Salespeople</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage external sales agents, their discount codes, and reward configuration. All figures are
            informational — payments happen outside ResNeo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
        >
          {showCreate ? 'Close' : '+ Add salesperson'}
        </button>
      </div>

      {/* Programme totals */}
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Total attributed signups', value: String(totals.signups) },
          { label: 'Active paying subscribers', value: String(totals.paying) },
          { label: 'Lifetime payouts (est.)', value: formatGbp(totals.earnings) },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{kpi.label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{kpi.value}</p>
          </div>
        ))}
      </div>

      {listError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{listError}</p>
      )}

      {/* Create form */}
      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">New salesperson</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Creates the login, a unique discount code, and seeds the default bonus ladder (
              {DEFAULT_SALES_BONUS_TIERS.map((t) => `${t.threshold} → £${t.amount_pence / 100}`).join(', ')}).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Email</label>
              <input
                type="email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Invite method</label>
              <select
                className={inputClass}
                value={method}
                onChange={(e) => setMethod(e.target.value as 'magic_link' | 'password')}
              >
                <option value="magic_link">Magic link email</option>
                <option value="password">Set a password now</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">
                Lump sum per validated signup (£)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                value={lumpSumPounds}
                onChange={(e) => setLumpSumPounds(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Revenue share (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                className={inputClass}
                value={revenueSharePercent}
                onChange={(e) => setRevenueSharePercent(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Revenue share months</label>
              <input
                type="number"
                min="1"
                className={inputClass}
                value={revenueShareMonths}
                onChange={(e) => setRevenueShareMonths(e.target.value)}
              />
            </div>
            {method === 'password' && (
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Password (min 8 characters)</label>
                <div className="flex gap-2">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className={inputClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="shrink-0 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          {formSuccess && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {formSuccess}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create salesperson'}
          </button>
        </form>
      )}

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Active salespeople</h2>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 px-6 py-10 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
            Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-slate-700">No salespeople yet</p>
            <p className="mt-1 text-sm text-slate-500">Add your first salesperson to start the programme.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => {
              const busy = busyId === row.id;
              return (
                <div key={row.id} className="space-y-4 px-6 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-700">
                        {(row.name ?? row.email).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{row.name ?? row.email}</p>
                        <p className="text-sm text-slate-500">{row.email}</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          Added {formatShortDate(row.created_at)} · Last sign-in {formatShortDate(row.last_sign_in_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <div className="text-center">
                        <p className="text-lg font-bold text-slate-900">{row.total_signups}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Signups</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-slate-900">{row.active_paying_subscribers}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Paying</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-slate-900">{formatGbp(row.lifetime_earnings_pence)}</p>
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Lifetime</p>
                      </div>
                    </div>
                  </div>

                  {/* Codes + terms */}
                  <div className="flex flex-wrap items-center gap-2">
                    {row.codes.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => void copyCode(code)}
                        title="Copy code"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 font-mono text-xs font-semibold text-blue-800 transition-colors hover:bg-blue-100"
                      >
                        {code}
                        <span className="text-[10px] font-sans font-medium text-blue-500">
                          {copiedCode === code ? 'copied' : 'copy'}
                        </span>
                      </button>
                    ))}
                    <span className="ml-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {formatGbp(row.lump_sum_per_signup_pence)} / signup
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {row.revenue_share_percent}% × {row.revenue_share_months} mo
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      Ladder: {row.bonus_tiers.length ? row.bonus_tiers.map((t) => `${t.threshold}→£${t.amount_pence / 100}`).join(' · ') : 'none'}
                    </span>
                  </div>

                  {editingId === row.id ? (
                    <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/40 p-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Name</label>
                          <input className={inputClass} value={editName} onChange={(e) => setEditName(e.target.value)} />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Lump sum (£)</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className={inputClass}
                            value={editLumpSum}
                            onChange={(e) => setEditLumpSum(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Revenue share (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="100"
                            className={inputClass}
                            value={editRevShare}
                            onChange={(e) => setEditRevShare(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Share months</label>
                          <input
                            type="number"
                            min="1"
                            className={inputClass}
                            value={editRevMonths}
                            onChange={(e) => setEditRevMonths(e.target.value)}
                          />
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-xs font-medium text-slate-600">
                          Bonus ladder (active paying subscribers → one-time bonus)
                        </p>
                        <div className="space-y-2">
                          {editTiers.map((tier, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <input
                                type="number"
                                min="1"
                                placeholder="Subscribers"
                                className={`${inputClass} max-w-[140px]`}
                                value={tier.threshold}
                                onChange={(e) => updateTierDraft(i, { threshold: e.target.value })}
                              />
                              <span className="text-xs text-slate-400">→ £</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder="Bonus"
                                className={`${inputClass} max-w-[140px]`}
                                value={tier.amountPounds}
                                onChange={(e) => updateTierDraft(i, { amountPounds: e.target.value })}
                              />
                              <button
                                type="button"
                                onClick={() => removeTierDraft(i)}
                                className="rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-500 hover:bg-white hover:text-red-600"
                                aria-label="Remove tier"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={addTierDraft}
                          className="mt-2 text-xs font-medium text-blue-700 hover:text-blue-800"
                        >
                          + Add tier
                        </button>
                        <p className="mt-2 text-[11px] text-slate-500">
                          Already-awarded tiers are never paid twice, even if you change amounts later.
                        </p>
                      </div>

                      {editError && <p className="text-sm text-red-600">{editError}</p>}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => void saveEdit(row.id)}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {savingEdit ? 'Saving…' : 'Save changes'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit rewards
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void addCode(row.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Add code
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevoke(row.id, row.email)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {busy ? 'Working…' : 'Revoke'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
