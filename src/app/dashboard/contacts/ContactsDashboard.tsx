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
import type { BookingModel, VenueTerminology } from '@/types/booking-models';
import type { CustomClientFieldDefinition, GuestDetailGuest, GuestDetailResponse, GuestListRow } from '@/types/contacts';
import { CONTACTS_SEGMENT_OPTIONS, CONTACTS_SORT_OPTIONS } from '@/lib/guests/contacts-constants';
import type { ContactsMarketingFilter, ContactsSegment, LastServiceKind } from '@/lib/guests/guest-contacts-list';
import { MAX_GUEST_TAG_LENGTH, normaliseSegmentTagFilter } from '@/lib/guests/tags';
import { formatNextBookingSummary, formatRelativeVisitDate } from '@/lib/guests/contact-formatting';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { EmptyState } from '@/components/ui/dashboard/EmptyState';
import { DashboardListSkeleton } from '@/components/ui/dashboard/DashboardSkeletons';
import { Pill } from '@/components/ui/dashboard/Pill';
import type { ViewToolbarSummary } from '@/components/dashboard/ViewToolbar';
import { OperationsWorkspaceToolbar } from '@/components/dashboard/OperationsWorkspaceToolbar';
import { OperationsToolbarGuestSearchPanel } from '@/components/dashboard/OperationsToolbarGuestSearchPanel';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { MergeContactsModal } from '@/components/dashboard/contacts/MergeContactsModal';
import { useDebouncedCallback } from '@/lib/hooks/use-debounced-callback';
import { CONTACTS_BOOKINGS_REFRESH_DEBOUNCE_MS } from '@/lib/realtime/dashboard-sync-constants';
import { useVenuePostgresLiveSync } from '@/lib/realtime/useVenuePostgresLiveSync';
import { BulkGuestMessageModal } from '@/components/booking/BulkGuestMessageModal';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import { formatGuestDisplayName } from '@/lib/guests/name';
import { guestListRowFromDetailResponse } from '@/lib/guests/guest-list-row-from-detail';
import { bindDetailPrefetchHandlers } from '@/lib/dashboard/detail-prefetch-intent';
import { warmIdsWithConcurrency } from '@/lib/dashboard/venue-detail-swr';

export type { GuestListRow } from '@/types/contacts';

function mergeGuestDetailFromSavedGuest(prev: GuestDetailResponse, saved: GuestDetailGuest): GuestDetailResponse {
  return {
    ...prev,
    guest: {
      ...prev.guest,
      ...saved,
      tags: Array.isArray(saved.tags) ? saved.tags : prev.guest.tags,
    },
  };
}

const CONTACT_SHOW_OPTIONS: Array<{ value: 'identified' | 'all' | 'anonymous'; label: string; hint: string }> = [
  {
    value: 'identified',
    label: 'Saved contact details',
    hint: 'People with a name plus email or phone you can reach.',
  },
  {
    value: 'all',
    label: 'All identified guests',
    hint: 'Everyone we can recognise. Anonymous walk-ins stay hidden.',
  },
  {
    value: 'anonymous',
    label: 'Walk-ins only',
    hint: 'Guests without saved contact details (useful for reviewing anonymous visits).',
  },
];

const CONTACTS_FILTER_DATE_INPUT_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

const CONTACTS_FILTER_SELECT_CLASS =
  'w-full rounded-lg border border-slate-200 bg-white px-2 py-2.5 text-sm shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100';

const CONTACTS_TOOLBAR_SUMMARY_STUB: ViewToolbarSummary = {
  total_covers_booked: 0,
  total_covers_capacity: 0,
  tables_in_use: 0,
  tables_total: 0,
  unassigned_count: 0,
  combos_in_use: 0,
};

const CONTACTS_PAGE_LIMIT_STORAGE_KEY = 'contacts-directory-page-limit';
const CONTACTS_PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const;
type ContactsPageLimit = (typeof CONTACTS_PAGE_SIZE_OPTIONS)[number];

function parseContactsPageLimit(raw: string | null): ContactsPageLimit {
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && (CONTACTS_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) {
    return n as ContactsPageLimit;
  }
  return 25;
}

function isoDateToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function contactInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const w = parts[0]!;
    return w.length <= 2 ? w.toUpperCase() : (w.slice(0, 2).toUpperCase());
  }
  return `${parts[0]!.charAt(0)}${parts[parts.length - 1]!.charAt(0)}`.toUpperCase();
}

/** Matches primary dashboard actions (`bg-brand-600` — e.g. New Booking). */
const CONTACT_AVATAR_CLASSES = 'bg-brand-600 text-white shadow-sm ring-2 ring-brand-100/90';

