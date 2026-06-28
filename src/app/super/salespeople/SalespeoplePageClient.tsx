'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SALES_BONUS_TIERS,
  SALES_TRIAL_PRESETS,
  MIN_SALES_TRIAL_DAYS,
  MAX_SALES_TRIAL_DAYS,
  clampSalesTrialDays,
  salesTrialRewardLabel,
} from '@/lib/sales/constants';

interface BonusTier {
  threshold: number;
  amount_pence: number;
}

interface CodeRow {
  id: string;
  code: string;
  active: boolean;
  trial_days: number;
  label: string | null;
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
  codes: CodeRow[];
  total_signups: number;
  active_paying_subscribers: number;
  lifetime_earnings_pence: number;
  bonus_tiers: BonusTier[];
}

interface TierDraft {
  threshold: string;
  amountPounds: string;
}

interface MonthlyStatement {
  period_month: string;
  signups_count: number;
  validated_count: number;
  lump_sum_pence: number;
  revenue_share_pence: number;
  bonus_pence: number;
  active_subscribers_end: number;
  total_pence: number;
}

interface EarningsPayload {
  current_month: MonthlyStatement;
  statements: MonthlyStatement[];
}

interface EarningsState {
  loading: boolean;
  error: string | null;
  data: EarningsPayload | null;
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

function formatMonth(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return iso;
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
  const [initialTrialDays, setInitialTrialDays] = useState('30');
  const [customCode, setCustomCode] = useState('');
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

  // Per-salesperson monthly earnings, lazily fetched the first time a row is expanded.
  const [earningsOpen, setEarningsOpen] = useState<Set<string>>(new Set());
  const [earnings, setEarnings] = useState<Record<string, EarningsState>>({});

  const loadEarnings = useCallback(async (id: string) => {
    setEarnings((prev) => ({ ...prev, [id]: { loading: true, error: null, data: prev[id]?.data ?? null } }));
    try {
      const res = await fetch(`/api/platform/salespeople/${encodeURIComponent(id)}/earnings`, {
        credentials: 'same-origin',
      });
      const body = (await res.json().catch(() => ({}))) as EarningsPayload & { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Failed to load (${res.status})`);
      setEarnings((prev) => ({ ...prev, [id]: { loading: false, error: null, data: body } }));
    } catch (e) {
      setEarnings((prev) => ({
        ...prev,
        [id]: { loading: false, error: e instanceof Error ? e.message : 'Failed to load', data: prev[id]?.data ?? null },
      }));
    }
  }, []);

  const toggleEarnings = useCallback(
    (id: string) => {
      const willOpen = !earningsOpen.has(id);
      setEarningsOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (willOpen && !earnings[id]?.loading) void loadEarnings(id);
    },
    [earningsOpen, earnings, loadEarnings],
  );

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
          trial_days: clampSalesTrialDays(parseInt(initialTrialDays, 10)),
          code: customCode.trim() ? customCode.trim().toUpperCase() : undefined,
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
      setInitialTrialDays('30');
      setCustomCode('');
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
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">Custom code (optional)</label>
              <input
                className={inputClass}
                placeholder="Auto-generated if blank"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
              />
              <p className="mt-1 text-[11px] text-slate-500">
                3 to 40 letters, numbers, or hyphens, e.g. SELLER-1-2M.
              </p>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="mb-1 block text-xs font-medium text-slate-600">
                First code free trial (the subscriber&apos;s reward)
              </label>
              <TrialDaysInput value={initialTrialDays} onChange={setInitialTrialDays} />
              <p className="mt-1 text-[11px] text-slate-500">
                You can add more codes with different trials (1 month, 2 months, or custom) after creating the
                salesperson.
              </p>
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

                  {/* Payout terms */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {formatGbp(row.lump_sum_per_signup_pence)} / signup
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      {row.revenue_share_percent}% × {row.revenue_share_months} mo
                    </span>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                      Ladder: {row.bonus_tiers.length ? row.bonus_tiers.map((t) => `${t.threshold}→£${t.amount_pence / 100}`).join(' · ') : 'none'}
                    </span>
                  </div>

                  {/* Discount codes & per-code free-trial rewards */}
                  <CodesManager
                    salespersonId={row.id}
                    codes={row.codes}
                    onChanged={load}
                    onError={(msg) => setListError(msg)}
                  />

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
                        onClick={() => toggleEarnings(row.id)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        {earningsOpen.has(row.id) ? 'Hide earnings' : 'Monthly earnings'}
                      </button>
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
                        onClick={() => void handleRevoke(row.id, row.email)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      >
                        {busy ? 'Working…' : 'Revoke'}
                      </button>
                    </div>
                  )}

                  {earningsOpen.has(row.id) && (
                    <SalespersonEarningsPanel
                      state={earnings[row.id]}
                      onRetry={() => void loadEarnings(row.id)}
                    />
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

/** Trial-length picker: quick presets plus a free-form day count, with a live "= N months free" hint. */
function TrialDaysInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const days = parseInt(value, 10);
  const valid = Number.isFinite(days) && days >= MIN_SALES_TRIAL_DAYS && days <= MAX_SALES_TRIAL_DAYS;
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {SALES_TRIAL_PRESETS.map((p) => (
          <button
            key={p.days}
            type="button"
            onClick={() => onChange(String(p.days))}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
              days === p.days ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          min={MIN_SALES_TRIAL_DAYS}
          max={MAX_SALES_TRIAL_DAYS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} max-w-[120px]`}
        />
        <span className="text-xs text-slate-500">
          days{valid ? ` · ${salesTrialRewardLabel(clampSalesTrialDays(days))}` : ''}
        </span>
      </div>
    </div>
  );
}

/** Per-salesperson code list: add codes (custom trial/label/vanity code), edit, enable/disable, delete. */
function CodesManager({
  salespersonId,
  codes,
  onChanged,
  onError,
}: {
  salespersonId: string;
  codes: CodeRow[];
  onChanged: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addTrial, setAddTrial] = useState('30');
  const [addLabel, setAddLabel] = useState('');
  const [addCode, setAddCode] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState('');
  const [editTrial, setEditTrial] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const base = `/api/platform/salespeople/${encodeURIComponent(salespersonId)}/codes`;

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard unavailable — code stays visible to copy manually.
    }
  }

  async function createCode() {
    setBusy(true);
    onError('');
    try {
      const body: Record<string, unknown> = {};
      const t = parseInt(addTrial, 10);
      if (Number.isFinite(t)) body.trial_days = clampSalesTrialDays(t);
      if (addLabel.trim()) body.label = addLabel.trim();
      if (addCode.trim()) body.code = addCode.trim().toUpperCase();
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to add code');
      setShowAdd(false);
      setAddTrial('30');
      setAddLabel('');
      setAddCode('');
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to add code');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(c: CodeRow) {
    setEditingId(c.id);
    setEditCode(c.code);
    setEditTrial(String(c.trial_days));
    setEditLabel(c.label ?? '');
  }

  async function mutate(codeId: string, method: 'PATCH' | 'DELETE', body?: object) {
    setBusy(true);
    onError('');
    try {
      const res = await fetch(`${base}/${encodeURIComponent(codeId)}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Update failed');
      setEditingId(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string, currentCode: string) {
    const t = parseInt(editTrial, 10);
    const nextCode = editCode.trim().toUpperCase();
    await mutate(id, 'PATCH', {
      code: nextCode && nextCode !== currentCode ? nextCode : undefined,
      trial_days: Number.isFinite(t) ? clampSalesTrialDays(t) : undefined,
      label: editLabel.trim() ? editLabel.trim() : null,
    });
  }

  async function removeCode(c: CodeRow) {
    if (!window.confirm(`Delete code ${c.code}? New signups can no longer use it. Existing attributions are kept.`)) {
      return;
    }
    await mutate(c.id, 'DELETE');
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700">Discount codes &amp; free-trial rewards</p>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="text-xs font-medium text-blue-700 hover:text-blue-800"
        >
          {showAdd ? 'Cancel' : '+ Add code'}
        </button>
      </div>

      {codes.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">No codes yet — add one to give this salesperson something to share.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {codes.map((c) => (
            <li key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              {editingId === c.id ? (
                <div className="space-y-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-slate-600">Code</label>
                    <input
                      className={inputClass}
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                    />
                    <p className="mt-1 text-[11px] text-amber-600">
                      Renaming takes effect immediately. Links already shared with the old code will stop
                      working. To keep the old one live too, add a separate code instead.
                    </p>
                  </div>
                  <TrialDaysInput value={editTrial} onChange={setEditTrial} />
                  <input
                    className={inputClass}
                    placeholder="Label (optional, internal note)"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveEdit(c.id, c.code)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copy(c.code)}
                      title="Copy code"
                      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors ${
                        c.active
                          ? 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                          : 'bg-slate-100 text-slate-400 line-through'
                      }`}
                    >
                      {c.code}
                      <span className="font-sans text-[10px] font-medium text-blue-500">
                        {copied === c.code ? 'copied' : 'copy'}
                      </span>
                    </button>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {salesTrialRewardLabel(c.trial_days)}
                    </span>
                    {!c.active && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">inactive</span>
                    )}
                    {c.label && <span className="text-[11px] text-slate-400">{c.label}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate(c.id, 'PATCH', { active: !c.active })}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {c.active ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeCode(c)}
                      className="rounded-md border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-white p-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-slate-600">Free trial this code grants</label>
            <TrialDaysInput value={addTrial} onChange={setAddTrial} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className={inputClass}
              placeholder="Label (optional), e.g. Acme switchers"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="Custom code (optional, else auto)"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value.toUpperCase())}
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createCode()}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Create code'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Per-salesperson monthly earnings: an "owed at a glance" strip (this month so far + last finalised
 * month) and a per-calendar-month breakdown table. The in-progress month is a live running total,
 * the rest are finalised statements. Figures match the salesperson's own /sales dashboard exactly.
 */
