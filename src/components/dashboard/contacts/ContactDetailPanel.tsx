'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';
import { StaffSurfaceBookingModal } from '@/components/booking/StaffSurfaceBookingModal';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import type { BookingModel } from '@/types/booking-models';
import type { GuestDetailResponse, GuestListRow } from '@/types/contacts';
import {
  formatCalendarDayShort,
  formatNextBookingSummary,
  formatRelativeVisitDate,
} from '@/lib/guests/contact-formatting';
import { ContactDocumentsSection } from '@/components/dashboard/contacts/ContactDocumentsSection';
import { ContactMarketingSection } from '@/components/dashboard/contacts/ContactMarketingSection';
import { ContactHouseholdSection } from '@/components/dashboard/contacts/ContactHouseholdSection';
import { ContactGdprSection } from '@/components/dashboard/contacts/ContactGdprSection';
import { EraseGuestDataModal } from '@/components/dashboard/contacts/EraseGuestDataModal';
import { formatGuestDisplayName } from '@/lib/guests/name';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionSummaryClass,
  bookingExpandActionsBarClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import { BookingDetailPanel } from '@/app/dashboard/bookings/BookingDetailPanel';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import {
  EXP_BOOKING_ICO,
  EXP_BOOKING_NEUTRAL_PROMINENT,
} from '@/app/dashboard/bookings/expanded-booking-toolbar-classes';
import {
  GuestBookingsForGuestAccordion,
  type GuestHistoryRelatedBookingPayload,
} from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { StaffRebookBootstrapPayloadV1, StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';
import { defaultStaffBookingSurfaceTab } from '@/lib/booking/staff-booking-modal-options';
import { mapContactGuestHistoryToAccordionRows } from '@/lib/booking/map-contact-guest-history';
import { isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';

const accordionChevron = (
  <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);

function ContactDetailListRowShell({
  id,
  listRow,
  clientLower,
  editError,
}: {
  id: string;
  listRow: GuestListRow;
  clientLower: string;
  editError: string | null;
}) {
  const isAnonRow = listRow.identifiability_tier === 'anonymous';
  const displayName = isAnonRow
    ? 'Anonymous'
    : formatGuestDisplayName(listRow.first_name, listRow.last_name);
  const email = listRow.email?.trim() || null;
  const phone = listRow.phone?.trim() || null;
  const nextVisitLabel = formatNextBookingSummary(listRow.next_booking_date, listRow.next_booking_time);
  const lastVisitCal = formatCalendarDayShort(listRow.last_visit_date);

  return (
    <div
      id={id}
      className="mt-1.5 flex flex-col gap-2.5 px-0.5 pb-2.5 sm:px-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editError ? <p className="px-1 text-sm text-red-600">{editError}</p> : null}
      <p className="px-1 text-[11px] font-medium text-slate-500">Loading {clientLower} details…</p>
      <SectionCard className="rounded-xl ring-1 ring-slate-900/[0.04]">
        <SectionCard.Body className="p-2.5 sm:p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{displayName}</p>
              <p className="truncate text-xs text-slate-600">
                {[email, phone].filter(Boolean).join(' · ') || 'No contact details on file'}
              </p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Visits</p>
              <p className="font-semibold text-slate-800">{listRow.visit_count ?? 0}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Last visit</p>
              <p className="font-semibold text-slate-800">{lastVisitCal ?? '—'}</p>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Next booking</p>
              <p className="font-semibold text-slate-800">{nextVisitLabel ?? 'None scheduled'}</p>
            </div>
          </div>
        </SectionCard.Body>
      </SectionCard>
    </div>
  );
}

function SubBlock({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-2 ${className}`}>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function ContactDetailPanel({
  id,
  clientLower,
  bookingWord,
  venueId,
  venueCurrency = 'GBP',
  tableManagementEnabled,
  isAdmin,
  listRow,
  selectedId,
  detail,
  detailLoading,
  editError,
  editFirstName,
  setEditFirstName,
  editLastName,
  setEditLastName,
  editEmail,
  setEditEmail,
  editPhone,
  setEditPhone,
  editSaving,
  onSaveGuestDetails,
  loadDetail,
  loadList,
  eraseLoadingId,
  onEraseGuest,
  onOpenMerge,
  venueStaffBookingModel,
  venueStaffEnabledBookingModels,
  venueTimezone,
}: {
  id: string;
  clientLower: string;
  bookingWord: string;
  venueId: string;
  venueCurrency?: string;
  tableManagementEnabled: boolean;
  isAdmin: boolean;
  listRow: GuestListRow;
  selectedId: string;
  detail: GuestDetailResponse | null;
  detailLoading: boolean;
  editError: string | null;
  editFirstName: string;
  setEditFirstName: (v: string) => void;
  editLastName: string;
  setEditLastName: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editSaving: boolean;
  onSaveGuestDetails: () => Promise<boolean>;
  loadDetail: (guestId: string) => Promise<void>;
  loadList: () => Promise<void>;
  eraseLoadingId: string | null;
  onEraseGuest: (guestId: string) => Promise<boolean>;
  onOpenMerge?: () => void;
  venueStaffBookingModel: BookingModel;
  venueStaffEnabledBookingModels: BookingModel[];
  venueTimezone: string;
}) {
  const { addToast } = useToast();
  const [newBookingModal, setNewBookingModal] = useState<StaffRebookBootstrapPayloadV1 | null>(null);
  const [newBookingModalEpoch, setNewBookingModalEpoch] = useState(0);

  const staffNewBookingGuestContacts = useMemo((): StaffRebookGuestPrefill => {
    const dg = detail?.guest;
    const matches = Boolean(dg && dg.id === selectedId);
    if (matches && dg) {
      return {
        firstName: dg.first_name ?? undefined,
        lastName: dg.last_name ?? undefined,
        email: dg.email,
        phone: dg.phone,
      };
    }
    return {
      firstName: listRow.first_name ?? undefined,
      lastName: listRow.last_name ?? undefined,
      email: listRow.email,
      phone: listRow.phone,
    };
  }, [
    detail?.guest,
    selectedId,
    listRow.email,
    listRow.first_name,
    listRow.last_name,
    listRow.phone,
  ]);

  const staffNewBookingDefaultSurfaceTab = useMemo(
    () => defaultStaffBookingSurfaceTab(venueStaffBookingModel, venueStaffEnabledBookingModels),
    [venueStaffBookingModel, venueStaffEnabledBookingModels],
  );

  const handleOpenNewBookingModal = useCallback(() => {
    setNewBookingModalEpoch((e) => e + 1);
    setNewBookingModal({
      v: 1,
      surface: staffNewBookingDefaultSurfaceTab,
      guest: staffNewBookingGuestContacts,
    });
  }, [staffNewBookingDefaultSurfaceTab, staffNewBookingGuestContacts]);

  const contactRebookGuestPrefill = useMemo((): StaffRebookGuestPrefill | undefined => {
    const guest = detail?.guest;
    if (!guest || guest.id !== selectedId) return undefined;
    return {
      firstName: guest.first_name ?? undefined,
      lastName: guest.last_name ?? undefined,
      email: guest.email,
      phone: guest.phone,
      customerProfileNotes: guest.customer_profile_notes,
    };
  }, [
    detail?.guest,
    selectedId,
  ]);

  const guestBookingsListRefreshKey = useMemo(() => {
    const guest = detail?.guest;
    if (!guest || guest.id !== selectedId || !detail) return 0;
    const s = `${guest.updated_at}|${detail.booking_history.length}|${selectedId}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }, [detail, selectedId]);

  const [messageChannel, setMessageChannel] = useState<GuestMessageChannel>('both');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [eraseConfirmOpen, setEraseConfirmOpen] = useState(false);
  const [contactDetailsEditing, setContactDetailsEditing] = useState(false);
  const [relatedGuestHistoryBooking, setRelatedGuestHistoryBooking] = useState<{
    bookingId: string;
    snapshot: BookingDetailPanelSnapshot;
    isAppointment: boolean;
  } | null>(null);

  const handleOpenRelatedGuestBooking = useCallback((payload: GuestHistoryRelatedBookingPayload) => {
    setRelatedGuestHistoryBooking({
      bookingId: payload.bookingId,
      snapshot: payload.snapshot,
      isAppointment: !isTableReservationBooking(payload.row),
    });
  }, []);

  const handleSaveContactDetails = useCallback(async () => {
    const ok = await onSaveGuestDetails();
    if (ok) setContactDetailsEditing(false);
  }, [onSaveGuestDetails]);

  useEffect(() => {
    setMessageDraft('');
    setMessageChannel('both');
    setNewBookingModal(null);
    setEraseConfirmOpen(false);
    setContactDetailsEditing(false);
  }, [selectedId]);

  const hasFullDetail = detail != null && detail.guest.id === selectedId;
  const guestHistoryInitialRows = useMemo(
    () =>
      hasFullDetail && detail.booking_history.length > 0
        ? mapContactGuestHistoryToAccordionRows(detail.booking_history)
        : undefined,
    [detail, hasFullDetail],
  );

  if (detailLoading && !hasFullDetail) {
    return (
      <ContactDetailListRowShell
        id={id}
        listRow={listRow}
        clientLower={clientLower}
        editError={editError}
      />
    );
  }

  if (!hasFullDetail) {
    return (
      <div id={id} className="px-3 py-4 sm:px-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {editError ? <p className="text-sm text-red-600">{editError}</p> : (
          <p className="text-sm text-slate-500">Could not load this {clientLower}.</p>
        )}
      </div>
    );
  }

  const g = detail.guest;
  const isAnonRow = listRow.identifiability_tier === 'anonymous';
  const displayName = isAnonRow ? 'Anonymous' : formatGuestDisplayName(g.first_name, g.last_name);
  const email = g.email?.trim() || null;
  const phone = g.phone?.trim() || null;
  const savedFirstName = (g.first_name ?? '').trim();
  const savedLastName = (g.last_name ?? '').trim();
  const tags = g.tags ?? [];
  const nextVisitLabel = formatNextBookingSummary(listRow.next_booking_date, listRow.next_booking_time);
  const lastVisitRelative = g.last_visit_date ? formatRelativeVisitDate(g.last_visit_date) : null;
  const lastVisitCal = formatCalendarDayShort(g.last_visit_date ?? listRow.last_visit_date);
  const marketingHint =
    g.marketing_opt_out ? 'Opted out' : g.marketing_consent ? 'Subscribed' : 'No consent';
  const recordSummaryHint = marketingHint;
  const inboxSummaryHint =
    `${detail.communications.length} message${detail.communications.length === 1 ? '' : 's'}`
    + (g.customer_profile_notes?.trim() ? ' · note on file' : '');

  return (
    <>
    <div
      id={id}
      className="mt-1.5 flex flex-col gap-2.5 px-0.5 pb-2.5 sm:px-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editError ? <p className="px-1 text-sm text-red-600">{editError}</p> : null}
      {detailLoading ? (
        <p className="px-1 text-[11px] font-medium text-slate-500">Updating {clientLower} details…</p>
      ) : null}

      <SectionCard className="rounded-xl ring-1 ring-slate-900/[0.04]">
        <SectionCard.Body className="p-2.5 sm:p-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <p className="max-w-[14rem] truncate text-sm font-bold text-slate-900 sm:max-w-[20rem]">{displayName}</p>
                  <Pill variant="neutral" size="sm">
                    {g.visit_count > 0 ? `${g.visit_count} visit${g.visit_count !== 1 ? 's' : ''}` : 'New'}
                  </Pill>
                  {g.no_show_count > 0 ? (
                    <Pill variant="warning" size="sm" dot>
                      {g.no_show_count} no-show{g.no_show_count !== 1 ? 's' : ''}
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {listRow.total_bookings > 0 ? (
                    <>
                      <span className="font-medium text-slate-700">{listRow.total_bookings}</span>
                      {' '}
                      {bookingWord.toLowerCase()}
                      {listRow.total_bookings !== 1 ? 's' : ''} on file
                    </>
                  ) : (
                    <>No past {bookingWord.toLowerCase()}s yet</>
                  )}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
              {phone ? (
                <a
                  href={`tel:${phone}`}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Call
                </a>
              ) : null}
              {email ? (
                <a
                  href={`mailto:${email}`}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Email
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <div className="min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">First name</p>
              {contactDetailsEditing ? (
                <input
                  id={`${id}-first`}
                  value={editFirstName}
                  onChange={(e) => setEditFirstName(e.target.value)}
                  autoComplete="given-name"
                  className="mt-0.5 min-h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                />
              ) : savedFirstName ? (
                <p className="mt-0.5 min-h-8 hyphens-auto break-words text-xs font-bold leading-snug text-slate-800 [overflow-wrap:anywhere]">
                  {savedFirstName}
                </p>
              ) : (
                <p className="mt-0.5 min-h-8 text-xs font-bold text-slate-400">Not provided</p>
              )}
            </div>
            <div className="min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Surname</p>
              {contactDetailsEditing ? (
                <input
                  id={`${id}-last`}
                  value={editLastName}
                  onChange={(e) => setEditLastName(e.target.value)}
                  autoComplete="family-name"
                  className="mt-0.5 min-h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                />
              ) : savedLastName ? (
                <p className="mt-0.5 min-h-8 hyphens-auto break-words text-xs font-bold leading-snug text-slate-800 [overflow-wrap:anywhere]">
                  {savedLastName}
                </p>
              ) : (
                <p className="mt-0.5 min-h-8 text-xs font-bold text-slate-400">Not provided</p>
              )}
            </div>
            <div className="min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Email</p>
              {contactDetailsEditing ? (
                <input
                  id={`${id}-email`}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="Not provided"
                  className="mt-0.5 min-h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 py-1 text-xs font-semibold text-slate-900 shadow-sm placeholder:font-normal placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                />
              ) : email ? (
                <a
                  href={`mailto:${email}`}
                  className="mt-0.5 flex min-h-8 items-center hyphens-auto break-words text-xs font-bold leading-snug text-slate-800 [overflow-wrap:anywhere] hover:text-brand-700"
                >
                  {email}
                </a>
              ) : (
                <p className="mt-0.5 min-h-8 text-xs font-bold text-slate-400">Not provided</p>
              )}
            </div>
            <div className="min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Phone</p>
              {contactDetailsEditing ? (
                <input
                  id={`${id}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="Not provided"
                  className="mt-0.5 min-h-8 w-full rounded-md border border-slate-200/90 bg-white px-2 py-1 text-xs font-semibold tabular-nums text-slate-900 shadow-sm placeholder:font-normal placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200"
                />
              ) : phone ? (
                <a
                  href={`tel:${phone}`}
                  className="mt-0.5 flex min-h-8 items-center whitespace-normal hyphens-auto break-words text-xs font-bold leading-snug tabular-nums text-slate-800 [overflow-wrap:anywhere] hover:text-brand-700"
                >
                  {phone}
                </a>
              ) : (
                <p className="mt-0.5 min-h-8 text-xs font-bold tabular-nums text-slate-400">Not provided</p>
              )}
            </div>
            <div className="min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Last visit</p>
              <p className="mt-0.5 hyphens-auto break-words text-xs font-bold leading-snug text-slate-800 [overflow-wrap:anywhere]" title={lastVisitRelative ?? undefined}>
                {g.last_visit_date || listRow.last_visit_date ? (
                  <>
                    <span className="sm:hidden">{lastVisitCal}</span>
                    <span className="hidden sm:inline">{lastVisitRelative ?? lastVisitCal}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div
              className={`min-w-[min(100%,12rem)] max-w-full flex-[1_1_12rem] rounded-lg border px-2 py-1.5 ${
                nextVisitLabel ? 'border-sky-200 bg-sky-50/80' : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Next visit</p>
              <p className={`mt-0.5 hyphens-auto break-words text-xs font-bold leading-snug [overflow-wrap:anywhere] ${nextVisitLabel ? 'text-sky-900' : 'text-slate-500'}`}>
                {nextVisitLabel ?? 'None scheduled'}
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {contactDetailsEditing ? (
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void handleSaveContactDetails()}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save changes'}
              </button>
            ) : (
              <button
                type="button"
                disabled={editSaving}
                onClick={() => setContactDetailsEditing(true)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              >
                Edit
              </button>
            )}
          </div>

          <div className="mt-2.5 border-t border-slate-100 pt-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Tags</p>
            <div className="mt-1.5">
              <GuestTagEditor
                tags={tags}
                venueId={venueId}
                hideSectionLabel
                onTagsChange={async (next) => {
                  const res = await fetch(`/api/venue/guests/${g.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: next }),
                  });
                  if (!res.ok) {
                    const j = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                  }
                  await loadDetail(g.id);
                  await loadList();
                }}
              />
            </div>
          </div>

          <div className="mt-2.5 border-t border-slate-100 pt-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Customer info</p>
            <div className="mt-1.5">
              <CustomerProfileNotesCard
                embedded
                embeddedFlush
                guestId={g.id}
                value={g.customer_profile_notes}
                onSaved={() => void loadDetail(g.id)}
              />
            </div>
          </div>
        </SectionCard.Body>
      </SectionCard>

      <div className={bookingExpandActionsBarClass}>
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 sm:px-3">
          <button
            type="button"
            aria-label={`New booking for this ${clientLower}`}
            onClick={handleOpenNewBookingModal}
            className={EXP_BOOKING_NEUTRAL_PROMINENT}
          >
            <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New booking
          </button>
          {isAdmin && onOpenMerge ? (
            <button
              type="button"
              onClick={onOpenMerge}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-brand-200 bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-800 transition-colors hover:bg-brand-100 sm:text-[11px]"
            >
              Merge…
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              disabled={eraseLoadingId === g.id}
              onClick={() => setEraseConfirmOpen(true)}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-semibold text-red-600 transition-colors hover:border-red-100 hover:bg-red-50 disabled:opacity-50 sm:text-[11px]"
            >
              {eraseLoadingId === g.id ? 'Erasing…' : 'Erase data'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-0 sm:px-0.5">
        <GuestBookingsForGuestAccordion
          guestId={g.id}
          initialRows={guestHistoryInitialRows}
          fetchWhenOpen
          currentBookingId=""
          guestDisplayNameForSnapshots={displayName}
          venueTimeZone={venueTimezone}
          canOpenNested
          onOpenBookingDetail={handleOpenRelatedGuestBooking}
          listRefreshKey={guestBookingsListRefreshKey}
          rebookGuestPrefill={contactRebookGuestPrefill}
          onStaffBookingCreated={() => void loadDetail(g.id)}
        />
      </div>

      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Record &amp; preferences</span>
          <span className="max-w-[9rem] truncate text-[11px] font-medium text-slate-400 group-open:hidden sm:max-w-[14rem]">
            {recordSummaryHint}
          </span>
          {accordionChevron}
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-4`}>
          <SubBlock title="Marketing preferences">
            <ContactMarketingSection guestId={g.id} detail={detail} onUpdated={() => void loadDetail(g.id)} />
          </SubBlock>

          <SubBlock title="Household" className="border-t border-slate-200/70 pt-4">
            <ContactHouseholdSection guestId={g.id} clientLower={clientLower} onChanged={() => void loadDetail(g.id)} />
          </SubBlock>

          <SubBlock title="Documents" className="border-t border-slate-200/70 pt-4">
            <ContactDocumentsSection guestId={g.id} onChanged={() => void loadDetail(g.id)} />
          </SubBlock>
        </div>
      </details>

      <details
        className={bookingExpandAccordionDetailsClass}
        open={detail.communications.length > 0}
      >
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Messages &amp; privacy</span>
          <span className="max-w-[10rem] truncate text-[11px] font-medium text-slate-400 group-open:hidden sm:max-w-[16rem]">
            {inboxSummaryHint}
          </span>
          {accordionChevron}
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-4`}>
          <SubBlock title="Send a message">
            <div className="rounded-xl border border-slate-200/80 bg-white p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Send via</span>
                <GuestMessageChannelSelect value={messageChannel} onChange={setMessageChannel} disabled={messageSending} />
              </div>
              <textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                rows={3}
                disabled={messageSending}
                placeholder={`SMS / email to ${clientLower}…`}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={messageSending || messageDraft.trim().length === 0}
                onClick={async () => {
                  setMessageSending(true);
                  try {
                    const res = await fetch(`/api/venue/guests/${g.id}/message`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ message: messageDraft.trim(), channel: messageChannel }),
                    });
                    const payload = (await res.json().catch(() => ({}))) as {
                      success?: boolean;
                      error?: string;
                      errors?: string[];
                    };
                    if (!res.ok || !payload.success) {
                      const detailErr =
                        (payload.errors && payload.errors.length > 0 ? payload.errors.join('; ') : payload.error)
                        ?? 'Failed to send message';
                      addToast(detailErr, 'error');
                      return;
                    }
                    if (payload.errors && payload.errors.length > 0) {
                      addToast(`Sent with issues — ${payload.errors.join('; ')}`, 'error');
                    } else {
                      addToast('Message sent', 'success');
                    }
                    setMessageDraft('');
                    await loadDetail(g.id);
                  } finally {
                    setMessageSending(false);
                  }
                }}
                className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {messageSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </SubBlock>

          <SubBlock title="Message log" className="border-t border-slate-200/70 pt-4">
            {detail.communications.length === 0 ? (
              <p className="text-sm text-slate-600">No logged communications yet.</p>
            ) : (
              <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                {detail.communications.map((c) => (
                  <li key={c.id} className="px-2.5 py-2 text-sm">
                    <div className="font-medium text-slate-800">{c.message_type}</div>
                    <div className="text-xs text-slate-500">
                      {c.channel} · {c.status} · {new Date(c.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SubBlock>

          <SubBlock title="Privacy & data" className="border-t border-slate-200/70 pt-4">
            <ContactGdprSection guestId={g.id} clientLower={clientLower} isAdmin={isAdmin} />
          </SubBlock>
        </div>
      </details>

      {relatedGuestHistoryBooking ? (
        <BookingDetailPanel
          key={relatedGuestHistoryBooking.bookingId}
          bookingId={relatedGuestHistoryBooking.bookingId}
          venueId={venueId}
          venueCurrency={venueCurrency}
          initialSnapshot={relatedGuestHistoryBooking.snapshot}
          isAppointment={relatedGuestHistoryBooking.isAppointment}
          presentation="modal"
          stackDepth={0}
          venueTimezone={venueTimezone}
          onClose={() => setRelatedGuestHistoryBooking(null)}
          onUpdated={() => {
            void loadDetail(g.id);
            void loadList();
          }}
        />
      ) : null}

      {relatedGuestHistoryBooking ? (
        <BookingDetailPanel
          key={relatedGuestHistoryBooking.bookingId}
          bookingId={relatedGuestHistoryBooking.bookingId}
          venueId={venueId}
          venueCurrency={venueCurrency}
          initialSnapshot={relatedGuestHistoryBooking.snapshot}
          isAppointment={relatedGuestHistoryBooking.isAppointment}
          presentation="modal"
          stackDepth={0}
          venueTimezone={venueTimezone}
          onClose={() => setRelatedGuestHistoryBooking(null)}
          onUpdated={() => {
            void loadDetail(g.id);
            void loadList();
          }}
        />
      ) : null}

      {newBookingModal ? (
        <StaffSurfaceBookingModal
          open
          onClose={() => setNewBookingModal(null)}
          onCreated={() => {
            setNewBookingModal(null);
            void loadDetail(g.id);
            void loadList();
          }}
          venueId={venueId}
          currency={venueCurrency}
          bookingModel={venueStaffBookingModel}
          enabledModels={venueStaffEnabledBookingModels}
          intent="new"
          advancedMode={tableManagementEnabled}
          staffRebookBootstrap={newBookingModal}
          stackKey={newBookingModalEpoch}
        />
      ) : null}

      <EraseGuestDataModal
        open={eraseConfirmOpen}
        guestDisplayName={displayName}
        clientLower={clientLower}
        bookingWordLower={bookingWord.toLowerCase()}
        busy={eraseLoadingId === g.id}
        onClose={() => {
          if (eraseLoadingId === g.id) return;
          setEraseConfirmOpen(false);
        }}
        onConfirmErase={() => onEraseGuest(g.id)}
      />
    </div>
    </>
  );
}
