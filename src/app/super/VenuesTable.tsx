'use client';

import { useCallback, useEffect, useState } from 'react';
import { SuperProvisionPanel } from './SuperProvisionPanel';
import { isSuperuserFreeBillingAccess } from '@/lib/billing/billing-access-source';
import { planDisplayName } from '@/lib/pricing-constants';
import { labelForBookingModelKey } from '@/lib/platform/subscriber-report';

interface StaffRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
  created_at: string;
}

interface VenueRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  pricing_tier: string;
  plan_status: string;
  billing_access_source?: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_current_period_start: string | null;
  subscription_current_period_end: string | null;
  booking_model: string;
  created_at: string;
  onboarding_completed: boolean;
  is_test: boolean;
  staff: StaffRow[];
}

interface VenueInsights {
  bookings: {
    all_time: number;
    last_30_days: number;
    last_7_days: number;
    upcoming: number;
    cancelled_last_30_days: number;
    last_booking_created_at: string | null;
    last_booking_source: string | null;
  };
  guests: {
    total: number;
  };
}

interface ApiResponse {
  venues: VenueRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const TIER_OPTIONS = ['', 'appointments', 'plus', 'light', 'restaurant', 'founding'] as const;
const STATUS_OPTIONS = ['', 'active', 'trialing', 'past_due', 'cancelled', 'cancelling'] as const;
type EnvFilter = 'live' | 'test' | 'all';

function tierBadge(tier: string) {
  const t = tier.toLowerCase().trim();
  if (t === 'appointments') return 'bg-violet-100 text-violet-700';
  if (t === 'plus') return 'bg-indigo-100 text-indigo-800';
  if (t === 'light') return 'bg-sky-100 text-sky-800';
  if (t === 'restaurant') return 'bg-blue-100 text-blue-700';
  if (t === 'founding') return 'bg-amber-100 text-amber-800';
  return 'bg-slate-100 text-slate-600';
}

function statusBadge(status: string) {
  const s = status.toLowerCase().trim();
  if (s === 'active') return 'bg-emerald-100 text-emerald-700';
  if (s === 'trialing') return 'bg-cyan-100 text-cyan-700';
  if (s === 'past_due') return 'bg-red-100 text-red-700';
  if (s === 'cancelled') return 'bg-slate-200 text-slate-500';
  if (s === 'cancelling') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-600';
}

function roleBadge(role: string) {
  return role === 'admin'
    ? 'bg-indigo-100 text-indigo-700'
    : 'bg-slate-100 text-slate-600';
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function relativeDays(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30.4)} mo ago`;
  return `${(days / 365.25).toFixed(1)} yr ago`;
}

export function VenuesTable() {
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [status, setStatus] = useState('');
  const [env, setEnv] = useState<EnvFilter>('live');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signInModal, setSignInModal] = useState<{
    staffId: string;
    venueName: string;
    staffLabel: string;
  } | null>(null);

  const fetchVenues = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('env', env);
      if (search) params.set('search', search);
      if (tier) params.set('tier', tier);
      if (status) params.set('status', status);

      const res = await fetch(`/api/platform/venues?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data: ApiResponse = await res.json();