function SalespersonEarningsPanel({
  state,
  onRetry,
}: {
  state: EarningsState | undefined;
  onRetry: () => void;
}) {
  if (!state || state.loading) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        Loading monthly earnings…
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <span>{state.error ?? 'Unable to load earnings'}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          Retry
        </button>
      </div>
    );
  }

  const { current_month, statements } = state.data;
  const lastFinalised = statements[0] ?? null;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">
            This month so far ({formatMonth(current_month.period_month)})
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {formatGbp(current_month.total_pence)}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-700">Running total, not yet finalised.</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            Last finalised{lastFinalised ? ` (${formatMonth(lastFinalised.period_month)})` : ''}
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {lastFinalised ? formatGbp(lastFinalised.total_pence) : 'None yet'}
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-700">Owed for the most recent completed month.</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Month</th>
              <th className="px-4 py-2.5 font-medium">Signups</th>
              <th className="px-4 py-2.5 font-medium">Validated</th>
              <th className="px-4 py-2.5 font-medium">Lump sum</th>
              <th className="px-4 py-2.5 font-medium">Rev. share</th>
              <th className="px-4 py-2.5 font-medium">Bonus</th>
              <th className="px-4 py-2.5 font-medium">Subscribers</th>
              <th className="px-4 py-2.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr className="bg-amber-50/50">
              <td className="px-4 py-2.5 font-medium text-slate-900">
                <span className="flex items-center gap-2">
                  {formatMonth(current_month.period_month)}
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    In progress
                  </span>
                </span>
              </td>
              <td className="px-4 py-2.5 text-slate-600">{current_month.signups_count}</td>
              <td className="px-4 py-2.5 text-slate-600">{current_month.validated_count}</td>
              <td className="px-4 py-2.5 text-slate-600">{formatGbp(current_month.lump_sum_pence)}</td>
              <td className="px-4 py-2.5 text-slate-600">{formatGbp(current_month.revenue_share_pence)}</td>
              <td className="px-4 py-2.5 text-slate-600">{formatGbp(current_month.bonus_pence)}</td>
              <td className="px-4 py-2.5 text-slate-600">{current_month.active_subscribers_end}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                {formatGbp(current_month.total_pence)}
              </td>
            </tr>
            {statements.map((s) => (
              <tr key={s.period_month} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5 font-medium text-slate-900">{formatMonth(s.period_month)}</td>
                <td className="px-4 py-2.5 text-slate-600">{s.signups_count}</td>
                <td className="px-4 py-2.5 text-slate-600">{s.validated_count}</td>
                <td className="px-4 py-2.5 text-slate-600">{formatGbp(s.lump_sum_pence)}</td>
                <td className="px-4 py-2.5 text-slate-600">{formatGbp(s.revenue_share_pence)}</td>
                <td className="px-4 py-2.5 text-slate-600">{formatGbp(s.bonus_pence)}</td>
                <td className="px-4 py-2.5 text-slate-600">{s.active_subscribers_end}</td>
                <td className="px-4 py-2.5 text-right font-semibold text-slate-900">{formatGbp(s.total_pence)}</td>
              </tr>
            ))}
            {statements.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-center text-xs text-slate-500">
                  No finalised months yet. The first statement is generated after this month closes.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-slate-400">
        Finalised on the 1st of each month (UTC). Figures are informational. Payment happens outside ResNeo.
      </p>
    </div>
  );
}
