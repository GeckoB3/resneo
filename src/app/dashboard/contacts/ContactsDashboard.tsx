'use client';

import { useCallback, useEffect, useState } from 'react';
import { buildCsvFromRows, downloadCsvString } from '@/lib/appointments-csv';
import type { VenueTerminology } from '@/types/booking-models';
import type { CustomClientFieldDefinition, GuestDetailResponse, GuestListRow } from '@/types/contacts';
import { CONTACTS_LIFECYCLE_OPTIONS, CONTACTS_SORT_OPTIONS } from '@/lib/guests/contacts-constants';
import { formatRelativeVisitDate } from '@/lib/guests/contact-formatting';
import { HorizontalScrollHint } from '@/components/ui/HorizontalScrollHint';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { PageHeader } from '@/components/ui/dashboard/PageHeader';
import { Pill } from '@/components/ui/dashboard/Pill';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { MergeContactsModal } from '@/components/dashboard/contacts/MergeContactsModal';

export type { GuestListRow } from '@/types/contacts';

export function ContactsDashboard({
  venueId,
  currency,
  terminology,
  appointmentDashboardExperience,
  isAdmin,
}: {
  venueId: string;
  currency: string;
  terminology: VenueTerminology;
  appointmentDashboardExperience: boolean;
  isAdmin: boolean;
}) {
  const isAppointment = appointmentDashboardExperience;
  const clientWord = terminology.client;
  const clientLower = clientWord.toLowerCase();
  const bookingWord = terminology.booking;
  const visitsLabel = isAppointment ? `${bookingWord}s (lifecycle)` : 'Visits';
  const currencySymbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '£';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('last_visit_desc');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'identified' | 'all' | 'anonymous'>('identified');
  const [lifecycle, setLifecycle] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [venueTags, setVenueTags] = useState<string[]>([]);
  const [guests, setGuests] = useState<GuestListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GuestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [eraseLoadingId, setEraseLoadingId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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

  useEffect(() => {
    setSelectedIds([]);
  }, [page, debouncedSearch, filter, lifecycle, tagFilter]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const togglePageSelection = useCallback(() => {
    const pageIds = guests.map((g) => g.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
    }
  }, [guests, selectedIds]);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        sort,
        page: String(page),
        limit: String(limit),
        filter,
        status: lifecycle,
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
  }, [sort, page, limit, debouncedSearch, tagFilter, filter, lifecycle]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const runBulkAddTag = useCallback(async () => {
    const tag = window.prompt('Tag to add to selected contacts?');
    if (!tag?.trim()) return;
    setBulkBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/contacts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_tag', guest_ids: selectedIds, tag: tag.trim() }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Bulk action failed');
      setSelectedIds([]);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, loadList]);

  const loadDetail = useCallback(async (guestId: string) => {
    setDetailLoading(true);
    setDetail(null);
    setEditError(null);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}?booking_history_limit=80`);
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
    if (!selectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const openContact = useCallback((id: string) => {
    setSelectedId(id);
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setSelectedId(null);
    setDetail(null);
  }, []);

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
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }, [detail, editName, editEmail, editPhone, loadDetail, loadList]);

  const exportFilteredCsv = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      const cfRes = await fetch('/api/venue/contacts/custom-fields');
      const cfData = (await cfRes.json()) as { fields?: CustomClientFieldDefinition[] };
      const activeFields = (cfData.fields ?? []).filter((f) => f.is_active);

      const all: GuestListRow[] = [];
      const maxPages = 120;
      for (let p = 0; p < maxPages; p += 1) {
        const params = new URLSearchParams({
          sort,
          page: String(p),
          limit: '50',
          filter,
          status: lifecycle,
          include_custom_fields: '1',
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (tagFilter.length) params.set('tags', tagFilter.join(','));
        const res = await fetch(`/api/venue/guests?${params}`);
        const data = (await res.json()) as { guests?: GuestListRow[]; error?: string };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Export failed');
        }
        const chunk = data.guests ?? [];
        all.push(...chunk);
        if (chunk.length < 50) break;
      }
      const headers = [
        'Name',
        'Email',
        'Phone',
        'Tags',
        'Visits',
        'No-shows',
        'Last visit',
        'Total bookings',
        'Upcoming',
        'Cancelled',
        `Paid deposits (${currency})`,
        'Marketing consent',
        'Marketing opt-out',
        ...activeFields.map((f) => `CF: ${f.field_name}`),
      ];
      const rows: string[][] = all.map((g) => {
        const tags = g.tags?.length ? g.tags.join('; ') : '';
        const dep = (g.paid_deposit_pence ?? 0) / 100;
        const cf = g.custom_fields ?? {};
        const cfCols = activeFields.map((f) => {
          const v = cf[f.field_key];
          if (v === null || v === undefined) return '';
          return typeof v === 'object' ? JSON.stringify(v) : String(v);
        });
        return [
          g.name ?? '',
          g.email ?? '',
          g.phone ?? '',
          tags,
          String(g.visit_count),
          String(g.no_show_count),
          g.last_visit_date ?? '',
          String(g.total_bookings),
          String(g.upcoming_booking_count ?? 0),
          String(g.cancelled_count ?? 0),
          dep.toFixed(2),
          g.marketing_consent ? 'yes' : 'no',
          g.marketing_opt_out ? 'yes' : 'no',
          ...cfCols,
        ];
      });
      downloadCsvString(buildCsvFromRows(headers, rows), `contacts-export-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [sort, filter, lifecycle, debouncedSearch, tagFilter, currency]);

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
        closePanel();
        await loadList();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erase failed');
      } finally {
        setEraseLoadingId(null);
      }
    },
    [clientLower, loadList, closePanel],
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const hasActiveFilters = Boolean(debouncedSearch || tagFilter.length || lifecycle !== 'all' || filter !== 'identified');

  const displayName = (g: GuestListRow): string => {
    if (filter === 'anonymous' || g.identifiability_tier === 'anonymous') {
      return 'Anonymous';
    }
    return g.name?.trim() || 'Unnamed';
  };

  const emptyTitle =
    !hasActiveFilters && !debouncedSearch && guests.length === 0 && !loading
      ? `No ${clientLower}s yet`
      : 'No matches';
  const emptyDescription =
    !hasActiveFilters && !debouncedSearch && guests.length === 0 && !loading
      ? `No ${clientLower}s yet. They’ll appear here automatically as ${bookingWord.toLowerCase()}s come in.`
      : 'No clients match your search. Try another filter or search.';

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
      <PageHeader
        eyebrow="CRM"
        title="Contacts"
        subtitle={`Search, filter, and manage everyone who has booked with you. ${clientWord} labels follow your venue terminology.`}
        actions={
          <button
            type="button"
            disabled={exporting || loading}
            onClick={() => void exportFilteredCsv()}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile label={`Known ${clientLower}s (this list)`} value={String(totalCount)} color="slate" />
        <StatTile
          label="Filters"
          value={lifecycle === 'all' ? 'All statuses' : CONTACTS_LIFECYCLE_OPTIONS.find((o) => o.value === lifecycle)?.label ?? ''}
          color="brand"
        />
        <StatTile label="Page" value={`${page + 1} / ${totalPages}`} color="emerald" />
      </div>

      <SectionCard elevated className="mt-6">
        <SectionCard.Header eyebrow="Directory" title={`${clientWord} list`} />
        <SectionCard.Body className="space-y-6">
          <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/40 p-4 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="contacts-search" className="mb-1 block text-xs font-medium text-slate-500">
                Search
              </label>
              <input
                id="contacts-search"
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
              <label htmlFor="contacts-filter" className="mb-1 block text-xs font-medium text-slate-500">
                Show
              </label>
              <select
                id="contacts-filter"
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
            <div className="w-full min-w-[12rem] sm:w-56">
              <label htmlFor="contacts-lifecycle" className="mb-1 block text-xs font-medium text-slate-500">
                Status
              </label>
              <select
                id="contacts-lifecycle"
                value={lifecycle}
                onChange={(e) => {
                  setLifecycle(e.target.value);
                  setPage(0);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {CONTACTS_LIFECYCLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full min-w-[12rem] sm:w-64">
              <label htmlFor="contacts-sort" className="mb-1 block text-xs font-medium text-slate-500">
                Sort
              </label>
              <select
                id="contacts-sort"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(0);
                }}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {CONTACTS_SORT_OPTIONS.map((o) => (
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

          {selectedIds.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-brand-200 bg-brand-50/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium text-slate-800">{selectedIds.length} selected</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulkAddTag()}
                  className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Add tag…
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => setSelectedIds([])}
                  className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                >
                  Clear selection
                </button>
              </div>
            </div>
          ) : null}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          {loading ? (
            <DashboardListSkeleton rowCount={7} />
          ) : guests.length === 0 ? (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          ) : (
            <>
              <HorizontalScrollHint />
              <div className="touch-pan-x overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-900/5">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50/60">
                    <tr>
                      <th className="w-10 px-2 py-2 text-left">
                        <input
                          type="checkbox"
                          aria-label="Select all on this page"
                          checked={guests.length > 0 && guests.every((g) => selectedIds.includes(g.id))}
                          onChange={() => togglePageSelection()}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">{clientWord}</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">{visitsLabel}</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Last visit</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-slate-500">Deposits</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Tags</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">Indicators</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {guests.map((g) => {
                      const isAnonRow = filter === 'anonymous' || g.identifiability_tier === 'anonymous';
                      const active = selectedId === g.id && panelOpen;
                      return (
                        <tr
                          key={g.id}
                          className={`cursor-pointer hover:bg-slate-50/80 ${active ? 'bg-brand-50/40' : ''}`}
                          onClick={() => openContact(g.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openContact(g.id);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-expanded={active}
                        >
                          <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select ${displayName(g)}`}
                              checked={selectedIds.includes(g.id)}
                              onChange={() => toggleSelected(g.id)}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <div className={`font-medium text-slate-900 ${isAnonRow ? 'italic text-slate-500' : ''}`}>
                              {displayName(g)}
                            </div>
                            <div className="mt-0.5 max-w-[240px] truncate text-xs text-slate-500">
                              {[g.email, g.phone].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                            <span>{g.visit_count}</span>
                            {g.no_show_count > 0 && (
                              <span className="ml-1 text-xs font-medium text-red-600">{g.no_show_count} NS</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                            {formatRelativeVisitDate(g.last_visit_date)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                            {currencySymbol}
                            {((g.paid_deposit_pence ?? 0) / 100).toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex max-w-[200px] flex-wrap gap-1">
                              {(g.tags ?? []).slice(0, 4).map((t) => (
                                <Pill key={t} variant="neutral" size="sm" className="max-w-[120px] truncate">
                                  {t}
                                </Pill>
                              ))}
                              {(g.tags?.length ?? 0) > 4 ? (
                                <span className="text-xs text-slate-400">+{g.tags!.length - 4}</span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex flex-wrap gap-1">
                              {(g.upcoming_booking_count ?? 0) > 0 && (
                                <Pill variant="info" size="sm">
                                  Upcoming ×{g.upcoming_booking_count}
                                </Pill>
                              )}
                              {(g.cancelled_count ?? 0) > 0 && (
                                <Pill variant="warning" size="sm">
                                  Cancelled {g.cancelled_count}
                                </Pill>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
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
      </div>

      {/* Mobile backdrop */}
      {panelOpen ? (
        <button
          type="button"
          aria-label="Close contact details"
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={closePanel}
        />
      ) : null}

      {/* Detail drawer / panel */}
      {panelOpen && selectedId ? (
        <aside
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl lg:sticky lg:top-4 lg:z-auto lg:h-[calc(100dvh-5rem)] lg:max-h-[calc(100dvh-5rem)] lg:w-[420px] lg:max-w-[420px] lg:shrink-0 lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-lg xl:w-[460px] xl:max-w-[460px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="contact-panel-title"
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 lg:rounded-t-2xl lg:border lg:border-b-0 lg:border-slate-200">
            <h2 id="contact-panel-title" className="text-lg font-semibold text-slate-900">
              {clientWord} details
            </h2>
            <button
              type="button"
              onClick={closePanel}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              aria-label="Close"
            >
              <span aria-hidden>✕</span>
            </button>
          </div>
          <ContactDetailPanel
            clientLower={clientLower}
            bookingWord={bookingWord}
            currencySymbol={currencySymbol}
            venueId={venueId}
            isAdmin={isAdmin}
            selectedId={selectedId}
            detail={detail}
            detailLoading={detailLoading}
            editError={editError}
            editName={editName}
            setEditName={setEditName}
            editEmail={editEmail}
            setEditEmail={setEditEmail}
            editPhone={editPhone}
            setEditPhone={setEditPhone}
            editSaving={editSaving}
            onSaveGuestDetails={onSaveGuestDetails}
            loadDetail={loadDetail}
            loadList={loadList}
            eraseLoadingId={eraseLoadingId}
            onEraseGuest={onEraseGuest}
            onOpenMerge={isAdmin ? () => setMergeOpen(true) : undefined}
          />
        </aside>
      ) : null}

      {mergeOpen && selectedId && isAdmin ? (
        <MergeContactsModal
          targetGuestId={selectedId}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            void loadDetail(selectedId);
            void loadList();
            setMergeOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