      setVenues(data.venues);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Error fetching venues:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, tier, status, env]);

  useEffect(() => {
    fetchVenues();
  }, [fetchVenues]);

  useEffect(() => {
    setPage(1);
  }, [search, tier, status, env]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 pt-4">
        <SuperProvisionPanel onCreated={() => void fetchVenues()} />
      </div>

      {/* Live / Test tabs */}
      <div className="flex items-center gap-1 border-b border-slate-100 px-4 pt-3">
        {(
          [
            { key: 'live', label: 'Live venues' },
            { key: 'test', label: 'Test venues' },
            { key: 'all', label: 'All' },
          ] as Array<{ key: EnvFilter; label: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setEnv(tab.key)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              env === tab.key
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
        {env === 'test' && (
          <span className="ml-2 self-center text-xs text-slate-400">
            Test venues are excluded from KPIs and the Subscribers report.
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search venues..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          {TIER_OPTIONS.map((t) => (
            <option key={t} value={t}>{t ? planDisplayName(t) : 'All plans'}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ') : 'All statuses'}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-slate-400">
          {total} venue{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50 text-xs font-medium uppercase tracking-wider text-slate-400">
              <th className="px-4 py-3 w-8" />
              <th className="px-4 py-3">Venue</th>
              <th className="px-4 py-3 hidden md:table-cell">Plan</th>
              <th className="px-4 py-3 hidden md:table-cell">Status</th>
              <th className="px-4 py-3 hidden lg:table-cell">Model</th>
              <th className="px-4 py-3 hidden lg:table-cell">Staff</th>
              <th className="px-4 py-3 hidden xl:table-cell">Created</th>
              <th className="px-4 py-3 hidden xl:table-cell">Stripe Sub</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && venues.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={8} className="px-4 py-4">
                    <div className="h-5 animate-pulse rounded bg-slate-100" />
                  </td>
                </tr>
              ))
            ) : venues.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                  {env === 'test' ? 'No test venues. Expand a live venue to mark it as a test venue.' : 'No venues found.'}
                </td>
              </tr>
            ) : (
              venues.map((venue) => {
                const expanded = expandedId === venue.id;
                return (
                  <VenueRowGroup
                    key={venue.id}
                    venue={venue}
                    expanded={expanded}
                    onToggle={() => setExpandedId(expanded ? null : venue.id)}
                    onChanged={() => void fetchVenues()}
                    onRequestSignInAs={(staffId, staffLabel) =>
                      setSignInModal({ staffId, venueName: venue.name, staffLabel })
                    }
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Previous
          </button>
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next
          </button>
        </div>
      )}
      {signInModal ? (
        <SignInAsSupportModal
          venueName={signInModal.venueName}
          staffLabel={signInModal.staffLabel}
          staffId={signInModal.staffId}
          onClose={() => setSignInModal(null)}
        />
      ) : null}
    </div>
  );
}

function SignInAsSupportModal({
  venueName,
  staffLabel,
  staffId,
  onClose,
}: {
  venueName: string;
  staffLabel: string;
  staffId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const r = reason.trim();
    if (r.length < 3) {
      setError('Enter a reason (at least 3 characters).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/support-sessions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff_id: staffId, reason: r }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || 'Could not start session');
      }
      window.location.assign('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">Sign in as venue user</h2>
        <p className="mt-2 text-sm text-slate-600">
          You will open the venue dashboard for <strong>{venueName}</strong> with the same permissions as{' '}
          <strong>{staffLabel}</strong>. Sessions last for 60 minutes and every mutating action is audit logged.
        </p>
        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Reason (required)
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800"
          placeholder="e.g. Customer reported booking page issue, ticket #1234"
        />
        {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Starting…' : 'Start support session'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VenueRowGroup({
  venue,
  expanded,
  onToggle,
  onChanged,
  onRequestSignInAs,
}: {
  venue: VenueRow;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onRequestSignInAs: (staffId: string, staffLabel: string) => void;
}) {
  const staffCount = venue.staff?.length ?? 0;
  const [insights, setInsights] = useState<VenueInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [togglingTest, setTogglingTest] = useState(false);

  useEffect(() => {
    if (!expanded || insights) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/platform/venues/${encodeURIComponent(venue.id)}/insights`, {
          credentials: 'same-origin',
        });
        const body = (await res.json().catch(() => ({}))) as VenueInsights & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? 'Failed to load insights');
        setInsights(body);
      } catch (e) {
        if (!cancelled) setInsightsError(e instanceof Error ? e.message : 'Failed to load insights');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expanded, insights, venue.id]);

  async function toggleTestFlag() {
    const next = !venue.is_test;
    const confirmMsg = next
      ? `Mark "${venue.name}" as a TEST venue? It will be excluded from platform KPIs and the Subscribers report.`
      : `Mark "${venue.name}" as a LIVE venue? It will be included in platform KPIs and reports again.`;
    if (!window.confirm(confirmMsg)) return;
    setTogglingTest(true);
    try {
      const res = await fetch(`/api/platform/venues/${encodeURIComponent(venue.id)}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_test: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Update failed');
      }
      onChanged();
    } catch (e) {
      console.error('Failed to toggle test flag:', e);
      window.alert(e instanceof Error ? e.message : 'Failed to update venue');
    } finally {
      setTogglingTest(false);
    }
  }

  const stripeSubShort = venue.stripe_subscription_id
    ? `...${venue.stripe_subscription_id.slice(-8)}`
    : '--';

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition-colors hover:bg-slate-50 ${expanded ? 'bg-slate-50' : ''}`}
      >
        <td className="px-4 py-3">
          <svg
            className={`h-4 w-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="font-medium text-slate-900">{venue.name}</p>
            {venue.is_test && (
              <span className="inline-block rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">
                Test
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">{venue.slug}</p>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tierBadge(venue.pricing_tier)}`}>
              {planDisplayName(venue.pricing_tier)}
            </span>
            {isSuperuserFreeBillingAccess(venue.billing_access_source) ? (
              <span className="inline-block rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800">
                Free
              </span>
            ) : null}
          </div>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(venue.plan_status)}`}>
            {venue.plan_status.replace('_', ' ')}
          </span>
        </td>
        <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
          {labelForBookingModelKey(venue.booking_model ?? '')}
        </td>
        <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-600">
          {staffCount}
        </td>
        <td className="px-4 py-3 hidden xl:table-cell text-xs text-slate-500">
          {formatShortDate(venue.created_at)}
        </td>
        <td className="px-4 py-3 hidden xl:table-cell">
          {venue.stripe_subscription_id ? (
            <a
              href={`https://dashboard.stripe.com/subscriptions/${venue.stripe_subscription_id}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-blue-600 hover:underline"
            >
              {stripeSubShort}
            </a>
          ) : (
            <span className="text-xs text-slate-400">--</span>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-slate-50 px-4 py-0">
            <div className="space-y-4 py-4 pl-8">
              {/* Mobile tier/status badges */}
              <div className="flex flex-wrap gap-2 md:hidden">
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tierBadge(venue.pricing_tier)}`}>
                  {planDisplayName(venue.pricing_tier)}
                </span>
                {isSuperuserFreeBillingAccess(venue.billing_access_source) ? (
                  <span className="inline-block rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800">
                    Free
                  </span>
                ) : null}
                <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(venue.plan_status)}`}>
                  {venue.plan_status.replace('_', ' ')}
                </span>
              </div>

              {/* Usage insights */}
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Usage
                </h4>
                {insightsError ? (
                  <p className="text-xs text-rose-600">{insightsError}</p>
                ) : !insights ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-16 animate-pulse rounded-lg border border-slate-200 bg-white" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <InsightStat label="All-time bookings" value={String(insights.bookings.all_time)} />
                    <InsightStat label="Last 30 days" value={String(insights.bookings.last_30_days)} />
                    <InsightStat label="Last 7 days" value={String(insights.bookings.last_7_days)} />
                    <InsightStat label="Upcoming" value={String(insights.bookings.upcoming)} />
                    <InsightStat
                      label="Cancelled (30d)"
                      value={String(insights.bookings.cancelled_last_30_days)}
                      warn={insights.bookings.cancelled_last_30_days > 0}
                    />
                    <InsightStat label="Guests" value={String(insights.guests.total)} />
                  </div>
                )}
                {insights && (
                  <p className="mt-2 text-xs text-slate-500">
                    Last booking: <span className="font-medium text-slate-700">{relativeDays(insights.bookings.last_booking_created_at)}</span>
                    {insights.bookings.last_booking_source ? ` (${insights.bookings.last_booking_source})` : ''}
                  </p>
                )}
              </div>

              {/* Billing & meta */}
              <div className="grid gap-3 text-xs text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Contact</p>
                  <p className="mt-1">{venue.email ?? '—'}</p>
                  <p>{venue.phone ?? ''}</p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Billing period</p>
                  <p className="mt-1">
                    {formatShortDate(venue.subscription_current_period_start)} → {formatShortDate(venue.subscription_current_period_end)}
                  </p>
                  <div className="mt-1 flex gap-3">
                    {venue.stripe_subscription_id && (
                      <a
                        href={`https://dashboard.stripe.com/subscriptions/${venue.stripe_subscription_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        Subscription ↗
                      </a>
                    )}
                    {venue.stripe_customer_id && (
                      <a
                        href={`https://dashboard.stripe.com/customers/${venue.stripe_customer_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-blue-600 hover:underline"
                      >
                        Customer ↗
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Onboarding</p>
                  <p className="mt-1">{venue.onboarding_completed ? 'Completed' : 'In progress'}</p>
                  <p className="mt-1">
                    <a
                      href={`/book/${venue.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-blue-600 hover:underline"
                    >
                      Public booking page ↗
                    </a>
                  </p>
                </div>
                <div>
                  <p className="font-semibold uppercase tracking-wide text-slate-400">Environment</p>
                  <p className="mt-1">{venue.is_test ? 'Test / development venue' : 'Live venue'}</p>
                  <button
                    type="button"
                    disabled={togglingTest}
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleTestFlag();
                    }}
                    className={`mt-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                      venue.is_test
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100'
                    }`}
                  >
                    {togglingTest ? 'Updating…' : venue.is_test ? 'Mark as live venue' : 'Mark as test venue'}
                  </button>
                </div>
              </div>

              {/* Staff */}
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Staff ({staffCount})
                </h4>
                {staffCount === 0 ? (
                  <p className="text-xs text-slate-400 italic">No staff members.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-medium uppercase tracking-wider text-slate-400">
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2 hidden sm:table-cell">Phone</th>
                          <th className="px-3 py-2">Role</th>
                          <th className="px-3 py-2 hidden sm:table-cell">Added</th>
                          <th className="px-3 py-2 text-right">Support</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {venue.staff.map((s) => (
                          <tr key={s.id}>
                            <td className="px-3 py-2 text-slate-700">{s.name ?? '--'}</td>
                            <td className="px-3 py-2 text-slate-600">{s.email}</td>
                            <td className="px-3 py-2 text-slate-600 hidden sm:table-cell">{s.phone ?? '--'}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${roleBadge(s.role)}`}>
                                {s.role}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-500 hidden sm:table-cell">
                              {formatShortDate(s.created_at)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const label = s.name?.trim() || s.email;
                                  onRequestSignInAs(s.id, label);
                                }}
                                className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800 hover:bg-sky-100"
                              >
                                Sign in as
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function InsightStat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${warn ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
