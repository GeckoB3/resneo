'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { buildCsvFromRows, downloadCsvString } from '@/lib/appointments-csv';
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import type { GuestDetailResponse, GuestListRow } from '@/types/contacts';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';

export interface ClientSummary {
  identified_clients_total: number;
  new_clients_in_period: number;
  returning_clients_in_period: number;
  anonymous_visits_in_period: number;
}

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'last_visit_desc', label: 'Last visit (newest)' },
  { value: 'last_visit_asc', label: 'Last visit (oldest)' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'visit_count_desc', label: 'Most visits' },
  { value: 'created_desc', label: 'Recently added' },
];

export interface ClientsSectionProps {
  venueId: string;
  terminology: VenueTerminology;
  bookingModel: BookingModel;
  /** Aligns with reports overview: Appointments SKU or USE primary/tab — not `booking_model` alone. */
  appointmentDashboardExperience: boolean;
  clientSummary: ClientSummary | null;
  rangeLabel: string;
  onReportsRefresh: () => void;
}

export function ClientsSection({
  venueId,
  terminology,
  bookingModel: _bookingModel,
  appointmentDashboardExperience,
  clientSummary,
  rangeLabel,
  onReportsRefresh,
}: ClientsSectionProps) {
  const isAppointment = appointmentDashboardExperience;
  const clientWord = terminology.client;
  const clientLower = clientWord.toLowerCase();
  const bookingWord = terminology.booking;
  const visitsLabel = isAppointment ? `${bookingWord}s (lifecycle)` : 'Visit count';
  const totalBookingsLabel = `Total ${bookingWord.toLowerCase()}s`;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('last_visit_desc');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'identified' | 'all' | 'anonymous'>('identified');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [venueTags, setVenueTags] = useState<string[]>([]);
  const [guests, setGuests] = useState<GuestListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GuestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [eraseLoadingId, setEraseLoadingId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadVenueTags = useCallback(async () => {
    try {
      const res = await fetch('/api/venue/guests/tags');
      if (!res.ok) return;
      const data = (await res.json()) as { tags?: string[] };
      setVenueTags(Array.isArray(data.tags) ? data.tags : []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadVenueTags();
  }, [loadVenueTags]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort,
        page: String(page),
        limit: String(limit),
        filter,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (tagFilter.length) params.set('tags', tagFilter.join(','));
      const res = await fetch(`/api/venue/guests?${params}`);
      const data = (await res.json()) as {
        guests?: GuestListRow[];
        total_count?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load list');
      }
      setGuests(data.guests ?? []);
      setTotalCount(data.total_count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setGuests([]);
    } finally {
      setLoading(false);
    }
  }, [sort, page, limit, debouncedSearch, tagFilter, filter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (guestId: string) => {
    setDetailLoading(true);
    setDetail(null);
    setEditError(null);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}`);
      const data = (await res.json()) as GuestDetailResponse & { error?: string };
      if (!res.ok) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load guest');
      }
      setDetail(data);
      setEditName(data.guest.name ?? '');
      setEditEmail(data.guest.email ?? '');
      setEditPhone(data.guest.phone ?? '');
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!expandedId) {
      setDetail(null);
      return;
    }
    void loadDetail(expandedId);
  }, [expandedId, loadDetail]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setPage(0);
  }, []);

  const onSaveGuestDetails = useCallback(async () => {
    if (!detail) return;
    const name = editName.trim();
    if (!name) {
      setEditError('Name is required.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/venue/guests/${detail.guest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: editEmail.trim(),
          phone: editPhone.trim(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Save failed');
      }
      await loadDetail(detail.guest.id);
      await loadList();
      onReportsRefresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }, [detail, editName, editEmail, editPhone, loadDetail, loadList, onReportsRefresh]);

  const exportGuestHistory = useCallback(() => {
    if (!detail?.booking_history.length) return;
    const headers = ['Date', 'Time', 'Service', 'Covers', 'Status', 'Deposit', 'Practitioner'];
    const rows = detail.booking_history.map((b) => [
      b.booking_date,
      b.booking_time,
      b.service_name ?? '-',
      String(b.party_size ?? '-'),
      b.status,
      b.deposit_status ?? '-',
      b.practitioner_name ?? '-',
    ]);
    downloadCsvString(buildCsvFromRows(headers, rows), `guest-${detail.guest.id}-bookings.csv`);
  }, [detail]);

  const onEraseGuest = useCallback(
    async (guestId: string) => {
      const ok = window.confirm(
        `Erase personal data for this ${clientLower}? Bookings are kept but contact details are removed. This cannot be undone.`,
      );
      if (!ok) return;
      setEraseLoadingId(guestId);
      setError(null);
      try {
        const res = await fetch('/api/venue/gdpr/erase-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_id: guestId }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(typeof j.error === 'string' ? j.error : 'Erase failed');
        }
        setExpandedId(null);
        setDetail(null);
        await loadList();
        onReportsRefresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erase failed');
      } finally {
        setEraseLoadingId(null);
      }
    },
    [clientLower, loadList, onReportsRefresh],
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const summary = clientSummary ?? {
    identified_clients_total: 0,
    new_clients_in_period: 0,
    returning_clients_in_period: 0,
    anonymous_visits_in_period: 0,
  };

  const emptyCopy = useMemo(
    () => `No ${clientLower} match this list. Try another filter or search.`,
    [clientLower],
  );

  const displayName = (g: GuestListRow): string => {
    if (filter === 'anonymous' || g.identifiability_tier === 'anonymous') {
      return 'Anonymous';
    }
    return g.name?.trim() || 'Unnamed';
  };

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="CRM"
        title={`${clientWord} directory`}
        description={rangeLabel}
        right={
          <a
            href="/api/venue/export?type=guests"
            className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Export CSV
          </a>
        }
      />
      <SectionCard.Body className="space-y-6">
      <p className="text-sm text-slate-600">
        Looking for filters, CSV export of the current view, and communications history?{' '}
        <Link href="/dashboard/contacts" className="font-semibold text-brand-700 hover:text-brand-900">
          Open Contacts
        </Link>
        .
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={`Known ${clientLower}s (all-time)`}
          value={String(summary.identified_clients_total)}
          color="slate"
        />
        <StatTile
          label="New this period"
          value={String(summary.new_clients_in_period)}
          color="emerald"
          subValue={rangeLabel}
        />
        <StatTile
          label="Returning this period"
          value={String(summary.returning_clients_in_period)}
          color="brand"
          subValue={rangeLabel}
        />
        <StatTile
          label={isAppointment ? `Anonymous ${bookingWord.toLowerCase()}s (period)` : 'Anonymous visits (period)'}
          value={String(summary.anonymous_visits_in_period)}
          color="amber"
          subValue={rangeLabel}
        />
      </div>
      {summary.anonymous_visits_in_period > 0 && (
        <p className="text-sm text-slate-500">
          Walk-in visits without contact details are counted but not shown in the {clientLower} list below.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="clients-search" className="mb-1 block text-xs font-medium text-slate-500">
            Search
          </label>
          <input
            id="clients-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Name, email, or phone"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="clients-filter" className="mb-1 block text-xs font-medium text-slate-500">
            Show
          </label>
          <select
            id="clients-filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as 'identified' | 'all' | 'anonymous');
              setPage(0);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="identified">With contact (CRM)</option>
            <option value="all">All except walk-ins</option>
            <option value="anonymous">Walk-ins only</option>
          </select>
        </div>
        <div className="w-full sm:w-56">
          <label htmlFor="clients-sort" className="mb-1 block text-xs font-medium text-slate-500">
            Sort
          </label>
          <select
            id="clients-sort"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(0);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {venueTags.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Filter by tags</p>
          <div className="flex flex-wrap gap-2">
            {venueTags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => toggleTagFilter(t)}
                className={`min-h-10 rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                  tagFilter.includes(t)
                    ? 'bg-brand-600 text-white'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <DashboardListSkeleton rowCount={7} />
      ) : guests.length === 0 ? (
        <EmptyState title={`No matching ${clientLower}s`} description={emptyCopy} />
      ) : (
        <>
          <HorizontalScrollHint />
          <div className="touch-pan-x overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{clientWord}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Email</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Phone</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{totalBookingsLabel}</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{visitsLabel}</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Last visit</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {guests.map((g) => {
                  const open = expandedId === g.id;
                  const isAnonRow = filter === 'anonymous' || g.identifiability_tier === 'anonymous';
                  return (
                    <Fragment key={g.id}>
                      <tr className="hover:bg-slate-50/80">
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => setExpandedId(open ? null : g.id)}
                            className={`text-left font-medium text-slate-900 ${isAnonRow ? 'italic text-slate-500' : ''}`}
                          >
                            {displayName(g)}
                          </button>
                        </td>
                        <td className="max-w-[160px] truncate px-3 py-2.5 text-slate-600">{g.email ?? '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{g.phone ?? '-'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">{g.total_bookings}</td>
                        <td className="px-3 py-2.5 text-right text-slate-700">
                          <span className="tabular-nums">{g.visit_count}</span>
                          {g.no_show_count > 0 && (
                            <span className="ml-1 text-xs font-medium text-red-600">{g.no_show_count} NS</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{g.last_visit_date ?? '-'}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <Link
                              href={`/dashboard/bookings?guest=${encodeURIComponent(g.id)}`}
                              className="font-medium text-brand-600 hover:text-brand-800"
                            >
                              View {bookingWord.toLowerCase()}s
                            </Link>
                            {!isAnonRow && (
                              <button
                                type="button"
                                disabled={eraseLoadingId === g.id}
                                onClick={() => void onEraseGuest(g.id)}
                                className="font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                              >
                                {eraseLoadingId === g.id ? 'Erasing…' : 'Erase'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${g.id}-detail`} className="bg-slate-50/50">
                          <td colSpan={7} className="px-3 py-4">
                            {detailLoading && <p className="text-sm text-slate-500">Loading details…</p>}
                            {editError && !detailLoading && <p className="mb-2 text-sm text-red-600">{editError}</p>}
                            {detail && !detailLoading && detail.guest.id === g.id && (
                              <div className="grid gap-4 lg:grid-cols-2">
                                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                                  <h3 className="text-sm font-semibold text-slate-800">Contact</h3>
                                  <div className="space-y-2">
                                    <label className="block text-xs font-medium text-slate-500">Name</label>
                                    <input
                                      value={editName}
                                      onChange={(e) => setEditName(e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    />
                                    <label className="block text-xs font-medium text-slate-500">Email</label>
                                    <input
                                      type="email"
                                      value={editEmail}
                                      onChange={(e) => setEditEmail(e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    />
                                    <label className="block text-xs font-medium text-slate-500">Phone</label>
                                    <input
                                      value={editPhone}
                                      onChange={(e) => setEditPhone(e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    />
                                    <button
                                      type="button"
                                      disabled={editSaving}
                                      onClick={() => void onSaveGuestDetails()}
                                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                                    >
                                      {editSaving ? 'Saving…' : 'Save details'}
                                    </button>
                                  </div>
                                  <GuestTagEditor
                                    tags={detail.guest.tags}
                                    venueId={venueId}
                                    onTagsChange={async (next) => {
                                      const res = await fetch(`/api/venue/guests/${detail.guest.id}`, {
                                        method: 'PATCH',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ tags: next }),
                                      });
                                      if (!res.ok) {
                                        const j = (await res.json().catch(() => ({}))) as { error?: string };
                                        throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                                      }
                                      await loadDetail(detail.guest.id);
                                      await loadList();
                                      onReportsRefresh();
                                    }}
                                  />
                                </div>
                                <div className="space-y-3">
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    <StatMini label={totalBookingsLabel} value={String(detail.stats.total_bookings)} />
                                    <StatMini label="Cancellations" value={String(detail.stats.cancellations)} />
                                    <StatMini label="No-shows" value={String(detail.stats.no_shows)} />
                                    <StatMini
                                      label="Deposits paid"
                                      value={`£${(detail.stats.total_deposit_pence_paid / 100).toFixed(2)}`}
                                    />
                                    <StatMini label="First visit" value={detail.stats.first_visit_date ?? '-'} />
                                    <StatMini label="Last visit" value={detail.stats.last_visit_date ?? '-'} />
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      onClick={exportGuestHistory}
                                      disabled={detail.booking_history.length === 0}
                                      className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                    >
                                      Export history (CSV)
                                    </button>
                                  </div>
                                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                                    <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                                      Recent {bookingWord.toLowerCase()}s
                                    </h3>
                                    <ul className="max-h-64 divide-y divide-slate-50 overflow-y-auto">
                                      {detail.booking_history.map((b) => (
                                        <li key={b.id}>
                                          <Link
                                            href={`/dashboard/bookings?openBooking=${encodeURIComponent(b.id)}`}
                                            className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-slate-50"
                                          >
                                            <span className="font-medium text-slate-900">
                                              {b.booking_date} {b.booking_time}
                                            </span>
                                            <span className="text-xs text-slate-600">
                                              <span className="font-medium text-slate-700">{b.kind_label}</span>
                                              {' · '}
                                              {b.detail_label} · {b.status}
                                              {b.practitioner_name ? ` · ${b.practitioner_name}` : ''}
                                            </span>
                                          </Link>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {page + 1} of {totalPages} ({totalCount} total)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-10 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      </SectionCard.Body>
    </SectionCard>
  );
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-white px-2 py-2 text-center shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}
