'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildCsvFromRows, downloadCsvString } from '@/lib/appointments-csv';
import type { VenueTerminology } from '@/types/booking-models';
import type { CustomClientFieldDefinition, GuestDetailResponse, GuestListRow } from '@/types/contacts';
import { CONTACTS_LIFECYCLE_OPTIONS, CONTACTS_SORT_OPTIONS } from '@/lib/guests/contacts-constants';
import { formatRelativeVisitDate } from '@/lib/guests/contact-formatting';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { Pill } from '@/components/ui/dashboard/Pill';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { MergeContactsModal } from '@/components/dashboard/contacts/MergeContactsModal';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';

export type { GuestListRow } from '@/types/contacts';

const CONTACT_SHOW_OPTIONS: Array<{ value: 'identified' | 'all' | 'anonymous'; label: string }> = [
  { value: 'identified', label: 'With contact (CRM)' },
  { value: 'all', label: 'All except walk-ins' },
  { value: 'anonymous', label: 'Walk-ins only' },
];

const CONTACTS_TOOLBAR_SUMMARY_STUB: ViewToolbarSummary = {
  total_covers_booked: 0,
  total_covers_capacity: 0,
  tables_in_use: 0,
  tables_total: 0,
  unassigned_count: 0,
  combos_in_use: 0,
};

function isoDateToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function formatNextAppt(date: string | null | undefined, time: string | null | undefined): string | null {
  if (!date) return null;
  try {
    const d = new Date(`${date}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let dayStr: string;
    if (d.toDateString() === today.toDateString()) {
      dayStr = 'Today';
    } else if (d.toDateString() === tomorrow.toDateString()) {
      dayStr = 'Tomorrow';
    } else {
      dayStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    }
    const timeStr = time ? time.slice(0, 5) : null;
    return timeStr ? `${dayStr} ${timeStr}` : dayStr;
  } catch {
    return null;
  }
}

function ContactRow({
  row: g,
  displayNameStr,
  isAnonRow,
  active,
  selected,
  visitsLabel,
  onOpen,
  onToggleSelected,
}: {
  row: GuestListRow;
  displayNameStr: string;
  isAnonRow: boolean;
  active: boolean;
  selected: boolean;
  visitsLabel: string;
  onOpen: () => void;
  onToggleSelected: () => void;
}) {
  const email = g.email?.trim() || null;
  const phone = g.phone?.trim() || null;
  const nextAppt = formatNextAppt(g.next_booking_date, g.next_booking_time);
  const tags = g.tags ?? [];
  const MAX_TAGS = 3;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={active}
      onClick={() => onOpen()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className={`cursor-pointer rounded-xl border px-2 py-1.5 shadow-sm ring-1 ring-slate-900/[0.04] transition-[border-color,box-shadow,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/35 focus-visible:ring-offset-2 sm:px-3 sm:py-2 ${
        active
          ? 'border-brand-200 bg-brand-50/50 shadow-md ring-brand-900/10'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 hover:shadow-md'
      }`}
    >
      <div className="flex min-h-[2.25rem] min-w-0 items-center gap-1.5 sm:min-h-[2.5rem] sm:gap-2">
        {/* Checkbox */}
        <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected()}
            aria-label={`Select ${displayNameStr}`}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
        </div>

        {/* Main info row — wraps naturally */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12px] sm:text-[13px]">
            {/* Name — always visible, anchors the row */}
            <span className={`shrink-0 max-w-[10rem] truncate font-semibold text-slate-900 sm:max-w-[13rem] lg:max-w-[10rem] xl:max-w-[13rem] ${isAnonRow ? 'italic text-slate-500' : ''}`}>
              {displayNameStr}
            </span>

            {/* Phone — always show if available */}
            {phone ? (
              <>
                <span className="shrink-0 text-slate-300" aria-hidden>·</span>
                <span className="shrink-0 tabular-nums text-slate-600">{phone}</span>
              </>
            ) : null}

            {/* Email — hidden on xs, visible sm+ */}
            {email ? (
              <>
                <span className="hidden shrink-0 text-slate-300 sm:inline" aria-hidden>·</span>
                <span className="hidden min-w-0 max-w-[12rem] truncate text-slate-500 sm:inline lg:max-w-[9rem] xl:max-w-[12rem]">{email}</span>
              </>
            ) : null}

            {/* Separator */}
            <span className="shrink-0 text-slate-300" aria-hidden>·</span>

            {/* Visits */}
            <span className="shrink-0 tabular-nums text-slate-600" title={visitsLabel}>
              {g.visit_count}v
              {g.no_show_count > 0 ? <span className="ml-0.5 font-medium text-red-500">{` · ${g.no_show_count} NS`}</span> : null}
            </span>

            {/* Last visit — hidden on xs */}
            {g.last_visit_date ? (
              <>
                <span className="hidden shrink-0 text-slate-300 sm:inline" aria-hidden>·</span>
                <span className="hidden shrink-0 text-slate-500 sm:inline">{formatRelativeVisitDate(g.last_visit_date)}</span>
              </>
            ) : null}

            {/* Next appointment pill — always show if exists */}
            {nextAppt ? (
              <Pill variant="info" size="sm" className="shrink-0">
                {nextAppt}
              </Pill>
            ) : null}

            {/* Tags — show up to MAX_TAGS, collapse rest */}
            {tags.slice(0, MAX_TAGS).map((t) => (
              <Pill key={t} variant="neutral" size="sm" className="hidden shrink-0 max-w-[7rem] truncate sm:inline-flex">
                {t}
              </Pill>
            ))}
            {/* On mobile show just first tag if no appt */}
            {!nextAppt && tags.length > 0 ? (
              <Pill variant="neutral" size="sm" className="shrink-0 max-w-[7rem] truncate sm:hidden">
                {tags[0]}
              </Pill>
            ) : null}
            {tags.length > MAX_TAGS ? (
              <span className="hidden shrink-0 text-[11px] tabular-nums text-slate-400 sm:inline">+{tags.length - MAX_TAGS}</span>
            ) : null}
          </div>
        </div>

        {/* Chevron */}
        <svg
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${active ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </div>
    </div>
  );
}

function ContactsToolbarOptionPopover({
  toolbarPanelAnchorRef,
  triggerRef,
  triggerText,
  panelHeading,
  open,
  onDismiss,
  onTriggerClick,
  isDirty,
  panelId,
  triggerAriaLabel,
  children,
}: {
  toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerText: string;
  panelHeading: string;
  open: boolean;
  onDismiss: () => void;
  onTriggerClick: () => void;
  isDirty: boolean;
  panelId: string;
  triggerAriaLabel: string;
  children: ReactNode;
}) {
  const emphasize = open || isDirty;
  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={onTriggerClick}
        className={`inline-flex min-h-8 shrink-0 items-center gap-0.5 rounded-lg border px-2 py-1 text-[11px] font-semibold shadow-sm hover:bg-slate-50 sm:text-xs ${
          emphasize
            ? 'border-brand-300 bg-brand-50 text-brand-800 ring-1 ring-brand-200'
            : 'border-slate-200 bg-white text-slate-700'
        }`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-label={triggerAriaLabel}
      >
        <span className="max-w-[min(42vw,7.5rem)] truncate sm:max-w-[9.5rem]" title={triggerText}>
          {triggerText}
        </span>
        <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      <ClampedFixedDropdown
        open={open}
        triggerRef={triggerRef}
        verticalAnchorRef={toolbarPanelAnchorRef}
        horizontalCenter
        gapPx={4}
        align="start"
        maxWidthPx={320}
        id={panelId}
        onDismiss={onDismiss}
        aria-label={panelHeading}
        className="animate-fade-in z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-100"
      >
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{panelHeading}</p>
        <div className="space-y-0.5">{children}</div>
      </ClampedFixedDropdown>
    </div>
  );
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
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
  const [bulkContactMessageOpen, setBulkContactMessageOpen] = useState(false);
  const [bulkContactMessageSending, setBulkContactMessageSending] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filterPopoverKind, setFilterPopoverKind] = useState<'none' | 'show' | 'status' | 'sort'>('none');
  const showFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const statusFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const sortFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const contactsToolbarPanelsId = useId();

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

  const runBulkContactMessage = useCallback(
    async (message: string, channel: GuestMessageChannel) => {
      if (selectedIds.length === 0) return;
      setBulkContactMessageSending(true);
      setError(null);
      try {
        const outcomes = await Promise.all(
          selectedIds.map(async (guestId) => {
            try {
              const res = await fetch(`/api/venue/guests/${guestId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, channel }),
              });
              const payload = (await res.json().catch(() => ({}))) as {
                success?: boolean;
                error?: string;
                errors?: string[];
              };
              const sent = Boolean(res.ok && payload.success);
              const issues =
                payload.errors && payload.errors.length > 0
                  ? payload.errors.join('; ')
                  : payload.error ?? null;
              return { sent, issues, guestId };
            } catch {
              return { sent: false, issues: 'Request failed', guestId };
            }
          }),
        );
        const okCount = outcomes.filter((o) => o.sent).length;
        const failureSummaries = outcomes
          .filter((o) => !o.sent && o.issues)
          .slice(0, 5)
          .map((o) => {
            const name = guests.find((g) => g.id === o.guestId)?.name?.trim();
            return `${name || clientWord}: ${o.issues}`;
          });
        if (okCount === selectedIds.length) {
          addToast(`Message sent to ${okCount} ${clientLower}${okCount === 1 ? '' : 's'}`, 'success');
        } else if (okCount > 0) {
          const preview = failureSummaries.slice(0, 2).join(' · ');
          setError(`Sent to ${okCount}/${selectedIds.length}. ${preview}`);
          addToast(`Sent to ${okCount}/${selectedIds.length}`, 'error');
        } else {
          const first = failureSummaries[0] ?? 'No messages were sent.';
          setError(first);
          addToast(first, 'error');
        }
        setSelectedIds([]);
        setBulkContactMessageOpen(false);
        await loadList();
      } finally {
        setBulkContactMessageSending(false);
      }
    },
    [addToast, clientLower, clientWord, guests, loadList, selectedIds],
  );

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

  useEffect(() => {
    const guestIdFromQuery = searchParams.get('guest')?.trim();
    if (!guestIdFromQuery) return;
    openContact(guestIdFromQuery);
    router.replace('/dashboard/contacts', { scroll: false });
  }, [openContact, router, searchParams]);

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

  const toolbarDatePlaceholder = isoDateToday();

  const contactsSummaryContent = useMemo(
    () => (
      <div className="flex flex-wrap items-center gap-1 text-[11px] sm:gap-1.5 sm:text-xs" aria-label="Directory overview">
        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
          <span className="font-normal text-slate-500">Directory</span>
          <span className="tabular-nums">{totalCount}</span>
        </span>
        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
          <span className="font-normal text-slate-500">Page</span>
          <span className="tabular-nums">{page + 1}</span>
          <span className="text-slate-400">/</span>
          <span className="tabular-nums">{totalPages}</span>
        </span>
        {lifecycle !== 'all' ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
            <span className="font-normal text-slate-500">Status</span>
            <span>{CONTACTS_LIFECYCLE_OPTIONS.find((o) => o.value === lifecycle)?.label ?? lifecycle}</span>
          </span>
        ) : null}
        {filter !== 'identified' ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
            <span className="font-normal text-slate-500">Show</span>
            <span className="max-w-full min-w-0 break-words">
              {CONTACT_SHOW_OPTIONS.find((o) => o.value === filter)?.label ?? filter}
            </span>
          </span>
        ) : null}
        {debouncedSearch ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-brand-100 bg-brand-50/80 px-1.5 py-0.5 font-medium text-brand-900">
            <span className="font-normal text-brand-700/80">Search</span>
            <span className="max-w-full min-w-0 break-all sm:break-words" title={debouncedSearch}>
              {debouncedSearch}
            </span>
          </span>
        ) : null}
        {tagFilter.length > 0 ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
            <span className="font-normal text-slate-500">Tags</span>
            <span>{tagFilter.length}</span>
          </span>
        ) : null}
      </div>
    ),
    [totalCount, page, totalPages, lifecycle, filter, debouncedSearch, tagFilter.length],
  );

  const selectRowClass = (selected: boolean) =>
    selected
      ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
      : 'text-slate-800 hover:bg-slate-50';

  const contactsToolbarTools = useCallback(
    (toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => (
      <>
        <ContactsToolbarOptionPopover
          toolbarPanelAnchorRef={toolbarPanelAnchorRef}
          triggerRef={showFilterTriggerRef}
          triggerText={CONTACT_SHOW_OPTIONS.find((o) => o.value === filter)?.label ?? 'Show'}
          panelHeading="Show"
          open={filterPopoverKind === 'show'}
          onDismiss={() => setFilterPopoverKind('none')}
          onTriggerClick={() =>
            setFilterPopoverKind((k) => (k === 'show' ? 'none' : 'show'))
          }
          isDirty={filter !== 'identified'}
          panelId={`${contactsToolbarPanelsId}-show`}
          triggerAriaLabel="Show — CRM list scope"
        >
          <div role="radiogroup" aria-label="List scope">
            {CONTACT_SHOW_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={filter === o.value}
                onClick={() => {
                  setFilter(o.value);
                  setPage(0);
                  setFilterPopoverKind('none');
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${selectRowClass(filter === o.value)}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </ContactsToolbarOptionPopover>
        <ContactsToolbarOptionPopover
          toolbarPanelAnchorRef={toolbarPanelAnchorRef}
          triggerRef={statusFilterTriggerRef}
          triggerText={
            CONTACTS_LIFECYCLE_OPTIONS.find((o) => o.value === lifecycle)?.label ?? 'Status'
          }
          panelHeading="Status"
          open={filterPopoverKind === 'status'}
          onDismiss={() => setFilterPopoverKind('none')}
          onTriggerClick={() =>
            setFilterPopoverKind((k) => (k === 'status' ? 'none' : 'status'))
          }
          isDirty={lifecycle !== 'all'}
          panelId={`${contactsToolbarPanelsId}-status`}
          triggerAriaLabel="Status — lifecycle filter"
        >
          <div role="radiogroup" aria-label="Contact lifecycle">
            {CONTACTS_LIFECYCLE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={lifecycle === o.value}
                onClick={() => {
                  setLifecycle(o.value);
                  setPage(0);
                  setFilterPopoverKind('none');
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${selectRowClass(lifecycle === o.value)}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </ContactsToolbarOptionPopover>
        <ContactsToolbarOptionPopover
          toolbarPanelAnchorRef={toolbarPanelAnchorRef}
          triggerRef={sortFilterTriggerRef}
          triggerText={CONTACTS_SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Sort'}
          panelHeading="Sort"
          open={filterPopoverKind === 'sort'}
          onDismiss={() => setFilterPopoverKind('none')}
          onTriggerClick={() =>
            setFilterPopoverKind((k) => (k === 'sort' ? 'none' : 'sort'))
          }
          isDirty={sort !== 'last_visit_desc'}
          panelId={`${contactsToolbarPanelsId}-sort`}
          triggerAriaLabel="Sort directory"
        >
          <div role="radiogroup" aria-label="Sort list">
            {CONTACTS_SORT_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={sort === o.value}
                onClick={() => {
                  setSort(o.value);
                  setPage(0);
                  setFilterPopoverKind('none');
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${selectRowClass(sort === o.value)}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </ContactsToolbarOptionPopover>
      </>
    ),
    [
      filter,
      lifecycle,
      sort,
      filterPopoverKind,
      contactsToolbarPanelsId,
      setFilter,
      setLifecycle,
      setSort,
    ],
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
      <div className="min-w-0 w-full flex-1 space-y-3">
        <div className="min-w-0 space-y-3 pb-1">
          <OperationsWorkspaceToolbar
            title="Contacts"
            summary={CONTACTS_TOOLBAR_SUMMARY_STUB}
            summaryContent={contactsSummaryContent}
            date={toolbarDatePlaceholder}
            onDateChange={() => {}}
            datePickerPanel={null}
            liveState="live"
            onRefresh={() => void loadList()}
            onNewBooking={() => {}}
            onWalkIn={() => {}}
            compact
            showDateNavigator={false}
            showBookingActions={false}
            showControlsButton={false}
            controlsPanel={null}
            searchActive={search.trim().length > 0}
            searchAriaLabel="Search contacts"
            searchPanel={(
              <div className="space-y-2">
                <label htmlFor="contacts-toolbar-search" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search
                </label>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                    </svg>
                  </div>
                  <input
                    id="contacts-toolbar-search"
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(0);
                    }}
                    placeholder="Name, email, or phone"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
                  />
                </div>
                {search.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setPage(0);
                    }}
                    className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                  >
                    Clear search
                  </button>
                ) : null}
              </div>
            )}
            toolbarTools={contactsToolbarTools}
            trailingActions={(
              <button
                type="button"
                disabled={exporting || loading}
                onClick={() => void exportFilteredCsv()}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 sm:w-auto sm:px-2 sm:text-[11px] sm:font-semibold"
                aria-label="Export CSV"
              >
                <svg className="h-4 w-4 sm:hidden" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 12 12 16.5m0 0 4.5-4.5M12 16.5V3" />
                </svg>
                <span className="hidden sm:inline">{exporting ? 'Export…' : 'Export'}</span>
              </button>
            )}
          />
        </div>

        <SectionCard elevated className="min-w-0">
          <SectionCard.Header eyebrow="Directory" title={`${clientWord} list`} />
          <SectionCard.Body className="min-w-0 space-y-6">
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
                  disabled={bulkBusy || bulkContactMessageSending}
                  onClick={() => void runBulkAddTag()}
                  className="min-h-10 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Add tag…
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || bulkContactMessageSending}
                  onClick={() => setBulkContactMessageOpen(true)}
                  className="min-h-10 rounded-lg border border-slate-800/15 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Message
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || bulkContactMessageSending}
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
            <div className="space-y-3">
              {/* Select-all bar */}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-1.5">
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700">
                  <input
                    type="checkbox"
                    checked={guests.length > 0 && guests.every((g) => selectedIds.includes(g.id))}
                    onChange={() => togglePageSelection()}
                    aria-label="Select all on this page"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  Select all
                </label>
                <span className="text-[11px] font-medium text-slate-400">{guests.length} {guests.length === 1 ? clientLower : `${clientLower}s`}</span>
              </div>

              <div className="space-y-1.5" role="list" aria-label={`${clientWord} directory`}>
                {guests.map((g) => {
                  const isAnonRow = filter === 'anonymous' || g.identifiability_tier === 'anonymous';
                  const active = selectedId === g.id && panelOpen;
                  return (
                    <div key={g.id} role="listitem">
                      <ContactRow
                        row={g}
                        displayNameStr={displayName(g)}
                        isAnonRow={isAnonRow}
                        active={active}
                        selected={selectedIds.includes(g.id)}
                        visitsLabel={visitsLabel}
                        onOpen={() => openContact(g.id)}
                        onToggleSelected={() => toggleSelected(g.id)}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[13px]">
                  Page {page + 1} of {totalPages} · {totalCount} total
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="min-h-9 rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="min-h-9 rounded-xl border border-slate-200 bg-white px-4 py-1.5 text-sm font-medium shadow-sm disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
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

      {bulkContactMessageOpen && selectedIds.length > 0 ? (
        <BulkGuestMessageModal
          onClose={() => {
            if (!bulkContactMessageSending) setBulkContactMessageOpen(false);
          }}
          recipientCount={selectedIds.length}
          sending={bulkContactMessageSending}
          onSend={(msg, ch) => {
            void runBulkContactMessage(msg, ch);
          }}
          title={`Message ${selectedIds.length} ${clientWord}${selectedIds.length !== 1 ? 's' : ''}`}
          description={`The same message goes to each selected ${clientLower}. Contacts without email or SMS on file are skipped when that channel is chosen — same behaviour as bulk messaging from ${bookingWord}s.`}
        />
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
