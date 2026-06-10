'use client';

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SALES_BONUS_TIERS } from '@/lib/sales/constants';

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
  codes: string[];
  total_signups: number;
  active_paying_subscribers: number;
  lifetime_earnings_pence: number;
  bonus_tiers: Array<{ threshold: number; amount_pence: number }>;
}

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

function formatGbp(pence: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
}

function penceToPoundsInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

function poundsToPence(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

export function SalespeoplePageClient() {
  const [rows, setRows] = useState<SalespersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [method, setMethod] = useState<'magic_link' | 'password'>('magic_link');
  const [password, setPassword] = useState('');
  const [lumpSumPounds, setLumpSumPounds] = useState('0');
  const [revenueSharePercent, setRevenueSharePercent] = useState('0');
  const [revenueShareMonths, setRevenueShareMonths] = useState('12');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLumpSum, setEditLumpSum] = useState('');
  const [editRevShare, setEditRevShare] = useState('');
  const [editRevMonths, setEditRevMonths] = useState('');
  const [editTiers, setEditTiers] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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
          ? `Salesperson created. Code: ${data.code}. Sign-in email sent.`
          : `Salesperson created. Code: ${data.code}. They can sign in at /sales.`,
      );
      setEmail('');
      setName('');
      setPassword('');
      await load();
    } catch {
      setFormError('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(row: SalespersonRow) {
    setEditingId(row.id);
    setEditLumpSum(penceToPoundsInput(row.lump_sum_per_signup_pence));
    setEditRevShare(String(row.revenue_share_percent));
    setEditRevMonths(String(row.revenue_share_months));
    const tiers = row.bonus_tiers.length ? row.bonus_tiers : [...DEFAULT_SALES_BONUS_TIERS];
    setEditTiers(tiers.map((t) => `${t.threshold}:${(t.amount_pence / 100).toFixed(0)}`).join('\n'));
  }

  async function saveEdit(id: string) {
    setSavingEdit(true);
    setListError(null);
    try {
      const tierLines = editTiers
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      const bonus_tiers = tierLines.map((line) => {
        const [th, amt] = line.split(':').map((s) => s.trim());
        return {
          threshold: parseInt(th, 10),
          amount_pence: poundsToPence(amt),
        };
      });

      const res = await fetch(`/api/platform/salespeople/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
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
      setListError(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleRevoke(id: string, rowEmail: string) {
    if (!window.confirm(`Revoke salesperson access for ${rowEmail}?`)) return;
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
    }
  }

  async function addCode(id: string) {
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
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6 lg:p-10">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Salespeople</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage external sales agents, discount codes, and reward configuration. Earnings are informational only.
        </p>
      </div>

      {listError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{listError}</p>
      )}

      <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Add salesperson</h2>
        <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="mb-1 block text-xs font-medium text-slate-600">Lump sum per validated signup (£)</label>
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
            <label className="mb-1 block text-xs font-medium text-slate-600">Invite method</label>
            <select
              className={inputClass}
              value={method}
              onChange={(e) => setMethod(e.target.value as 'magic_link' | 'password')}
            >
              <option value="magic_link">Magic link email</option>
              <option value="password">Password</option>
            </select>
          </div>
          {method === 'password' && (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-600">Password</label>
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
              />
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Default bonus ladder ({DEFAULT_SALES_BONUS_TIERS.map((t) => `${t.threshold}→£${t.amount_pence / 100}`).join(', ')}) is seeded automatically. Edit per person after creation.
        </p>
        {formError && <p className="text-sm text-red-600">{formError}</p>}
        {formSuccess && <p className="text-sm text-emerald-700">{formSuccess}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create salesperson'}
        </button>
      </form>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Active salespeople</h2>
        </div>
        {loading ? (
          <p className="px-5 py-8 text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-500">No salespeople yet.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((row) => (
              <div key={row.id} className="px-5 py-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-900">{row.name ?? row.email}</p>
                    <p className="text-sm text-slate-500">{row.email}</p>
                    <p className="mt-1 font-mono text-xs text-blue-700">{row.codes.join(', ') || 'No codes'}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p>{row.total_signups} signups · {row.active_paying_subscribers} paying</p>
                    <p className="font-medium">{formatGbp(row.lifetime_earnings_pence)} lifetime</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600">
                  Lump {formatGbp(row.lump_sum_per_signup_pence)} · {row.revenue_share_percent}% ×{' '}
                  {row.revenue_share_months} mo
                </p>
                {editingId === row.id ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        className={inputClass}
                        placeholder="Lump sum £"
                        value={editLumpSum}
                        onChange={(e) => setEditLumpSum(e.target.value)}
                      />
                      <input
                        className={inputClass}
                        placeholder="Rev share %"
                        value={editRevShare}
                        onChange={(e) => setEditRevShare(e.target.value)}
                      />
                      <input
                        className={inputClass}
                        placeholder="Months"
                        value={editRevMonths}
                        onChange={(e) => setEditRevMonths(e.target.value)}
                      />
                    </div>
                    <label className="block text-xs text-slate-600">Bonus tiers (threshold:amount_gbp per line)</label>
                    <textarea
                      className={`${inputClass} font-mono text-xs`}
                      rows={4}
                      value={editTiers}
                      onChange={(e) => setEditTiers(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={savingEdit}
                        onClick={() => void saveEdit(row.id)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
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
                      onClick={() => void addCode(row.id)}
                      className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Add code
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(row.id, row.email)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