function ContactRow({
  row: g,
  displayNameStr,
  isAnonRow,
  expanded,
  selected,
  visitsLabel,
  onToggleSelected,
  onToggleExpand,
  detailPrefetchHandlers,
}: {
  row: GuestListRow;
  displayNameStr: string;
  isAnonRow: boolean;
  expanded: boolean;
  selected: boolean;
  visitsLabel: string;
  onToggleSelected: () => void;
  onToggleExpand: () => void;
  detailPrefetchHandlers?: ReturnType<typeof bindDetailPrefetchHandlers>;
}) {
  const email = g.email?.trim() || null;
  const phone = g.phone?.trim() || null;
  const nextAppt = formatNextBookingSummary(g.next_booking_date, g.next_booking_time);
  const tags = g.tags ?? [];
  const MAX_TAGS = 3;
  const initials = contactInitials(displayNameStr);

  return (
    <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex shrink-0 items-center gap-2"
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected()}
          aria-label={`Select ${displayNameStr}`}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[10px] font-semibold tracking-tight ${CONTACT_AVATAR_CLASSES}`}
          aria-hidden
        >
          {initials}
        </div>
      </div>

      <div
        className="min-w-0 flex-1 cursor-pointer"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        {...detailPrefetchHandlers}
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
            <h3
              className={`min-w-0 flex-[1_1_10rem] text-sm font-semibold leading-snug text-slate-900 sm:flex-[1_1_12rem] md:flex-[1_1_14rem] ${
                isAnonRow ? 'italic text-slate-500' : ''
              }`}
            >
              {displayNameStr}
            </h3>
            {phone ? (
              <span className="inline-flex min-w-0 shrink-[2] basis-auto items-center gap-1 text-[11px] leading-tight tabular-nums text-slate-600">
                <svg className="h-3 w-3 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.163-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                </svg>
                <span className="min-w-0 truncate">{phone}</span>
              </span>
            ) : null}
            {phone && email ? <span className="hidden text-slate-300 sm:inline" aria-hidden>·</span> : null}
            {email ? (
              <span className="inline-flex min-w-0 shrink-[3] basis-auto items-center gap-1 text-[11px] leading-tight">
                <svg className="h-3 w-3 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                </svg>
                <span className="min-w-0 truncate">{email}</span>
              </span>
            ) : null}
            {!phone && !email ? (
              <span className="text-[11px] text-slate-400">No contact details</span>
            ) : null}
          </div>
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? 'rotate-180 text-brand-600' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span
            className="inline-flex items-center rounded-md border border-slate-200/80 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700"
            title={visitsLabel}
          >
            {g.visit_count} visits
            {g.no_show_count > 0 ? (
              <span className="ml-1 font-semibold text-red-600">{g.no_show_count} NS</span>
            ) : null}
          </span>
          {g.last_visit_date ? (
            <span className="inline-flex items-center rounded-md border border-slate-200/80 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {formatRelativeVisitDate(g.last_visit_date)}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md border border-dashed border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
              No visits
            </span>
          )}
          {nextAppt ? (
            <Pill variant="info" size="sm" className="max-w-[11rem] truncate leading-tight">
              {nextAppt}
            </Pill>
          ) : null}
          {tags.slice(0, MAX_TAGS).map((t) => (
            <Pill key={t} variant="neutral" size="sm" className="max-w-[6.5rem] truncate leading-tight">
              {t}
            </Pill>
          ))}
          {tags.length > MAX_TAGS ? (
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
              +{tags.length - MAX_TAGS}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ContactsFilterSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-sm ring-1 ring-slate-900/[0.02] sm:p-3.5">
      <div className="mb-2.5">
        <h3 className="text-[13px] font-semibold tracking-tight text-slate-900">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-slate-600">{hint}</p> : null}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function filterChoiceClass(active: boolean): string {
  return active
    ? 'border-brand-300 bg-brand-50 text-brand-950 ring-2 ring-brand-200/80 shadow-sm'
    : 'border-slate-200 bg-slate-50/40 text-slate-800 hover:border-slate-300 hover:bg-white';
}

function ContactsToolbarOptionPopover({
  toolbarPanelAnchorRef,
  triggerRef,
  triggerText,
  panelHeading,
  panelSubtitle,
  open,
  onDismiss,
  onTriggerClick,
  isDirty,
  panelId,
  triggerAriaLabel,
  maxWidthPx = 320,
  layout = 'compact',
  footer,
  children,
}: {
  toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  triggerText: string;
  panelHeading: string;
  /** Shown below the heading when {@link layout} is `rich`. */
  panelSubtitle?: string;
  open: boolean;
  onDismiss: () => void;
  onTriggerClick: () => void;
  isDirty: boolean;
  panelId: string;
  triggerAriaLabel: string;
  maxWidthPx?: number;
  layout?: 'compact' | 'rich';
  footer?: ReactNode;
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
        maxWidthPx={maxWidthPx}
        id={panelId}
        onDismiss={onDismiss}
        containInnerScroll={layout === 'rich'}
        aria-label={panelHeading}
        className={`animate-fade-in z-50 rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 ring-1 ring-slate-100 ${
          layout === 'rich' ? 'min-h-0 overflow-hidden p-0' : 'overflow-hidden p-1.5'
        }`}
      >
        {layout === 'rich' ? (
          <>
            <div className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3 sm:px-4">
              <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{panelHeading}</h2>
              {panelSubtitle ? <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{panelSubtitle}</p> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pb-4 sm:px-4">{children}</div>
            {footer ? (
              <div className="shrink-0 border-t border-slate-100 bg-slate-50/90 px-3 py-3 sm:px-4">{footer}</div>
            ) : null}
          </>
        ) : (
          <>
            <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{panelHeading}</p>
            <div className="space-y-0.5">{children}</div>
          </>
        )}
      </ClampedFixedDropdown>
    </div>
  );
}

export function ContactsDashboard({
  venueId,
  currency,
  tableManagementEnabled,
  terminology,
  appointmentDashboardExperience,
  isAdmin,
  usesUnifiedServices,
  venueBookingModel,
  venueEnabledBookingModels,
  venueTimezone,
}: {
  venueId: string;
  currency: string;
  tableManagementEnabled: boolean;
  terminology: VenueTerminology;
  appointmentDashboardExperience: boolean;
  isAdmin: boolean;
  usesUnifiedServices: boolean;
  venueBookingModel: BookingModel;
  venueEnabledBookingModels: BookingModel[];
  venueTimezone: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToast } = useToast();
  const {
    peekGuestDetail,
    primeGuestDetail,
    invalidateGuestDetail,
    warmGuestDetail,
  } = useDashboardDetailCache();
  const isAppointment = appointmentDashboardExperience;
  const clientWord = terminology.client;
  const clientLower = clientWord.toLowerCase();
  const bookingWord = terminology.booking;
  const visitsLabel = isAppointment ? `${bookingWord}s (lifecycle)` : 'Visits';

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('last_visit_desc');
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'identified' | 'all' | 'anonymous'>('identified');
  const [segment, setSegment] = useState<ContactsSegment>('all');
  const [segmentTag, setSegmentTag] = useState('');
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);
  const [marketing, setMarketing] = useState<ContactsMarketingFilter>('subscribed');
  const [lastStaffId, setLastStaffId] = useState<string | null>(null);
  const [lastServiceId, setLastServiceId] = useState<string | null>(null);
  const [rosterStaff, setRosterStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [venueServices, setVenueServices] = useState<Array<{ id: string; name: string }>>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [venueTags, setVenueTags] = useState<string[]>([]);
  const [guests, setGuests] = useState<GuestListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [limit, setLimit] = useState<ContactsPageLimit>(25);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedGuestId, setExpandedGuestId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GuestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [eraseLoadingId, setEraseLoadingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bulkContactMessageOpen, setBulkContactMessageOpen] = useState(false);
  const [bulkContactMessageSending, setBulkContactMessageSending] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [filterPopoverKind, setFilterPopoverKind] = useState<'none' | 'filter' | 'sort' | 'pageSize'>('none');
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const sortFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const pageSizeTriggerRef = useRef<HTMLButtonElement>(null);
  const contactsToolbarPanelsId = useId();
  const segmentTagDatalistId = useId();

  const normalisedSegmentTagFilter = useMemo(() => normaliseSegmentTagFilter(segmentTag), [segmentTag]);
  const tagSegmentNeedsInput = segment === 'tag' && !normalisedSegmentTagFilter;
  const visitSegmentNeedsDates = segment === 'visit' && !dateFrom && !dateTo;

  useEffect(() => {
    try {
      const next = parseContactsPageLimit(window.localStorage.getItem(CONTACTS_PAGE_LIMIT_STORAGE_KEY));
      if (next !== 25) setLimit(next);
    } catch {
      /* ignore */
    }
  }, []);

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

  const loadContactsFilterSources = useCallback(async () => {
    try {
      const [prRes, svcRes] = await Promise.all([
        fetch('/api/venue/practitioners?roster=1&active_only=1'),
        fetch('/api/venue/appointment-services'),
      ]);
      if (prRes.ok) {
        const d = (await prRes.json()) as { practitioners?: Array<{ id: string; name?: string | null }> };
        const rows = Array.isArray(d.practitioners) ? d.practitioners : [];
        setRosterStaff(
          rows.map((p) => ({
            id: p.id,
            name: typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim() : 'Staff',
          })),
        );
      }
      if (svcRes.ok) {
        const d = (await svcRes.json()) as { services?: Array<{ id: string; name?: string | null }> };
        const rows = Array.isArray(d.services) ? d.services : [];
        setVenueServices(
          rows.map((s) => ({
            id: s.id,
            name: typeof s.name === 'string' && s.name.trim() !== '' ? s.name.trim() : 'Service',
          })),
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadContactsFilterSources();
  }, [loadContactsFilterSources]);

  const lastServiceKind: LastServiceKind = usesUnifiedServices ? 'service_item' : 'appointment_service';

  useEffect(() => {
    setSelectedIds([]);
  }, [
    page,
    limit,
    debouncedSearch,
    filter,
    segment,
    segmentTag,
    tagFilter,
    dateFrom,
    dateTo,
    marketing,
    lastStaffId,
    lastServiceId,
  ]);

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

  const loadList = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        sort,
        page: String(page),
        limit: String(limit),
        filter,
        segment,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (tagFilter.length) params.set('tags', tagFilter.join(','));
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (segment === 'marketing') params.set('marketing', marketing);
      if (segment === 'last_staff' && lastStaffId) params.set('last_staff_id', lastStaffId);
      if (segment === 'last_service' && lastServiceId) {
        params.set('last_service_kind', lastServiceKind);
        params.set('last_service_id', lastServiceId);
      }
      if (segment === 'tag' && normalisedSegmentTagFilter) {
        params.set('segment_tag', normalisedSegmentTagFilter);
      }
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
      if (!silent) {
        setLoading(false);
      }
    }
  }, [
    sort,
    page,
    limit,
    debouncedSearch,
    tagFilter,
    filter,
    segment,
    dateFrom,
    dateTo,
    marketing,
    lastStaffId,
    lastServiceId,
    lastServiceKind,
    normalisedSegmentTagFilter,
  ]);

  const refreshContacts = useCallback(() => {
    void loadList({ silent: true });
  }, [loadList]);

  const refreshContactsFromBookings = useDebouncedCallback(
    refreshContacts,
    CONTACTS_BOOKINGS_REFRESH_DEBOUNCE_MS,
  );

  const liveState = useVenuePostgresLiveSync({
    venueId,
    onRefresh: refreshContacts,
    subscriptions: [
      {
        table: 'guests',
        filter: `venue_id=eq.${venueId}`,
        handler: () => {
          refreshContacts();
        },
      },
      {
        table: 'bookings',
        filter: `venue_id=eq.${venueId}`,
        handler: () => {
          refreshContactsFromBookings();
        },
      },
    ],
  });

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
            const row = guests.find((rowGuest) => rowGuest.id === o.guestId);
            const name =
              row && row.identifiability_tier !== 'anonymous'
                ? formatGuestDisplayName(row.first_name, row.last_name)
                : row
                  ? 'Anonymous'
                  : '';
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

  const loadDetail = useCallback(
    async (guestId: string) => {
      const cached = peekGuestDetail(guestId);
      const cacheHit = cached?.guest?.id === guestId;

      setDetailLoading(!cacheHit);
      setEditError(null);

      if (cacheHit) {
        setDetail(cached);
        setEditFirstName(cached.guest.first_name ?? '');
        setEditLastName(cached.guest.last_name ?? '');
        setEditEmail(cached.guest.email ?? '');
        setEditPhone(cached.guest.phone ?? '');
      } else {
        setDetail((prev) => (prev?.guest.id === guestId ? prev : null));
      }

      try {
        const res = await fetch(`/api/venue/guests/${guestId}?booking_history_limit=80`);
        const data = (await res.json()) as GuestDetailResponse & { error?: string };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load guest');
        }
        primeGuestDetail(guestId, data);
        setDetail(data);
        setEditFirstName(data.guest.first_name ?? '');
        setEditLastName(data.guest.last_name ?? '');
        setEditEmail(data.guest.email ?? '');
        setEditPhone(data.guest.phone ?? '');
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setDetailLoading(false);
      }
    },
    [peekGuestDetail, primeGuestDetail],
  );

  const prefetchGuestDetail = useCallback(
    (guestId: string) => {
      void warmGuestDetail(guestId);
    },
    [warmGuestDetail],
  );

  useEffect(() => {
    if (guests.length === 0) return;
    const ids = guests.slice(0, 28).map((g) => g.id);
    const scheduleIdle =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback.bind(window)
        : (cb: IdleRequestCallback) =>
            window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 60);
    const idleHandle = scheduleIdle(() => {
      void warmIdsWithConcurrency(ids, warmGuestDetail);
    });
    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      } else {
        window.clearTimeout(idleHandle);
      }
    };
  }, [guests, warmGuestDetail]);

  useEffect(() => {
    if (!expandedGuestId) {
      setDetail(null);
      return;
    }
    void loadDetail(expandedGuestId);
  }, [expandedGuestId, loadDetail]);

  const openContact = useCallback((id: string) => {
    setExpandedGuestId(id);
  }, []);

  const toggleContactExpand = useCallback((id: string) => {
    setExpandedGuestId((prev) => (prev === id ? null : id));
  }, []);

  useEffect(() => {
    const guestIdFromQuery = searchParams.get('guest')?.trim();
    if (!guestIdFromQuery) return;
    openContact(guestIdFromQuery);
    router.replace('/dashboard/contacts', { scroll: false });
  }, [openContact, router, searchParams]);

  const expandedGuestInDirectory = Boolean(
    expandedGuestId && guests.some((g) => g.id === expandedGuestId),
  );

  const directoryRows = useMemo(() => {
    if (!expandedGuestId) return guests;
    if (expandedGuestInDirectory) return guests;
    if (detail?.guest.id === expandedGuestId) {
      const pinned = guestListRowFromDetailResponse(detail);
      return [pinned, ...guests.filter((g) => g.id !== pinned.id)];
    }
    return guests;
  }, [detail, expandedGuestId, expandedGuestInDirectory, guests]);

  const showDeepLinkContactLoading = Boolean(
    expandedGuestId && !expandedGuestInDirectory && (detailLoading || detail?.guest.id !== expandedGuestId),
  );

  useEffect(() => {
    if (!expandedGuestId || showDeepLinkContactLoading) return;
    const elId = `contact-expand-${expandedGuestId}`;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(elId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedGuestId, showDeepLinkContactLoading, detail?.guest.id]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
    setPage(0);
  }, []);

  const onSaveGuestDetails = useCallback(async (): Promise<boolean> => {
    if (!detail) return false;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/venue/guests/${detail.guest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editFirstName.trim(),
          last_name: editLastName.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; guest?: GuestDetailGuest };
      if (!res.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Save failed');
      }
      if (!j.guest || j.guest.id !== detail.guest.id) {
        console.error('PATCH /api/venue/guests/[id] returned unexpected guest payload');
        await loadDetail(detail.guest.id);
      } else {
        const merged = mergeGuestDetailFromSavedGuest(detail, j.guest!);
        primeGuestDetail(merged.guest.id, merged);
        setDetail(merged);
        setEditFirstName(j.guest.first_name ?? '');
        setEditLastName(j.guest.last_name ?? '');
        setEditEmail(j.guest.email ?? '');
        setEditPhone(j.guest.phone ?? '');
      }
      await loadList();
      return true;
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      setEditSaving(false);
    }
  }, [detail, editFirstName, editLastName, editEmail, editPhone, loadDetail, loadList, primeGuestDetail]);

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
          segment,
          include_custom_fields: '1',
        });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (tagFilter.length) params.set('tags', tagFilter.join(','));
        if (dateFrom) params.set('date_from', dateFrom);
        if (dateTo) params.set('date_to', dateTo);
        if (segment === 'marketing') params.set('marketing', marketing);
        if (segment === 'last_staff' && lastStaffId) params.set('last_staff_id', lastStaffId);
        if (segment === 'last_service' && lastServiceId) {
          params.set('last_service_kind', lastServiceKind);
          params.set('last_service_id', lastServiceId);
        }
        if (segment === 'tag' && normalisedSegmentTagFilter) {
          params.set('segment_tag', normalisedSegmentTagFilter);
        }
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
        'First name',
        'Surname',
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
          g.first_name ?? '',
          g.last_name ?? '',
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
  }, [
    sort,
    filter,
    segment,
    dateFrom,
    dateTo,
    marketing,
    lastStaffId,
    lastServiceId,
    lastServiceKind,
    debouncedSearch,
    tagFilter,
    currency,
    normalisedSegmentTagFilter,
  ]);

  const eraseGuestData = useCallback(
    async (guestId: string): Promise<boolean> => {
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
        invalidateGuestDetail(guestId);
        setExpandedGuestId(null);
        setDetail(null);
        await loadList();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erase failed');
        return false;
      } finally {
        setEraseLoadingId(null);
      }
    },
    [invalidateGuestDetail, loadList],
  );

  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const hasActiveFilters = Boolean(
    debouncedSearch ||
      tagFilter.length ||
      segment !== 'all' ||
      filter !== 'identified' ||
      dateFrom ||
      dateTo,
  );

  const displayName = (g: GuestListRow): string => {
    if (filter === 'anonymous' || g.identifiability_tier === 'anonymous') {
      return 'Anonymous';
    }
    return formatGuestDisplayName(g.first_name, g.last_name);
  };

  const emptyTitle =
    tagSegmentNeedsInput && !loading
      ? 'Choose a tag'
      : visitSegmentNeedsDates && !loading
        ? 'Choose visit dates'
        : !hasActiveFilters && !debouncedSearch && guests.length === 0 && !loading
          ? `No ${clientLower}s yet`
          : 'No matches';
  const emptyDescription =
    tagSegmentNeedsInput && !loading
      ? 'Open Filters, choose Filter by tag under Smart lists, then pick a suggestion or type a tag.'
      : visitSegmentNeedsDates && !loading
        ? 'Under Smart lists, pick By last visit and set a starting date, an ending date, or both. Only contacts with a last visit in that range are shown.'
        : !hasActiveFilters && !debouncedSearch && guests.length === 0 && !loading
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
        {segment !== 'all' ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 font-medium text-slate-800">
            <span className="font-normal text-slate-500">Filter</span>
            <span className="max-w-full min-w-0 break-words">
              {segment === 'tag' && segmentTag.trim()
                ? `Tag: ${segmentTag.trim()}`
                : CONTACTS_SEGMENT_OPTIONS.find((o) => o.value === segment)?.label ?? segment}
            </span>
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
    [totalCount, page, totalPages, segment, segmentTag, filter, debouncedSearch, tagFilter.length],
  );

  const selectRowClass = (selected: boolean) =>
    selected
      ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-200'
      : 'text-slate-800 hover:bg-slate-50';

  const contactsFilterPopoverDirty = useMemo(() => {
    const scopeDirty = filter !== 'identified';
    const segmentDirty = segment !== 'all';
    const datesDirty = Boolean(dateFrom || dateTo);
    const staffDirty = Boolean(lastStaffId);
    const serviceDirty = Boolean(lastServiceId);
    const marketingChoiceDirty = segment === 'marketing' && marketing !== 'subscribed';
    return scopeDirty || segmentDirty || datesDirty || staffDirty || serviceDirty || marketingChoiceDirty;
  }, [filter, segment, dateFrom, dateTo, lastStaffId, lastServiceId, marketing]);

  const resetContactsDirectoryFilters = useCallback(() => {
    setFilter('identified');
    setSegment('all');
    setSegmentTag('');
    setDateFrom(null);
    setDateTo(null);
    setLastStaffId(null);
    setLastServiceId(null);
    setMarketing('subscribed');
    setPage(0);
  }, []);

  const contactsToolbarTools = useCallback(
    (toolbarPanelAnchorRef: RefObject<HTMLDivElement | null>) => (
      <>
        <ContactsToolbarOptionPopover
          toolbarPanelAnchorRef={toolbarPanelAnchorRef}
          triggerRef={filterTriggerRef}
          triggerText={contactsFilterPopoverDirty ? 'Filters (active)' : 'Filters'}
          panelHeading="Filters"
          panelSubtitle="Choose who appears in the list first, then optionally narrow further with a smart list or dates. Results update as soon as you tap an option."
          layout="rich"
          open={filterPopoverKind === 'filter'}
          onDismiss={() => setFilterPopoverKind('none')}
          onTriggerClick={() =>
            setFilterPopoverKind((k) => (k === 'filter' ? 'none' : 'filter'))
          }
          isDirty={contactsFilterPopoverDirty}
          panelId={`${contactsToolbarPanelsId}-filter`}
          triggerAriaLabel="Open directory filters"
          maxWidthPx={440}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                disabled={!contactsFilterPopoverDirty}
                onClick={() => resetContactsDirectoryFilters()}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-center text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                Clear filters
              </button>
              <button
                type="button"
                onClick={() => setFilterPopoverKind('none')}
                className="min-h-10 w-full rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-sm hover:bg-brand-700 sm:w-auto"
              >
                Done
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            <ContactsFilterSection
              title="Who to include"
              hint="Start here. This controls whether walk-ins appear alongside people you can message."
            >
              <div role="radiogroup" aria-label="Who to include" className="space-y-2">
                {CONTACT_SHOW_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === o.value}
                    onClick={() => {
                      setFilter(o.value);
                      setPage(0);
                    }}
                    className={`flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-colors ${filterChoiceClass(filter === o.value)}`}
                  >
                    <span className="text-sm font-semibold">{o.label}</span>
                    <span className="mt-0.5 text-[11px] font-normal leading-snug text-slate-600">{o.hint}</span>
                  </button>
                ))}
              </div>
            </ContactsFilterSection>

            <ContactsFilterSection
              title="Smart lists"
              hint="Optional extras on top of Who to include. Pick Everyone if you only need the scope above."
            >
              <div role="radiogroup" aria-label="Smart list filters" className="space-y-2">
                {CONTACTS_SEGMENT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={segment === o.value}
                    onClick={() => {
                      const next = o.value as ContactsSegment;
                      setSegment(next);
                      setPage(0);
                      if (next !== 'last_staff') setLastStaffId(null);
                      if (next !== 'last_service') setLastServiceId(null);
                      if (next !== 'tag') setSegmentTag('');
                      if (next === 'all' || next === 'tag') {
                        setDateFrom(null);
                        setDateTo(null);
                      }
                    }}
                    className={`flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-colors ${filterChoiceClass(segment === o.value)}`}
                  >
                    <span className="text-sm font-semibold">{o.label}</span>
                    {o.description ? (
                      <span className="mt-0.5 text-[11px] font-normal leading-snug text-slate-600">{o.description}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </ContactsFilterSection>

            {segment === 'tag' ? (
              <ContactsFilterSection
                title="Tag"
                hint="Suggestions come from tags already used at your venue. You can type any tag; matching ignores capital letters."
              >
                <label className="block text-xs font-semibold text-slate-700">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">Search tag</span>
                  <input
                    type="text"
                    list={segmentTagDatalistId}
                    value={segmentTag}
                    maxLength={MAX_GUEST_TAG_LENGTH}
                    onChange={(e) => {
                      setSegmentTag(e.target.value);
                      setPage(0);
                    }}
                    placeholder="e.g. vip, regular"
                    className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    autoComplete="off"
                  />
                  <datalist id={segmentTagDatalistId}>
                    {venueTags.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
              </ContactsFilterSection>
            ) : null}

            {segment === 'new' || segment === 'upcoming' || segment === 'visit' ? (
              <ContactsFilterSection
                title="Dates"
                hint={
                  segment === 'new'
                    ? 'Leave both blank to include anyone added from the start of this month through today.'
                    : segment === 'upcoming'
                      ? 'Leave both blank to search from today up to one year ahead.'
                      : 'Set at least one date. We only include contacts whose last visit falls in this range (through today).'
                }
              >
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Starting</span>
                    <input
                      type="date"
                      value={dateFrom ?? ''}
                      onChange={(e) => {
                        setDateFrom(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Ending</span>
                    <input
                      type="date"
                      value={dateTo ?? ''}
                      onChange={(e) => {
                        setDateTo(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                </div>
              </ContactsFilterSection>
            ) : null}

            {segment === 'marketing' ? (
              <ContactsFilterSection
                title="Marketing consent"
                hint="Choose whether they are currently subscribed. Dates below look at when consent was recorded."
              >
                <div role="radiogroup" aria-label="Marketing consent" className="space-y-2">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={marketing === 'subscribed'}
                    onClick={() => {
                      setMarketing('subscribed');
                      setPage(0);
                    }}
                    className={`flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-colors ${filterChoiceClass(marketing === 'subscribed')}`}
                  >
                    <span className="text-sm font-semibold">Subscribed</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      Happy to hear from you by email or SMS where the venue allows it.
                    </span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={marketing === 'not_subscribed'}
                    onClick={() => {
                      setMarketing('not_subscribed');
                      setPage(0);
                    }}
                    className={`flex w-full flex-col rounded-xl border px-3 py-2 text-left transition-colors ${filterChoiceClass(marketing === 'not_subscribed')}`}
                  >
                    <span className="text-sm font-semibold">Not subscribed</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-slate-600">
                      Opted out or never gave marketing permission.
                    </span>
                  </button>
                </div>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  When consent was saved (optional)
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Starting</span>
                    <input
                      type="date"
                      value={dateFrom ?? ''}
                      onChange={(e) => {
                        setDateFrom(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Ending</span>
                    <input
                      type="date"
                      value={dateTo ?? ''}
                      onChange={(e) => {
                        setDateTo(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                </div>
              </ContactsFilterSection>
            ) : null}

            {segment === 'last_staff' ? (
              <ContactsFilterSection
                title="Staff member"
                hint="We match their most recent booking that is still on the calendar. Narrow dates if you only care about visits in a certain window."
              >
                <label className="block text-xs font-semibold text-slate-700">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">Team member</span>
                  <select
                    value={lastStaffId ?? ''}
                    onChange={(e) => {
                      setLastStaffId(e.target.value ? e.target.value : null);
                      setPage(0);
                    }}
                    className={CONTACTS_FILTER_SELECT_CLASS}
                  >
                    <option value="">Choose someone…</option>
                    {rosterStaff.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Booking date (optional)
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Starting</span>
                    <input
                      type="date"
                      value={dateFrom ?? ''}
                      onChange={(e) => {
                        setDateFrom(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Ending</span>
                    <input
                      type="date"
                      value={dateTo ?? ''}
                      onChange={(e) => {
                        setDateTo(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                </div>
              </ContactsFilterSection>
            ) : null}

            {segment === 'last_service' ? (
              <ContactsFilterSection
                title="Service"
                hint="Find people whose latest booking included this service. Add booking dates if you need a tighter window."
              >
                <label className="block text-xs font-semibold text-slate-700">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">Service name</span>
                  <select
                    value={lastServiceId ?? ''}
                    onChange={(e) => {
                      setLastServiceId(e.target.value ? e.target.value : null);
                      setPage(0);
                    }}
                    className={CONTACTS_FILTER_SELECT_CLASS}
                  >
                    <option value="">Choose a service…</option>
                    {venueServices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Booking date (optional)
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Starting</span>
                    <input
                      type="date"
                      value={dateFrom ?? ''}
                      onChange={(e) => {
                        setDateFrom(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    <span className="mb-1 block text-[11px] font-medium text-slate-500">Ending</span>
                    <input
                      type="date"
                      value={dateTo ?? ''}
                      onChange={(e) => {
                        setDateTo(e.target.value ? e.target.value : null);
                        setPage(0);
                      }}
                      className={CONTACTS_FILTER_DATE_INPUT_CLASS}
                    />
                  </label>
                </div>
              </ContactsFilterSection>
            ) : null}
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
        <ContactsToolbarOptionPopover
          toolbarPanelAnchorRef={toolbarPanelAnchorRef}
          triggerRef={pageSizeTriggerRef}
          triggerText={`${limit} / page`}
          panelHeading="Contacts per page"
          open={filterPopoverKind === 'pageSize'}
          onDismiss={() => setFilterPopoverKind('none')}
          onTriggerClick={() =>
            setFilterPopoverKind((k) => (k === 'pageSize' ? 'none' : 'pageSize'))
          }
          isDirty={limit !== 25}
          panelId={`${contactsToolbarPanelsId}-page-size`}
          triggerAriaLabel="Choose how many contacts to show per page"
          maxWidthPx={220}
        >
          <div role="radiogroup" aria-label="Contacts per page" className="space-y-0.5">
            {CONTACTS_PAGE_SIZE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={limit === n}
                onClick={() => {
                  setLimit(n);
                  setPage(0);
                  setFilterPopoverKind('none');
                  try {
                    window.localStorage.setItem(CONTACTS_PAGE_LIMIT_STORAGE_KEY, String(n));
                  } catch {
                    /* ignore */
                  }
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm font-semibold ${selectRowClass(limit === n)}`}
              >
                {n} per page
              </button>
            ))}
          </div>
        </ContactsToolbarOptionPopover>
      </>
    ),
    [
      filter,
      segment,
      sort,
      limit,
      filterPopoverKind,
      contactsToolbarPanelsId,
      dateFrom,
      dateTo,
      marketing,
      lastStaffId,
      lastServiceId,
      rosterStaff,
      venueServices,
      venueTags,
      segmentTag,
      segmentTagDatalistId,
      contactsFilterPopoverDirty,
      resetContactsDirectoryFilters,
    ],
  );

  return (
    <div className="min-w-0 w-full space-y-3">
      <div className="min-w-0 space-y-3">
        <div className="min-w-0 space-y-3 pb-1">
          <OperationsWorkspaceToolbar
            title="Contacts"
            summary={CONTACTS_TOOLBAR_SUMMARY_STUB}
            summaryContent={contactsSummaryContent}
            date={toolbarDatePlaceholder}
            onDateChange={() => {}}
            datePickerPanel={null}
            liveState={liveState}
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
              <OperationsToolbarGuestSearchPanel
                onQueryChange={(q) => {
                  setSearch(q);
                  setPage(0);
                }}
                onBookingCreated={() => void loadList()}
              />
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
          <SectionCard.Header
            eyebrow="Directory"
            title={`${clientWord} list`}
            description={`Tap a row to open the full profile. Bulk actions apply to checked ${clientLower}s on this page.`}
          />
          <SectionCard.Body className="min-w-0 space-y-6">
          {venueTags.length > 0 && (
            <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/40 to-slate-50/80 p-4 shadow-sm ring-1 ring-slate-900/[0.03]">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Filter by tags</p>
              <div className="flex flex-wrap gap-2">
                {venueTags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTagFilter(t)}
                    className={`min-h-10 rounded-full px-3.5 py-2 text-sm font-medium shadow-sm transition-all ${
                      tagFilter.includes(t)
                        ? 'bg-brand-600 text-white shadow-md ring-2 ring-brand-400/35'
                        : 'bg-white text-slate-600 ring-1 ring-slate-200/90 hover:bg-slate-50 hover:ring-slate-300'
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
          ) : guests.length === 0 && directoryRows.length === 0 ? (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          ) : (
            <div className="space-y-3">
              {/* Select-all bar */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-200/90 bg-white/95 px-4 py-3 shadow-sm shadow-slate-900/[0.04] ring-1 ring-slate-900/[0.03] backdrop-blur-sm">
                <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-600 hover:text-slate-900">
                  <input
                    type="checkbox"
                    checked={guests.length > 0 && guests.every((g) => selectedIds.includes(g.id))}
                    onChange={() => togglePageSelection()}
                    aria-label="Select all on this page"
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Select all on page
                </label>
                <span className="text-xs font-semibold tabular-nums text-slate-400">
                  {guests.length} {guests.length === 1 ? clientLower : `${clientLower}s`}
                </span>
              </div>

              <div
                className="flex flex-col gap-2 rounded-2xl bg-gradient-to-b from-slate-100/90 via-slate-50/50 to-white p-1.5 shadow-inner shadow-slate-900/[0.05] ring-1 ring-inset ring-slate-200/70 sm:gap-2.5 sm:p-2"
                role="list"
                aria-label={`${clientWord} directory`}
              >
                {showDeepLinkContactLoading ? (
                  <div
                    className="rounded-xl border border-brand-200/90 bg-brand-50/40 px-3 py-3 text-sm text-brand-900"
                    role="status"
                  >
                    Opening {clientLower}…
                  </div>
                ) : null}
                {directoryRows.map((g) => {
                  const isAnonRow = filter === 'anonymous' || g.identifiability_tier === 'anonymous';
                  const expanded = expandedGuestId === g.id;
                  return (
                    <div key={g.id} role="listitem" className="min-w-0">
                      <div
                        aria-expanded={expanded}
                        aria-controls={`contact-expand-${g.id}`}
                        className={`group/contact relative overflow-hidden rounded-xl border px-2.5 py-2 pl-3 shadow-sm shadow-slate-900/[0.04] transition-all duration-200 sm:px-3 sm:py-2 sm:pl-4 ${
                          selectedIds.includes(g.id)
                            ? 'border-brand-200 bg-gradient-to-br from-brand-50/90 via-white to-white'
                            : 'border-slate-200/90 bg-white hover:border-slate-300 hover:shadow-md hover:shadow-slate-900/[0.06]'
                        } ${
                          expanded
                            ? 'border-brand-300 ring-2 ring-brand-500/20 shadow-md shadow-brand-900/[0.05]'
                            : ''
                        }`}
                      >
                        {!expanded ? (
                          <div
                            className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-gradient-to-b from-brand-500 to-brand-600 opacity-0 transition-opacity duration-200 group-hover/contact:opacity-50"
                            aria-hidden
                          />
                        ) : (
                          <div
                            className="pointer-events-none absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-600 opacity-100"
                            aria-hidden
                          />
                        )}
                        <ContactRow
                          row={g}
                          displayNameStr={displayName(g)}
                          isAnonRow={isAnonRow}
                          expanded={expanded}
                          selected={selectedIds.includes(g.id)}
                          visitsLabel={visitsLabel}
                          onToggleSelected={() => toggleSelected(g.id)}
                          onToggleExpand={() => toggleContactExpand(g.id)}
                          detailPrefetchHandlers={bindDetailPrefetchHandlers(g.id, prefetchGuestDetail)}
                        />
                        {expanded ? (
                          <div
                            className="mt-3 border-t border-slate-100 bg-gradient-to-b from-slate-50/80 to-white pt-2"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <ContactDetailPanel
                              id={`contact-expand-${g.id}`}
                              clientLower={clientLower}
                              bookingWord={bookingWord}
                              venueId={venueId}
                              venueCurrency={currency}
                              tableManagementEnabled={tableManagementEnabled}
                              isAdmin={isAdmin}
                              listRow={g}
                              selectedId={g.id}
                              detail={detail?.guest.id === g.id ? detail : null}
                              detailLoading={detailLoading && expandedGuestId === g.id}
                              editError={editError}
                              editFirstName={editFirstName}
                              setEditFirstName={setEditFirstName}
                              editLastName={editLastName}
                              setEditLastName={setEditLastName}
                              editEmail={editEmail}
                              setEditEmail={setEditEmail}
                              editPhone={editPhone}
                              setEditPhone={setEditPhone}
                              editSaving={editSaving}
                              onSaveGuestDetails={onSaveGuestDetails}
                              loadDetail={loadDetail}
                              loadList={loadList}
                              eraseLoadingId={eraseLoadingId}
                              onEraseGuest={eraseGuestData}
                              onOpenMerge={isAdmin ? () => setMergeOpen(true) : undefined}
                              venueStaffBookingModel={venueBookingModel}
                              venueStaffEnabledBookingModels={venueEnabledBookingModels}
                              venueTimezone={venueTimezone}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 rounded-2xl border border-slate-200/80 bg-slate-50/50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
                <span className="text-sm font-medium tabular-nums text-slate-600">
                  Page {page + 1} of {totalPages}
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-slate-500">{totalCount} total</span>
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                    className="min-h-10 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-40 sm:flex-none"
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

      {mergeOpen && expandedGuestId && isAdmin ? (
        <MergeContactsModal
          targetGuestId={expandedGuestId}
          clientLower={clientLower}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            void loadDetail(expandedGuestId);
            void loadList();
            setMergeOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
