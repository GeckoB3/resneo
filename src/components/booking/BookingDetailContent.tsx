'use client';

import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { bookingStatusDisplayLabel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import { bookingTimelineEventsForDisplay } from '@/lib/booking/format-booking-timeline-event';
import {
  BOOKING_DETAIL_MAX_STACK_DEPTH,
  GuestBookingsForGuestAccordion,
} from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { BookingDetailDrawerContext } from '@/components/booking/booking-detail-drawer-context';
import {
  displayBookingGuestName,
  formatDateNice,
  guestFirstLastForBookingRow,
} from '@/app/dashboard/bookings/booking-detail-panel-model';
import {
  ActionButton,
  CompactInfo,
  DepositRefundBanner,
} from '@/app/dashboard/bookings/booking-detail-panel-ui';

export function BookingDetailContent({ ctx }: { ctx: BookingDetailDrawerContext }) {
  const {
    d,
    isPopover,
    panelBodySpacing,
    sectionPadding,
    loading,
    optimisticDetail,
    error,
    startTime,
    endTime,
    serviceLine,
    durationMinutes,
    bookingStyleIsTable,
    depositPaid,
    depositAmountStr,
    canChangeStatus,
    forwardStatuses,
    statusRevertAction,
    forwardLabel,
    revertLabel,
    forwardActionVariant,
    hasAssignedTable,
    tableLine,
    showAppointmentProcessingEditor,
    confirmationSentAt,
    initialSnapshot,
    setGuestHistoryListRefresh,
    actionLoading,
    isHydrated,
    detail,
    updateStatus,
    assignedTables,
    optimisticTableLabel,
    tableManagementEnabled,
    showAssignModal,
    setShowAssignModal,
    suggestionsLoading,
    assignmentSuggestions,
    allTables,
    recommendedTableIds,
    bookingId,
    setActionLoading,
    setError,
    load,
    onUpdated,
    notesVariant,
    modifyBookingOpen,
    setModifyBookingOpen,
    guestHistoryRebookPrefill,
    guestHistoryListRefresh,
    setNestedBookingOpen,
    stackDepth,
    venueTimezone,
    venueCurrency,
    venueId,
    processingBlocksDraft,
    setProcessingBlocksDraft,
    appointmentCoreMinutesForProcessing,
    persistProcessingBlocks,
    runDepositAction,
    executePermanentDelete,
    setConfirmDialog,
    customMessage,
    setCustomMessage,
    guestMessageChannel,
    setGuestMessageChannel,
    onClose,
  } = ctx;

  // De-restaurant the shared drawer: `bookingStyleIsTable` is true only for table
  // reservations (false for appointments and all C/D/E). Table-only chrome (the
  // "Table" tile, the "Table assignment" section, "covers" terminology) is gated on
  // it; for class/event/resource we surface the CDE title and drop table language.
  const isTableStyle = bookingStyleIsTable;
  const inferredModel = d.inferred_booking_model;
  const isCdeModel =
    inferredModel === 'event_ticket' ||
    inferredModel === 'class_session' ||
    inferredModel === 'resource_booking';
  const cdeTitle = d.cde_context?.title?.trim() || null;
  const cdeSubtitle = d.cde_context?.subtitle?.trim() || null;
  /** Party-size noun: dining counts "covers"; everything else counts "guests". */
  const partyNoun = (n: number) => (isTableStyle ? 'cover' : 'guest') + (n === 1 ? '' : 's');
  const partySizeLabel = `${d.party_size} ${partyNoun(d.party_size)}`;

  return (
    <>
          {/* Header - compact */}
          <div className={`sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-br from-white via-white to-brand-50/70 backdrop-blur ${isPopover ? 'px-2.5 py-1.5' : 'px-4 py-3'}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className={`truncate font-semibold text-slate-900 ${isPopover ? 'text-[13px]' : 'text-base'}`}>{d.guest ? displayBookingGuestName(d.guest) : 'Booking'}</h2>
                <BookingStatusPill statusKey={d.status} dot className="shrink-0">
                  {bookingStatusDisplayLabel(d.status, bookingStyleIsTable)}
                </BookingStatusPill>
                {loading && optimisticDetail != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                    Syncing
                  </span>
                )}
              </div>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-medium text-slate-600">
                <span>{formatDateNice(d.booking_date)}</span>
                <span className="text-slate-300">·</span>
                <span className="tabular-nums">{startTime} - {endTime}</span>
                <span className="text-slate-300">·</span>
                <span>{partySizeLabel}</span>
              </p>
              {isCdeModel && cdeTitle ? (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-brand-700">
                  <span className="truncate">{cdeTitle}</span>
                  {cdeSubtitle ? (
                    <>
                      <span className="text-slate-300">·</span>
                      <span className="font-medium text-slate-500">{cdeSubtitle}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                <span className="font-mono">#{d.id.slice(0, 8)}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(d.id)}
                  className="rounded border border-slate-200 px-1 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Copy
                </button>
              </p>
            </div>
            <button type="button" aria-label="Close booking detail" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className={panelBodySpacing}>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
          )}

          <SectionCard className="border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white">
            <SectionCard.Body className={sectionPadding}>
              <div className={isPopover ? 'grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center' : 'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'}>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-brand-600">Booking slot</p>
                  <p className={`font-bold tracking-tight text-slate-950 tabular-nums ${isPopover ? 'text-lg leading-tight' : 'mt-0.5 text-2xl'}`}>{startTime} - {endTime}</p>
                  <p className="text-[11px] text-slate-600">
                    {serviceLine ? `${serviceLine} · ` : ''}{durationMinutes} min · {partySizeLabel}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {showDepositPendingPill(d) ? (
                      <Pill variant="warning" size="sm" dot>
                        Deposit pending
                      </Pill>
                    ) : null}
                    {showAttendanceConfirmedSupplementPill(d) ? (
                      <BookingStatusPill statusKey="Confirmed" dot className="shrink-0">
                        Confirmed
                      </BookingStatusPill>
                    ) : null}
                  </div>
                </div>
                <div className={isPopover ? 'grid grid-cols-2 gap-1.5 sm:min-w-44' : 'grid grid-cols-2 gap-2 sm:min-w-40'}>
                  {isTableStyle ? (
                    <div className={`rounded-lg border px-2 py-1.5 ${hasAssignedTable ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Table</p>
                      <p className={`truncate text-xs font-bold ${hasAssignedTable ? 'text-emerald-900' : 'text-amber-800'}`}>
                        {tableLine ?? 'Unassigned'}
                      </p>
                    </div>
                  ) : isCdeModel ? (
                    <div className="rounded-lg border border-brand-200 bg-brand-50 px-2 py-1.5">
                      <p className="truncate text-[9px] font-semibold uppercase tracking-widest text-brand-600">
                        {inferredModel === 'event_ticket'
                          ? 'Event'
                          : inferredModel === 'class_session'
                            ? 'Class'
                            : 'Resource'}
                      </p>
                      <p className="truncate text-xs font-bold text-brand-900">
                        {cdeTitle ?? serviceLine ?? '—'}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Guests</p>
                      <p className="truncate text-xs font-bold text-slate-700">{partySizeLabel}</p>
                    </div>
                  )}
                  <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Deposit</p>
                    <p className={`truncate text-xs font-bold ${
                      d.deposit_status === 'Paid'
                        ? 'text-emerald-700'
                        : d.deposit_status === 'Pending'
                          ? 'text-amber-700'
                          : 'text-slate-700'
                    }`}>
                      {depositPaid && depositAmountStr
                        ? `${depositAmountStr} paid`
                        : d.deposit_status === 'Not Required'
                          ? 'None'
                          : d.deposit_status}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard.Body>
          </SectionCard>

          {canChangeStatus && (
            isPopover ? (
              <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-2 py-1.5 shadow-sm">
                <span className="mr-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400">Actions</span>
                {forwardStatuses.map((status) => (
                  <ActionButton
                    key={status}
                    onClick={() => updateStatus(status)}
                    disabled={actionLoading || !isHydrated}
                    variant={forwardActionVariant(status)}
                  >
                    {forwardLabel(status)}
                  </ActionButton>
                ))}
                {statusRevertAction?.target ? (
                  <ActionButton
                    onClick={() => updateStatus(statusRevertAction.target!)}
                    disabled={actionLoading || !isHydrated}
                    variant="secondary"
                  >
                    {revertLabel}
                  </ActionButton>
                ) : null}
              </div>
            ) : (
              <SectionCard>
                <SectionCard.Body className={sectionPadding}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Next action</p>
                      <p className="mt-0.5 text-xs text-slate-500">Update this booking without leaving the grid.</p>
                    </div>
                    <BookingStatusPill statusKey={d.status} dot>
                      {bookingStatusDisplayLabel(d.status, bookingStyleIsTable)}
                    </BookingStatusPill>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                  {forwardStatuses.map((status) => (
                    <ActionButton
                      key={status}
                      onClick={() => updateStatus(status)}
                      disabled={actionLoading || !isHydrated}
                      variant={forwardActionVariant(status)}
                    >
                      {forwardLabel(status)}
                    </ActionButton>
                  ))}
                  {statusRevertAction?.target ? (
                    <ActionButton
                      onClick={() => updateStatus(statusRevertAction.target!)}
                      disabled={actionLoading || !isHydrated}
                      variant="secondary"
                    >
                      {revertLabel}
                    </ActionButton>
                  ) : null}
                  </div>
                </SectionCard.Body>
              </SectionCard>
            )
          )}

          {/* Guest + summary row */}
          <div className={isPopover ? 'grid gap-1.5 md:grid-cols-2' : 'grid gap-2.5'}>
            <SectionCard>
              <SectionCard.Body className={sectionPadding}>
                <div className={isPopover ? 'flex items-start gap-2' : 'flex items-start gap-3'}>
                  <div className={`${isPopover ? 'h-8 w-8 rounded-lg text-xs' : 'h-10 w-10 rounded-xl text-sm'} flex shrink-0 items-center justify-center bg-brand-50 font-bold text-brand-700 ring-1 ring-brand-100`}>
                    {displayBookingGuestName(d.guest, initialSnapshot?.guestName).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">{displayBookingGuestName(d.guest, initialSnapshot?.guestName)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {(d.guest?.visit_count ?? 0) > 0 ? `${d.guest?.visit_count} visit${(d.guest?.visit_count ?? 0) !== 1 ? 's' : ''}` : 'First visit'}
                    </p>
                  </div>
                </div>
                <div className={`${isPopover ? 'mt-1.5 space-y-0.5 border-t border-slate-100 pt-1.5' : 'mt-3 space-y-1.5 border-t border-slate-100 pt-3'}`}>
                  {d.guest?.email ? (
                    <a href={`mailto:${d.guest.email}`} className="flex items-center gap-2 text-xs text-slate-600 transition-colors hover:text-brand-600">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" /></svg>
                      <span className="truncate">{d.guest.email}</span>
                    </a>
                  ) : !isPopover ? (
                    <p className="text-xs italic text-slate-400">No email on file</p>
                  ) : null}
                  {d.guest?.phone ? (
                    <a href={`tel:${d.guest.phone}`} className="flex items-center gap-2 text-xs text-slate-600 transition-colors hover:text-brand-600">
                      <svg className="h-3.5 w-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" /></svg>
                      {d.guest.phone}
                    </a>
                  ) : !isPopover ? (
                    <p className="text-xs italic text-slate-400">No phone on file</p>
                  ) : null}
                  {d.guest?.id ? (
                    <div className="pt-1">
                      <GuestTagEditor
                        tags={Array.isArray(d.guest.tags) ? d.guest.tags : []}
                        venueId={d.venue_id}
                        onTagsChange={async (nextTags) => {
                          const res = await fetch(`/api/venue/guests/${d.guest!.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ tags: nextTags }),
                          });
                          if (!res.ok) {
                            const j = (await res.json().catch(() => ({}))) as { error?: string };
                            throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                          }
                          await load();
                          onUpdated();
                        }}
                      />
                    </div>
                  ) : null}
                  {d.guest?.id && (!isPopover || d.guest.customer_profile_notes) ? (
                    <CustomerProfileNotesCard
                      embedded
                      guestId={d.guest.id}
                      value={d.guest.customer_profile_notes}
                      disabled={!isHydrated}
                      onSaved={() => {
                        void (async () => {
                          await load();
                          onUpdated();
                        })();
                      }}
                    />
                  ) : null}
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="mb-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                        Notes and preferences
                      </p>
                    </div>
                    {d.occasion ? (
                      <div className="mb-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Occasion</p>
                        <div className="rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-violet-900">
                          {d.occasion}
                        </div>
                      </div>
                    ) : null}
                    <BookingNotesEditablePanel
                      bookingId={bookingId}
                      dietaryNotes={d.dietary_notes}
                      guestRequests={d.special_requests}
                      staffNotes={d.internal_notes}
                      disabled={!isHydrated}
                      notesVariant={notesVariant}
                      compact
                      embedded
                      onSaved={() => {
                        void (async () => {
                          await load();
                          onUpdated();
                        })();
                      }}
                    />
                  </div>
                </div>
              </SectionCard.Body>
            </SectionCard>

            {isHydrated && d.guest?.id ? (
              <div className="col-span-full w-full min-w-0">
                <GuestBookingsForGuestAccordion
                  guestId={d.guest.id}
                  currentBookingId={bookingId}
                  guestDisplayNameForSnapshots={displayBookingGuestName(d.guest, initialSnapshot?.guestName)}
                  venueTimeZone={venueTimezone}
                  canOpenNested={stackDepth + 1 < BOOKING_DETAIL_MAX_STACK_DEPTH}
                  onOpenBookingDetail={(payload) => {
                    setNestedBookingOpen({
                      id: payload.bookingId,
                      snapshot: payload.snapshot,
                      isAppointment: !isTableReservationBooking(payload.row),
                    });
                  }}
                  listRefreshKey={guestHistoryListRefresh}
                  rebookGuestPrefill={guestHistoryRebookPrefill}
                  onStaffBookingCreated={() => {
                    setGuestHistoryListRefresh((k) => k + 1);
                    void load();
                  }}
                />
              </div>
            ) : null}

            <SectionCard>
              <SectionCard.Body className={sectionPadding}>
                <div className={`grid grid-cols-2 gap-x-3 ${isPopover ? 'gap-y-1' : 'gap-y-2.5'}`}>
                  <CompactInfo dense={isPopover} label="Date" value={formatDateNice(d.booking_date)} />
                  <CompactInfo dense={isPopover} label="Time" value={`${startTime} – ${endTime}`} />
                  {d.area_name ? <CompactInfo dense={isPopover} label="Area" value={d.area_name} /> : null}
                  <CompactInfo dense={isPopover} label={isTableStyle ? 'Covers' : 'Guests'} value={String(d.party_size)} />
                  <CompactInfo
                    dense={isPopover}
                    label="Deposit"
                    value={
                      depositPaid && depositAmountStr
                        ? `${depositAmountStr} paid`
                        : d.deposit_status === 'Not Required'
                          ? 'None'
                          : d.deposit_status
                    }
                    valueClass={
                      d.deposit_status === 'Paid'
                        ? 'text-emerald-700'
                        : d.deposit_status === 'Pending'
                          ? 'text-amber-700'
                          : 'text-slate-600'
                    }
                  />
                  <CompactInfo dense={isPopover} label="Duration" value={`${durationMinutes} min`} />
                  <CompactInfo dense={isPopover} label="Source" value={d.source} />
                </div>
                {d.location_type === 'client_address' || d.location_type === 'online' ? (
                  <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Location</p>
                    {d.location_type === 'online' ? (
                      <p className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200/80">
                        Online appointment
                      </p>
                    ) : (
                      <div className="mt-1 rounded-lg border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                          At the client&apos;s address
                        </p>
                        <p className="mt-0.5 text-[11px] leading-snug text-emerald-950">
                          {[
                            d.client_address_line1,
                            d.client_address_line2,
                            d.client_address_city,
                            d.client_address_postcode,
                          ]
                            .map((p) => (p ?? '').trim())
                            .filter(Boolean)
                            .join(', ') || 'Address not recorded — contact the client to confirm.'}
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}
                {d.addons && d.addons.length > 0 ? (
                  <div className="col-span-2 mt-2.5 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Extras</p>
                    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                      {d.addons.map((a) => (
                        <li key={a.id} className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            {a.addon_group_name_snapshot ? (
                              <span className="text-slate-500">{a.addon_group_name_snapshot}: </span>
                            ) : null}
                            <span className="font-medium text-slate-800">{a.addon_name_snapshot}</span>
                            {a.duration_minutes_at_booking > 0 ? (
                              <span className="ml-1 text-slate-500">(+{a.duration_minutes_at_booking} min)</span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            +{currencySymbolFromCode(venueCurrency ?? 'GBP')}
                            {(a.price_pence_at_booking / 100).toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {isHydrated && !isPopover && (
                  <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Created</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                      {d.created_by ? ` · ${d.created_by}` : ''}
                    </p>
                  </div>
                )}
              </SectionCard.Body>
            </SectionCard>

            {showAppointmentProcessingEditor ? (
              <SectionCard>
                <SectionCard.Body className={sectionPadding}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Processing time</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Gaps inside this appointment where another booking can be scheduled. Guests still see the full
                    service length.
                  </p>
                  <div className="mt-2">
                    <ProcessingTimeTimelineEditor
                      durationMinutes={appointmentCoreMinutesForProcessing}
                      bufferMinutes={0}
                      blocks={processingBlocksDraft}
                      onChange={setProcessingBlocksDraft}
                      compact={isPopover}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => void persistProcessingBlocks()}
                    className="mt-3 w-full rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    Save processing time
                  </button>
                </SectionCard.Body>
              </SectionCard>
            ) : null}
          </div>

          {confirmationSentAt && !isPopover && (
            <p className="text-[11px] text-slate-500">Confirmation sent {new Date(confirmationSentAt).toLocaleString()}</p>
          )}
          <button
            type="button"
            disabled={actionLoading || !isHydrated}
            onClick={async () => {
              setActionLoading(true);
              try {
                const res = await fetch(`/api/venue/bookings/${bookingId}/resend-confirmation`, { method: 'POST' });
                if (!res.ok) {
                  const payload = await res.json().catch(() => ({}));
                  setError(payload.error ?? 'Failed to resend confirmation');
                  return;
                }
                setError(null);
                await load();
              } finally {
                setActionLoading(false);
              }
            }}
            className={`w-full rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 ${isPopover ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
          >
            Resend confirmation
          </button>

          <SectionCard>
            <SectionCard.Body className={sectionPadding}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Deposit</p>
                {d.deposit_status === 'Paid' && (
                  <Pill variant="success" size="sm" dot>{depositAmountStr ? `${depositAmountStr} paid` : 'Paid'}</Pill>
                )}
                {d.deposit_status === 'Refunded' && (
                  <Pill variant="brand" size="sm">{depositAmountStr ? `${depositAmountStr} refunded` : 'Refunded'}</Pill>
                )}
                {d.deposit_status === 'Pending' && (
                  <Pill variant="warning" size="sm" dot>Pending</Pill>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {d.deposit_status !== 'Paid' && d.deposit_status !== 'Refunded' && (
                  <>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('send_payment_link')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Send payment link
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('waive')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Waive
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading || !isHydrated}
                      onClick={() => runDepositAction('record_cash')}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      Record cash
                    </button>
                  </>
                )}
                {d.deposit_status === 'Paid' && (
                  <button
                    type="button"
                    disabled={actionLoading || !isHydrated}
                    onClick={() => runDepositAction('refund')}
                    className="rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    Refund deposit
                  </button>
                )}
              </div>
            </SectionCard.Body>
          </SectionCard>

          {/* Table assignment — table-only; never shown for class/event/resource. */}
          {!isCdeModel && (tableManagementEnabled || assignedTables.length > 0) && (() => {
            const tableLine =
              optimisticTableLabel ??
              (assignedTables.length > 0 ? assignedTables.map((t) => t.name).join(' + ') : null);
            const hasTable = Boolean(tableLine);
            return (
              <SectionCard className={!hasTable ? 'border-amber-200 bg-amber-50/40' : ''}>
                <SectionCard.Body className={sectionPadding}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Table</p>
                      <p className={`mt-0.5 truncate text-sm font-semibold ${hasTable ? 'text-slate-900' : 'text-amber-700'}`}>
                        {hasTable ? tableLine : 'No table assigned'}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={!isHydrated || actionLoading}
                      onClick={() => setShowAssignModal(true)}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                    >
                      {hasTable ? 'Reassign' : 'Assign'}
                    </button>
                  </div>
                  {isHydrated && detail?.combination_staff_notes ? (
                    <p className={isPopover ? 'mt-2 border-t border-slate-100 pt-2 text-xs leading-snug text-slate-600' : 'mt-2.5 border-t border-slate-100 pt-2.5 text-xs leading-snug text-slate-600'}>
                      <span className="font-medium text-slate-700">Combination note: </span>
                      {detail.combination_staff_notes}
                    </p>
                  ) : null}
                </SectionCard.Body>
              </SectionCard>
            );
          })()}

          {!isCdeModel && showAssignModal && (
            <div className={`rounded-xl border border-brand-200 bg-brand-50/30 ${isPopover ? 'p-3' : 'p-4'}`}>
              <p className="mb-2 text-sm font-medium text-slate-900">Table Assignment</p>
              {suggestionsLoading ? (
                <p className="mb-3 text-xs text-slate-500">Finding best table options...</p>
              ) : assignmentSuggestions.length > 0 ? (
                <div className="mb-3 space-y-2">
                  {assignmentSuggestions.slice(0, 6).map((suggestion, idx) => (
                    <button
                      key={`${suggestion.table_ids.join('|')}-${suggestion.source}`}
                      type="button"
                      disabled={actionLoading}
                      onClick={async () => {
                        setActionLoading(true);
                        try {
                          const assignRes = await fetch('/api/venue/tables/assignments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(assignedTables.length > 0
                              ? {
                                  action: 'reassign',
                                  booking_id: bookingId,
                                  old_table_ids: assignedTables.map((x) => x.id),
                                  new_table_ids: suggestion.table_ids,
                                }
                              : { booking_id: bookingId, table_ids: suggestion.table_ids }
                            ),
                          });
                          if (!assignRes.ok) {
                            const payload = await assignRes.json().catch(() => ({}));
                            setError(payload.error ?? 'Failed to assign tables');
                            return;
                          }
                          setShowAssignModal(false);
                          await load();
                          onUpdated();
                        } finally { setActionLoading(false); }
                      }}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        idx === 0
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{suggestion.table_names.join(' + ')}</span>
                        <span className="text-[10px] uppercase">
                          {suggestion.source === 'manual' ? 'Pre-configured' : suggestion.source === 'auto' ? 'Auto-detected' : 'Single'}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px]">
                        Capacity {suggestion.combined_capacity} • Spare {suggestion.spare_covers}
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-xs text-slate-500">No ranked suggestions available. Choose manually below.</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {allTables.map((t) => (
                  <button
                    key={t.id}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        const assignRes = await fetch('/api/venue/tables/assignments', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(assignedTables.length > 0
                            ? { action: 'reassign', booking_id: bookingId, old_table_ids: assignedTables.map((x) => x.id), new_table_ids: [t.id] }
                            : { booking_id: bookingId, table_ids: [t.id] }
                          ),
                        });
                        if (!assignRes.ok) {
                          const payload = await assignRes.json().catch(() => ({}));
                          setError(payload.error ?? 'Failed to assign table');
                          return;
                        }
                        setShowAssignModal(false);
                        await load();
                        onUpdated();
                      } finally { setActionLoading(false); }
                    }}
                    disabled={actionLoading}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      assignedTables.some((at) => at.id === t.id)
                        ? 'border-brand-300 bg-brand-50 text-brand-700'
                        : recommendedTableIds.includes(t.id)
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {t.name} ({t.max_covers}){recommendedTableIds.includes(t.id) ? ' • Recommended' : ''}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAssignModal(false)} className="mt-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          )}

          {/* Deposit refund status banner */}
          {d.status === 'Cancelled' && d.deposit_amount_pence != null && d.deposit_amount_pence > 0 && (
            <DepositRefundBanner depositStatus={d.deposit_status} depositAmount={depositAmountStr!} cancellationDeadline={d.cancellation_deadline} refundNoticeHours={(d as { refund_notice_hours?: number | null }).refund_notice_hours ?? null} />
          )}

          {d.status === 'Cancelled' && (
            <SectionCard className="border-red-100 bg-red-50/20">
              <SectionCard.Body className={sectionPadding}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-600/80">Remove from diary</p>
                <p className="mb-3 text-xs text-slate-600">
                  Permanently delete this cancelled booking and its communications log. This cannot be undone.
                </p>
                <ActionButton
                  onClick={() => {
                    setConfirmDialog({
                      title: 'Delete booking permanently?',
                      message: `${displayBookingGuestName(d.guest, initialSnapshot?.guestName)} (${d.party_size}) on ${d.booking_date} at ${d.booking_time?.slice(0, 5) ?? ''} will be removed from the system.`,
                      confirmLabel: 'Delete permanently',
                      onConfirm: () => { void executePermanentDelete(); },
                    });
                  }}
                  disabled={actionLoading || !isHydrated}
                  variant="outline-danger"
                >
                  Delete booking permanently
                </ActionButton>
              </SectionCard.Body>
            </SectionCard>
          )}

          {/* Modify booking — table, appointment, or details-only (CDE) */}
          {['Pending', 'Booked', 'Confirmed', 'Seated'].includes(String(d.status)) && (
            <>
              <button
                type="button"
                disabled={!isHydrated}
                onClick={() => {
                  setModifyBookingOpen(true);
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Modify booking
              </button>
              {modifyBookingOpen ? (
                <StaffExpandedBookingModifyModal
                  open
                  onClose={() => {
                    setModifyBookingOpen(false);
                  }}
                  onSaved={async () => {
                    await load();
                    onUpdated();
                    setModifyBookingOpen(false);
                  }}
                  venueId={d.venue_id || venueId || ''}
                  venueCurrency={venueCurrency ?? 'GBP'}
                  tableManagementEnabled={tableManagementEnabled}
                  booking={{
                    id: d.id,
                    booking_date: d.booking_date,
                    booking_time: d.booking_time,
                    party_size: d.party_size,
                    estimated_end_time: d.estimated_end_time,
                    status: d.status,
                    deposit_status: d.deposit_status,
                    dietary_notes: d.dietary_notes,
                    occasion: d.occasion,
                    guest_name: displayBookingGuestName(d.guest, initialSnapshot?.guestName),
                    ...guestFirstLastForBookingRow(d.guest ?? null, initialSnapshot?.guestName),
                    guest_email: d.guest?.email ?? null,
                    guest_phone: d.guest?.phone ?? null,
                    inferred_booking_model: d.inferred_booking_model,
                    booking_model: d.booking_model,
                    experience_event_id: d.experience_event_id,
                    class_instance_id: d.class_instance_id,
                    resource_id: d.resource_id,
                    event_session_id: d.event_session_id,
                    calendar_id: d.calendar_id,
                    service_item_id: d.service_item_id,
                    practitioner_id: d.practitioner_id,
                    appointment_service_id: d.appointment_service_id,
                    booking_end_time: d.booking_end_time ?? null,
                    service_variant_id: d.service_variant_id ?? null,
                    processing_time_blocks: d.processing_time_blocks ?? null,
                    area_id: d.area_id,
                    table_assignments: assignedTables.length > 0 ? assignedTables : d.table_assignments,
                  }}
                  detail={{
                    special_requests: d.special_requests,
                    internal_notes: d.internal_notes,
                    guest: d.guest
                      ? {
                          first_name: d.guest.first_name,
                          last_name: d.guest.last_name,
                          email: d.guest.email,
                          phone: d.guest.phone,
                        }
                      : null,
                  }}
                />
              ) : null}
            </>
          )}

          <div className={isPopover ? 'grid gap-1.5 md:grid-cols-2' : 'grid gap-3'}>
          {/* Timeline */}
          <SectionCard>
            <SectionCard.Body className={sectionPadding}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Timeline</p>
              {(() => {
                const timelineRows = bookingTimelineEventsForDisplay(d.events);
                if (timelineRows.length === 0) {
                  return (
                    <p className="text-xs text-slate-400">{isHydrated ? 'No events yet.' : '…'}</p>
                  );
                }
                return (
                <div className={`${isPopover ? 'max-h-28 space-y-1.5' : 'max-h-36 space-y-2'} overflow-y-auto pr-1`}>
                  {timelineRows.map((ev) => (
                    <div key={ev.id} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100">
                        <span className="h-1 w-1 rounded-full bg-slate-400" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-slate-700">{ev.title}</span>
                        <span className="ml-1.5 text-[10px] text-slate-400">
                          {new Date(ev.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {ev.detail ? (
                          <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{ev.detail}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                );
              })()}
            </SectionCard.Body>
          </SectionCard>

          {/* Communications */}
          <SectionCard>
            <SectionCard.Body className={sectionPadding}>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Communications</p>
              {d.communications && d.communications.length > 0 && (
                <div className={`${isPopover ? 'mb-2 max-h-24' : 'mb-3 max-h-32'} space-y-1.5 overflow-y-auto pr-1`}>
                  {d.communications.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <Pill variant={c.channel === 'email' ? 'brand' : 'success'} size="sm">{c.channel}</Pill>
                      <span className="font-medium text-slate-700">{c.message_type.replace(/_/g, ' ')}</span>
                      <span className={`text-[10px] font-medium ${c.status === 'sent' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {c.status}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(c.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className={`rounded-xl border border-slate-100 bg-slate-50/80 ${isPopover ? 'p-2' : 'p-3'}`}>
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Send message via</span>
                  <GuestMessageChannelSelect
                    value={guestMessageChannel}
                    onChange={setGuestMessageChannel}
                    disabled={actionLoading || !isHydrated}
                  />
                </div>
                <textarea
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  rows={isPopover ? 1 : 2}
                  className={`w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-200 ${isPopover ? 'py-1.5' : 'py-2'}`}
                  placeholder="SMS / email to guest…"
                />
                <button
                  type="button"
                  disabled={actionLoading || customMessage.trim().length === 0 || !isHydrated}
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: customMessage, channel: guestMessageChannel }),
                      });
                      const payload = (await res.json().catch(() => ({}))) as {
                        success?: boolean;
                        error?: string;
                        errors?: string[];
                      };
                      if (!res.ok || !payload.success) {
                        const detail =
                          (payload.errors && payload.errors.length > 0
                            ? payload.errors.join('; ')
                            : payload.error) ?? 'Failed to send message';
                        setError(detail);
                        return;
                      }
                      if (payload.errors && payload.errors.length > 0) {
                        setError(`Partially sent — ${payload.errors.join('; ')}`);
                      } else {
                        setError(null);
                      }
                      setCustomMessage('');
                      await load();
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  className="mt-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </SectionCard.Body>
          </SectionCard>
          </div>
        </div>
    </>
  );
}
