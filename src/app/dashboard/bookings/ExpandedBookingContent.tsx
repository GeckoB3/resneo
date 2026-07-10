'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BOOKING_PRIMARY_ACTIONS,
  BOOKING_REVERT_ACTIONS,
  canTransitionBookingStatus,
  isBookingInstantRevertTransition,
  isDestructiveBookingStatus,
  isRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import type { BookingNotesVariant } from '@/components/booking/BookingNotesEditablePanel';
import type { BookingModel } from '@/types/booking-models';
import {
  bookingStatusDisplayLabel,
  inferBookingRowModel,
} from '@/lib/booking/infer-booking-row-model';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { phoneToTelHref } from '@/lib/phone/e164';
import Link from 'next/link';
import { currencySymbolFromCode } from '@/lib/money/currency-symbol';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { ComplianceSection } from '@/components/dashboard/compliance/ComplianceSection';
import { useAppointmentsFeatureFlag } from '@/components/providers/VenueFeatureFlagsProvider';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionMessagingBodyClass,
  bookingExpandAccordionSummaryClass,
  bookingExpandActionsBarClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';
import {
  EXP_BOOKING_AMBER_ATTN,
  EXP_BOOKING_BTN,
  EXP_BOOKING_DANGER,
  EXP_BOOKING_DANGER_ROSE,
  EXP_BOOKING_ICO,
  EXP_BOOKING_NEUTRAL,
  EXP_BOOKING_NEUTRAL_PROMINENT,
  EXP_BOOKING_REVERT,
  EXP_BOOKING_SOFT,
  EXP_BOOKING_SPIN_AM,
  EXP_BOOKING_SPIN_NA,
  EXP_BOOKING_ST_FOCUS,
  NO_EXTRA_ENABLED_BOOKING_MODELS,
} from '@/app/dashboard/bookings/expanded-booking-toolbar-classes';
import {
  BOOKING_DETAIL_MAX_STACK_DEPTH,
  GuestBookingsForGuestAccordion,
  type GuestHistoryRelatedBookingPayload,
} from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { StaffRebookBootstrapPayloadV1, StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';
import { buildStaffRebookBootstrapFromBookingSource } from '@/lib/booking/staff-rebook-from-booking-source';
import { defaultStaffBookingSurfaceTab } from '@/lib/booking/staff-booking-modal-options';
import { formatGuestDisplayName } from '@/lib/guests/name';
import {
  canShowCancelStaffAttendanceConfirmationAction,
  canShowConfirmBookingAttendanceAction,
  isAttendanceConfirmed,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON,
  BOOKING_ATTENDANCE_CONFIRM_SPINNER,
  BOOKING_ATTENDANCE_UNDO_SPINNER,
  BOOKING_BOOKED_LIGHT_BUTTON,
  bookingTransitionButtonSurface,
} from '@/lib/table-management/booking-status-visual';
import { StaffSurfaceBookingModal } from '@/components/booking/StaffSurfaceBookingModal';
import { useOptionalDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import { bookingDetailLiteFromCachePayload } from '@/lib/booking/resolve-booking-detail-lite';
import { mapContactGuestHistoryToAccordionRows } from '@/lib/booking/map-contact-guest-history';
import { guestStubFromBookingRow } from '@/lib/booking/booking-row-guest-stub';
import {
  bookingDetailLiteFromListRow,
  expandedBookingOfferingLine,
  resolveExpandedBookingServiceLine,
} from '@/lib/booking/booking-detail-from-row';
import {
  applyStatusToAllGroupVisitRows,
  applyVisitAttendanceConfirmToGroupVisitRows,
  fetchGroupVisitBookings,
  formatDurationMinutesLabel,
  formatGroupVisitSegmentDurationLabel,
  invalidateGroupVisitBookings,
  groupVisitSegmentPillStatus,
  mergeGroupVisitRowsWithSeeds,
  mergePreferLaterGroupVisitRows,
  multiServiceVisitDatePhrase,
  peekGroupVisitBookings,
  primeGroupVisitBookings,
  resolveVisitPillAnchorStatus,
  type GroupVisitBookingRow,
} from '@/lib/booking/group-visit-bookings';

export type { GroupVisitBookingRow } from '@/lib/booking/group-visit-bookings';
import {
  mergeBookingRowOverlay,
  overlayFromPatchBody,
  overlayFromPatchPayloadForBody,
  overlayFromStatusTransition,
  pruneBookingRowOverlay,
  retainBookingRowOverlay,
  type BookingRowOverlay,
} from '@/lib/booking/booking-row-overlay';
import { formatCommunicationLogLabel } from '@/lib/communications/display-labels';
import { bookingTimelineEventsForDisplay } from '@/lib/booking/format-booking-timeline-event';
import {
  resolveCardHoldUiState,
  type CardHoldSummary,
} from '@/components/booking/card-hold-ui-state';
import { CardHoldDetailSection } from '@/components/booking/CardHoldDetailSection';
import { useDashboardToolbarVenueOptional } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';

export interface BookingRow {
  id: string;
  booking_date: string;
  booking_time: string;
  estimated_end_time: string | null;
  created_at: string | null;
  party_size: number;
  status: string;
  source: string;
  deposit_status: string;
  deposit_amount_pence: number | null;
  dietary_notes: string | null;
  occasion: string | null;
  special_requests?: string | null;
  internal_notes?: string | null;
  guest_name: string;
  guest_first_name?: string | null;
  guest_last_name?: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_id?: string;
  guest_visit_count?: number | null;
  table_assignments?: Array<{ id: string; name: string }>;
  service_id?: string | null;
  group_booking_id?: string | null;
  person_label?: string | null;
  area_id?: string | null;
  area_name?: string | null;
  experience_event_id?: string | null;
  class_instance_id?: string | null;
  resource_id?: string | null;
  event_session_id?: string | null;
  calendar_id?: string | null;
  service_item_id?: string | null;
  practitioner_id?: string | null;
  appointment_service_id?: string | null;
  /** Wall-clock end of bookable segment; drives staff appointment modify duration. */
  booking_end_time?: string | null;
  service_variant_id?: string | null;
  processing_time_blocks?: unknown | null;
  booking_model?: string | null;
  service_name?: string | null;
  booking_item_name?: string | null;
  service_variant_name?: string | null;
  booking_addon_labels?: string[];
  guest_attendance_confirmed_at?: string | null;
  staff_attendance_confirmed_at?: string | null;
  /** Practitioner calendar / day-sheet "Arrived" indicator; PATCH via `client_arrived`. */
  client_arrived_at?: string | null;
  inferred_booking_model?: BookingModel;
  /** Service delivery location snapshot; null/omitted = business venue (legacy rows). */
  location_type?: string | null;
  client_address_line1?: string | null;
  client_address_line2?: string | null;
  client_address_city?: string | null;
  client_address_postcode?: string | null;
}

export interface BookingDetailLite {
  id: string;
  special_requests: string | null;
  internal_notes: string | null;
  cancellation_deadline: string | null;
  checked_in_at?: string | null;
  table_assignments?: Array<{ id: string; name: string }>;
  guest: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    visit_count: number;
    last_visit_date?: string | null;
    tags?: string[];
    customer_profile_notes?: string | null;
  } | null;
  communications: Array<{
    id: string;
    message_type: string;
    channel: string;
    status: string;
    created_at: string;
    recipient?: string | null;
    error_message?: string | null;
  }>;
  events: Array<{
    id: string;
    event_type: string;
    created_at: string;
    payload?: Record<string, unknown> | null;
  }>;
  combination_staff_notes?: string | null;
  /** Card-hold summary from GET /api/venue/bookings/[id] (§9.1); null = no hold row. */
  card_hold?: CardHoldSummary | null;
  /** The service's payment mode ('full_payment' | 'deposit' | 'card_hold' | 'none'); null when not an appointment service booking. */
  service_payment_requirement?: string | null;
  cde_context?: {
    inferred_model: BookingModel;
    title: string;
    subtitle?: string | null;
    /** Optional enrichment from resolveCdeBookingContext (event tickets / class roster / resource duration). */
    ticket_summary?: string | null;
    ticket_total_quantity?: number | null;
    roster_summary?: string | null;
    duration_minutes?: number | null;
  } | null;
  inferred_booking_model?: BookingModel;
  service_variant_name?: string | null;
  addons?: Array<{
    id: string;
    booking_id: string;
    addon_id: string | null;
    addon_group_id: string | null;
    booking_segment_index: number | null;
    addon_name_snapshot: string;
    addon_group_name_snapshot: string | null;
    price_pence_at_booking: number;
    duration_minutes_at_booking: number;
    cost_to_business_pence_at_booking: number | null;
    created_at?: string;
  }>;
  addons_total_price_pence?: number | null;
  addons_total_duration_minutes?: number | null;
}

function formatRelative(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDateNice(value: string): string {
  const d = new Date(value + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return value;
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * CDE context card is omitted when the title already appears in the header summary row,
 * or when the model always surfaces the offering in the list row header.
 */
const BOOKING_MODELS_OMITTING_CDE_CONTEXT_CARD: ReadonlySet<BookingModel> = new Set([
  'class_session',
  'event_ticket',
  'resource_booking',
  'practitioner_appointment',
  'unified_scheduling',
]);

function guestMessageSuccessCaption(channel: GuestMessageChannel): string {
  switch (channel) {
    case 'email':
      return 'Email sent to the guest.';
    case 'sms':
      return 'SMS sent to the guest.';
    case 'both':
      return 'Message sent by email and/or SMS (where contact details exist).';
    default:
      return 'Message sent.';
  }
}

export function ExpandedBookingContent({
  booking,
  detail,
  detailLoading,
  tableManagementEnabled,
  venueId,
  draftMessage,
  sendingMessage,
  onMessageDraftChange,
  onSendMessage,
  onStatusAction,
  onDetailUpdated,
  onRequestChangeTable,
  venueCurrency = 'GBP',
  venueTimezone = 'Europe/London',
  guestHistoryListRefresh = 0,
  onOpenRelatedGuestBooking,
  relatedBookingsStackDepth = 0,
  venueStaffBookingModel,
  venueStaffEnabledBookingModels,
  linkedAct,
  initialGroupVisitBookings,
}: {
  booking: BookingRow;
  detail: BookingDetailLite | undefined;
  detailLoading: boolean;
  tableManagementEnabled: boolean;
  venueId: string;
  venueCurrency?: string;
  /** Venue IANA zone; drives upcoming vs previous in “Guest bookings”. */
  venueTimezone?: string;
  /** Bump when booking detail reloads so guest history refetches. */
  guestHistoryListRefresh?: number;
  /** Open nested booking detail (e.g. BookingDetailPanel overlay). */
  onOpenRelatedGuestBooking?: (payload: GuestHistoryRelatedBookingPayload) => void;
  /** Current depth of nested detail stack (0 = inline row or root panel). */
  relatedBookingsStackDepth?: number;
  draftMessage: string;
  sendingMessage: boolean;
  onMessageDraftChange: (value: string) => void;
  onSendMessage: (channel: GuestMessageChannel) => GuestMessageSendResult | Promise<GuestMessageSendResult>;
  onStatusAction: (status: BookingStatus) => void | Promise<void>;
  onDetailUpdated: () => void;
  onRequestChangeTable?: () => void;
  /** Venue primary + enabled models for staff “New booking” default tab (falls back to this row’s inferred model). */
  venueStaffBookingModel?: BookingModel;
  venueStaffEnabledBookingModels?: BookingModel[];
  /** When set, restricts toolbar actions to what the linked-account grant allows (§5.3). */
  linkedAct?: import('@/lib/linked-accounts/types').LinkActionLevel;
  /** Sibling rows already loaded in the parent list — avoids a wait on expand. */
  initialGroupVisitBookings?: GroupVisitBookingRow[];
}) {
  const [showMessageBox, setShowMessageBox] = useState(false);
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('email');
  const messageTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [guestMessageFeedback, setGuestMessageFeedback] = useState<{
    tone: 'success' | 'error' | 'warning';
    text: string;
  } | null>(null);
  const [modifyBookingOpen, setModifyBookingOpen] = useState(false);
  const [staffBookingModal, setStaffBookingModal] = useState<
    null | { mode: 'new' | 'rebook'; bootstrap: StaffRebookBootstrapPayloadV1 }
  >(null);
  const [confirmAction, setConfirmAction] = useState<{ status: BookingStatus; label: string } | null>(null);
  const [inlineActionLoading, setInlineActionLoading] = useState<string | null>(null);
  const [statusActionPending, setStatusActionPending] = useState(false);
  const [refCopied, setRefCopied] = useState(false);
  const complianceEnabled = useAppointmentsFeatureFlag('compliance_records_enabled');
  const [inlineActionError, setInlineActionError] = useState<string | null>(null);
  const [groupVisitBookings, setGroupVisitBookings] = useState<GroupVisitBookingRow[]>(
    () => initialGroupVisitBookings ?? [],
  );
  const [groupVisitLoading, setGroupVisitLoading] = useState(false);
  /**
   * After lifecycle Confirmed→Booked (“Undo confirm”), the parent often briefly shows `Booked` while
   * attendance timestamps are still present; that wrongly enables PATCH “Cancel confirmation”. Suppress
   * until rows match or a short timeout (state so clearing re-renders).
   */
  const [suppressPatchCancelAfterUndoConfirm, setSuppressPatchCancelAfterUndoConfirm] = useState(false);
  /** Optimistic list-row patch so action buttons update before parent refetch completes. */
  const [rowOverlay, setRowOverlay] = useState<BookingRowOverlay>({});

  useEffect(() => {
    setSuppressPatchCancelAfterUndoConfirm(false);
    setStatusActionPending(false);
    setRefCopied(false);
    setRowOverlay({});
  }, [booking.id]);

  useEffect(() => {
    setRowOverlay((prev) => retainBookingRowOverlay(prev, booking));
  }, [
    booking.status,
    booking.client_arrived_at,
    booking.staff_attendance_confirmed_at,
    booking.guest_attendance_confirmed_at,
    booking.deposit_status,
    booking.deposit_amount_pence,
  ]);

  useEffect(() => {
    setStatusActionPending(false);
  }, [
    booking.status,
    booking.staff_attendance_confirmed_at,
    booking.guest_attendance_confirmed_at,
    booking.client_arrived_at,
    rowOverlay.status,
    rowOverlay.staff_attendance_confirmed_at,
    rowOverlay.guest_attendance_confirmed_at,
  ]);

  useEffect(() => {
    if (!suppressPatchCancelAfterUndoConfirm) return;
    const row = { ...booking, ...rowOverlay };
    if (
      !isAttendanceConfirmed({
        status: row.status,
        guest_attendance_confirmed_at: row.guest_attendance_confirmed_at ?? null,
        staff_attendance_confirmed_at: row.staff_attendance_confirmed_at ?? null,
      })
    ) {
      setSuppressPatchCancelAfterUndoConfirm(false);
      return;
    }
    const t = window.setTimeout(() => setSuppressPatchCancelAfterUndoConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [
    suppressPatchCancelAfterUndoConfirm,
    booking.status,
    booking.guest_attendance_confirmed_at,
    booking.staff_attendance_confirmed_at,
    rowOverlay.status,
    rowOverlay.guest_attendance_confirmed_at,
    rowOverlay.staff_attendance_confirmed_at,
  ]);

  const detailCache = useOptionalDashboardDetailCache();
  const resolvedGroupBookingId =
    booking.group_booking_id ??
    (detailCache?.peekVenueBookingDetail(booking.id) as { group_booking_id?: string | null } | undefined)
      ?.group_booking_id ??
    null;

  useEffect(() => {
    if (!resolvedGroupBookingId) {
      setGroupVisitBookings([]);
      setGroupVisitLoading(false);
      return;
    }

    const cached = peekGroupVisitBookings(resolvedGroupBookingId);
    const seeded =
      initialGroupVisitBookings && initialGroupVisitBookings.length > 0
        ? initialGroupVisitBookings
        : cached && cached.length > 0
          ? cached
          : null;

    if (seeded && seeded.length > 0) {
      setGroupVisitBookings(seeded);
      setGroupVisitLoading(seeded.length <= 1);
    } else {
      setGroupVisitLoading(true);
    }

    let cancelled = false;
    void fetchGroupVisitBookings(resolvedGroupBookingId).then((rows) => {
      if (cancelled) return;
      setGroupVisitBookings(rows);
      setGroupVisitLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [resolvedGroupBookingId, initialGroupVisitBookings]);

  const effectiveBooking = useMemo(
    () => ({ ...booking, ...rowOverlay }),
    [booking, rowOverlay],
  );

  useEffect(() => {
    if (!resolvedGroupBookingId || !initialGroupVisitBookings?.length) return;
    if (initialGroupVisitBookings.some((row) => Boolean(row.person_label?.trim()))) return;
    setGroupVisitBookings((prev) => {
      const base = prev.length > 0 ? prev : initialGroupVisitBookings;
      const merged = mergeGroupVisitRowsWithSeeds(base, initialGroupVisitBookings);
      if (merged.length > 1) {
        primeGroupVisitBookings(resolvedGroupBookingId, merged);
      }
      return merged;
    });
  }, [resolvedGroupBookingId, initialGroupVisitBookings]);

  useEffect(() => {
    setGuestMessageFeedback(null);
  }, [guestMessageChannel]);

  useEffect(() => {
    if (!guestMessageFeedback) return;
    if (guestMessageFeedback.tone === 'error') return;
    if (draftMessage.trim().length === 0) return;
    setGuestMessageFeedback(null);
  }, [draftMessage, guestMessageFeedback]);

  useEffect(() => {
    if (!guestMessageFeedback || guestMessageFeedback.tone === 'error') return;
    const t = window.setTimeout(() => {
      setGuestMessageFeedback((cur) => (cur?.tone === 'error' ? cur : null));
    }, 8000);
    return () => clearTimeout(t);
  }, [guestMessageFeedback]);

  const handleSendGuestMessage = useCallback(async () => {
    setGuestMessageFeedback(null);
    try {
      const result = await Promise.resolve(onSendMessage(guestMessageChannel));
      if (result.ok) {
        setGuestMessageFeedback({
          tone: result.warning ? 'warning' : 'success',
          text: result.warning ?? guestMessageSuccessCaption(guestMessageChannel),
        });
      } else {
        setGuestMessageFeedback({ tone: 'error', text: result.error });
      }
    } catch (e) {
      console.error('[ExpandedBookingContent] guest message send', e);
      setGuestMessageFeedback({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Something went wrong while sending.',
      });
    }
  }, [guestMessageChannel, onSendMessage]);

  const isGroupPeopleVisit =
    Boolean(resolvedGroupBookingId) &&
    groupVisitBookings.some((b) => Boolean(b.person_label?.trim()));
  const multiServiceVisitSegments = useMemo(() => {
    if (!resolvedGroupBookingId || isGroupPeopleVisit || groupVisitBookings.length <= 1) {
      return [];
    }
    return groupVisitBookings;
  }, [resolvedGroupBookingId, groupVisitBookings, isGroupPeopleVisit]);

  const visitAttendanceConfirmed = isAttendanceConfirmed(effectiveBooking);

  const multiServiceVisitSegmentsForDisplay = useMemo(() => {
    if (multiServiceVisitSegments.length === 0) return [];
    const merged = mergeGroupVisitRowsWithSeeds(
      multiServiceVisitSegments,
      initialGroupVisitBookings ?? [],
    );
    const visitAnchorStatus = resolveVisitPillAnchorStatus(
      String(effectiveBooking.status),
      merged,
      visitAttendanceConfirmed,
    );
    return merged.map((seg) => ({
      ...seg,
      status: groupVisitSegmentPillStatus(seg, visitAnchorStatus, visitAttendanceConfirmed),
    }));
  }, [
    multiServiceVisitSegments,
    initialGroupVisitBookings,
    effectiveBooking.status,
    visitAttendanceConfirmed,
  ]);

  const groupVisitFetchPending =
    Boolean(resolvedGroupBookingId) &&
    !isGroupPeopleVisit &&
    groupVisitLoading &&
    multiServiceVisitSegments.length === 0;

  const visitInferredModel = booking.inferred_booking_model ?? inferBookingRowModel(booking);
  const visitTableStyle = visitInferredModel === 'table_reservation';

  const multiServiceVisitCard = useMemo(() => {
    if (groupVisitFetchPending) {
      return (
        <SectionCard className="border-brand-200 bg-brand-50/20" aria-busy="true" aria-label="Loading services in this visit">
          <SectionCard.Body className="p-4">
            <div className="h-4 w-40 animate-pulse rounded bg-brand-100" />
            <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100" />
            <ul className="mt-3 space-y-2">
              {[0, 1].map((i) => (
                <li key={i} className="rounded-lg border border-slate-200/90 bg-white/80 px-3 py-3">
                  <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
                  <div className="mt-2 h-4 w-3/4 max-w-xs animate-pulse rounded bg-slate-200" />
                </li>
              ))}
            </ul>
          </SectionCard.Body>
        </SectionCard>
      );
    }
    if (multiServiceVisitSegmentsForDisplay.length === 0) return null;
    const visitDatePhrase = multiServiceVisitDatePhrase(booking.booking_date);
    return (
      <SectionCard className="border-brand-200 bg-brand-50/20">
        <SectionCard.Body className="p-4">
          <p className="text-xs font-semibold text-brand-900">Services in this visit</p>
          <p className="mt-0.5 text-[11px] text-slate-600">
            {multiServiceVisitSegmentsForDisplay.length} consecutive{' '}
            {multiServiceVisitSegmentsForDisplay.length === 1 ? 'service' : 'services'}{' '}
            {visitDatePhrase}
            {(() => {
              const visitTotal = multiServiceVisitSegmentsForDisplay.reduce(
                (sum, seg) => sum + (seg.duration_minutes ?? 0),
                0,
              );
              return visitTotal > 0 ? ` · ${formatDurationMinutesLabel(visitTotal)} total` : '';
            })()}
            .
          </p>
          <ul className="mt-3 space-y-2">
            {multiServiceVisitSegmentsForDisplay.map((seg) => {
              const offeringLine = expandedBookingOfferingLine({
                serviceName: seg.booking_item_name,
                variantName: seg.service_variant_name,
                addonLabels: seg.booking_addon_labels,
              });
              const durationLabel = formatGroupVisitSegmentDurationLabel(seg);
              const endHm = seg.booking_end_time?.slice(0, 5) ?? null;
              const timeRange = endHm
                ? `${seg.booking_time.slice(0, 5)}–${endHm}`
                : seg.booking_time.slice(0, 5);
              return (
                <li
                  key={seg.id}
                  className="rounded-lg border border-slate-200/90 bg-white/80 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {offeringLine ?? 'Service'}
                      </p>
                      {durationLabel ? (
                        <p className="mt-1 text-[11px] font-medium text-slate-500">{durationLabel}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs font-medium tabular-nums text-slate-600">{timeRange}</span>
                      <div className="mt-1 flex justify-end">
                        <BookingStatusPill statusKey={seg.status}>
                          {bookingStatusDisplayLabel(seg.status, visitTableStyle)}
                        </BookingStatusPill>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </SectionCard.Body>
      </SectionCard>
    );
  }, [
    booking.booking_date,
    booking.id,
    groupVisitFetchPending,
    multiServiceVisitSegmentsForDisplay,
    visitTableStyle,
  ]);
  const displayLinkedBookings = isGroupPeopleVisit
    ? groupVisitBookings.filter((b) => b.id !== booking.id && b.person_label?.trim())
    : [];

  const activeDetail = useMemo(
    () =>
      detail ??
      bookingDetailLiteFromCachePayload(booking.id, detailCache?.peekVenueBookingDetail(booking.id)) ??
      bookingDetailLiteFromListRow(booking),
    [booking, detail, detailCache],
  );
  const detailHydrating = detailLoading && !detail && !detailCache?.peekVenueBookingDetail(booking.id);

  const guestHistoryInitialRows = useMemo(() => {
    const guestIdForHistory = activeDetail?.guest?.id ?? booking.guest_id ?? null;
    if (!guestIdForHistory || !detailCache) return undefined;
    const cachedGuest = detailCache.peekGuestDetail(guestIdForHistory);
    if (!cachedGuest?.booking_history?.length) return undefined;
    return mapContactGuestHistoryToAccordionRows(cachedGuest.booking_history);
  }, [activeDetail?.guest?.id, booking.guest_id, detailCache]);

  const inferredBookingModel = booking.inferred_booking_model ?? inferBookingRowModel(booking);
  const tableStyle = inferredBookingModel === 'table_reservation';
  const notesVariant: BookingNotesVariant = tableStyle ? 'table' : 'cde';

  const linkedViewOnly = linkedAct === 'none';
  const linkedLimitedEdit = linkedAct === 'edit_existing';
  const linkedBookingContext = linkedAct != null;

  // Card-hold display + action gating (§9.1/§9.2): a hold row replaces the
  // three legacy deposit actions. Charging is admin-only (toolbar venue context;
  // absent context = non-admin, the server enforces regardless).
  const isAdminViewer = useDashboardToolbarVenueOptional()?.isAdmin ?? false;
  const cardHoldState = useMemo(
    () =>
      resolveCardHoldUiState(
        {
          status: String(effectiveBooking.status),
          deposit_status: String(effectiveBooking.deposit_status),
        },
        activeDetail?.card_hold ?? null,
        { isAdmin: isAdminViewer },
      ),
    [activeDetail?.card_hold, effectiveBooking.deposit_status, effectiveBooking.status, isAdminViewer],
  );

  const canStaffModifyBooking =
    !linkedViewOnly &&
    ['Pending', 'Booked', 'Confirmed', 'Seated'].includes(String(effectiveBooking.status));

  const staffNewBookingPrimary = venueStaffBookingModel ?? inferredBookingModel;
  const staffNewBookingEnabledModels = useMemo(
    () => venueStaffEnabledBookingModels ?? [],
    [venueStaffEnabledBookingModels],
  );

  const staffNewBookingDefaultSurfaceTab = useMemo(
    () => defaultStaffBookingSurfaceTab(staffNewBookingPrimary, staffNewBookingEnabledModels),
    [staffNewBookingPrimary, staffNewBookingEnabledModels],
  );

  const staffNewBookingGuestContacts = useMemo<StaffRebookGuestPrefill>(
    () => ({
      firstName: activeDetail?.guest?.first_name ?? booking.guest_first_name ?? undefined,
      lastName: activeDetail?.guest?.last_name ?? booking.guest_last_name ?? undefined,
      email: activeDetail?.guest?.email ?? booking.guest_email,
      phone: activeDetail?.guest?.phone ?? booking.guest_phone,
      dietaryNotes: booking.dietary_notes,
      occasion: booking.occasion,
      specialRequests: activeDetail?.special_requests ?? null,
      internalNotes: activeDetail?.internal_notes ?? null,
      customerProfileNotes: activeDetail?.guest?.customer_profile_notes ?? null,
    }),
    [
      activeDetail?.guest?.customer_profile_notes,
      activeDetail?.guest?.email,
      activeDetail?.guest?.first_name,
      activeDetail?.guest?.last_name,
      activeDetail?.guest?.phone,
      activeDetail?.internal_notes,
      activeDetail?.special_requests,
      booking.dietary_notes,
      booking.guest_email,
      booking.guest_first_name,
      booking.guest_last_name,
      booking.guest_phone,
      booking.occasion,
    ],
  );

  const rebookGuestPrefill = staffNewBookingGuestContacts;

  const canExpandStaffRebook = useMemo(
    () =>
      (!linkedAct || linkedAct === 'create_edit_cancel') &&
      buildStaffRebookBootstrapFromBookingSource(booking, staffNewBookingGuestContacts) !== null,
    [booking, staffNewBookingGuestContacts, linkedAct],
  );


  const profileGuest = activeDetail?.guest ?? guestStubFromBookingRow(booking);
  const profileGuestId = profileGuest?.id ?? booking.guest_id ?? null;

  const guestName = profileGuest
    ? formatGuestDisplayName(profileGuest.first_name, profileGuest.last_name)
    : booking.guest_name;
  const guestPhone = profileGuest?.phone ?? booking.guest_phone;
  const guestEmail = profileGuest?.email ?? booking.guest_email;
  const guestTelHref = useMemo(() => phoneToTelHref(guestPhone), [guestPhone]);

  const openGuestMessageComposer = useCallback((channel: GuestMessageChannel) => {
    setModifyBookingOpen(false);
    setGuestMessageChannel(channel);
    setShowMessageBox(true);
    window.requestAnimationFrame(() => messageTextareaRef.current?.focus());
  }, []);
  const contactsGuestId = profileGuestId;
  const contactsHref =
    contactsGuestId && !linkedBookingContext
      ? `/dashboard/contacts?guest=${encodeURIComponent(contactsGuestId)}`
      : null;
  const visitCount =
    activeDetail?.guest?.visit_count ?? booking.guest_visit_count ?? profileGuest?.visit_count ?? 0;
  const previousVisitDate = activeDetail?.guest?.last_visit_date ?? profileGuest?.last_visit_date ?? null;
  const tableNames = (activeDetail?.table_assignments ?? booking.table_assignments ?? []).map((t) => t.name);
  const addonCurrencySymbol = currencySymbolFromCode(venueCurrency ?? 'GBP');
  const bookingAddons = activeDetail?.addons ?? [];
  const depositAmtStr = effectiveBooking.deposit_amount_pence
    ? `£${(effectiveBooking.deposit_amount_pence / 100).toFixed(2)}`
    : null;
  // Full-payment services collect the whole price at booking, so the panel
  // says "Paid in full" / "Refund payment" rather than deposit copy. Card
  // holds take precedence: their block owns the payment display.
  const isFullPayment = !cardHoldState && activeDetail?.service_payment_requirement === 'full_payment';
  const serviceLine = resolveExpandedBookingServiceLine(
    {
      service_name: booking.service_name,
      booking_item_name: booking.booking_item_name,
      service_variant_name:
        activeDetail?.service_variant_name ?? booking.service_variant_name ?? null,
    },
    activeDetail,
  );
  const showGlobalExtras = bookingAddons.length > 0 && multiServiceVisitSegments.length === 0;
  // CDE context card. The omit-set models (class/event/resource/appointment) normally
  // suppress the card because the offering title is denormalised into the header
  // serviceLine. But if the list API did NOT denormalise a name, serviceLine is empty
  // and suppressing the card would hide the event/class/resource name everywhere (F11).
  // So: when the title is already in the header (serviceLine present) we keep suppressing;
  // when serviceLine is missing we always render the card so the CDE name + subtitle show.
  const cdeContextForCard = (() => {
    const cde = activeDetail?.cde_context;
    if (!cde) return null;
    const headerHasTitle = Boolean(serviceLine);
    const titleMatchesHeader =
      headerHasTitle && cde.title.trim() === serviceLine;
    if (BOOKING_MODELS_OMITTING_CDE_CONTEXT_CARD.has(inferredBookingModel)) {
      // Only suppress when the header actually carries the offering name.
      return headerHasTitle ? null : cde;
    }
    return titleMatchesHeader ? null : cde;
  })();
  const guestProfileAndNotesCount = [
    ...(activeDetail?.guest?.tags ?? []),
    activeDetail?.guest?.customer_profile_notes,
    booking.dietary_notes,
    booking.occasion,
    activeDetail?.special_requests,
    activeDetail?.internal_notes,
  ].filter(Boolean).length;

  const timelineEvents = useMemo(
    () => bookingTimelineEventsForDisplay(activeDetail?.events ?? []),
    [activeDetail?.events],
  );

  const refreshGroupVisitSegments = useCallback(async () => {
    if (!resolvedGroupBookingId) return;
    invalidateGroupVisitBookings(resolvedGroupBookingId);
    const rows = await fetchGroupVisitBookings(resolvedGroupBookingId);
    setGroupVisitBookings((prev) => {
      const merged = mergePreferLaterGroupVisitRows(prev, rows);
      if (merged.length > 0) {
        primeGroupVisitBookings(resolvedGroupBookingId, merged);
      }
      return merged;
    });
  }, [resolvedGroupBookingId]);

  const patchBookingQuick = async (body: Record<string, unknown>, loadingKey: string) => {
    setInlineActionLoading(loadingKey);
    setInlineActionError(null);
    if (body.staff_attendance_confirmed === false) {
      setSuppressPatchCancelAfterUndoConfirm(true);
    }
    if (resolvedGroupBookingId && !isGroupPeopleVisit && body.staff_attendance_confirmed !== undefined) {
      const on = Boolean(body.staff_attendance_confirmed);
      setGroupVisitBookings((prev) => {
        if (prev.length <= 1) return prev;
        const next = applyVisitAttendanceConfirmToGroupVisitRows(prev, on);
        primeGroupVisitBookings(resolvedGroupBookingId, next);
        return next;
      });
    }
    setRowOverlay((prev) =>
      mergeBookingRowOverlay(prev, overlayFromPatchBody(body, { ...booking, ...prev })),
    );
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setInlineActionError(payload.error ?? 'Update failed');
        setRowOverlay({});
        setSuppressPatchCancelAfterUndoConfirm(false);
        void refreshGroupVisitSegments();
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (payload && typeof payload === 'object' && !('error' in payload)) {
        setRowOverlay((prev) =>
          mergeBookingRowOverlay(prev, overlayFromPatchPayloadForBody(body, payload)),
        );
      }
      setInlineActionError(null);
      await refreshGroupVisitSegments();
      onDetailUpdated();
    } catch {
      setInlineActionError('Update failed');
      setRowOverlay({});
      setSuppressPatchCancelAfterUndoConfirm(false);
      void refreshGroupVisitSegments();
    } finally {
      setInlineActionLoading(null);
    }
  };

  const runDepositAction = async (
    action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund' | 'release_hold',
  ) => {
    setInlineActionLoading(`deposit:${action}`);
    setInlineActionError(null);
    const depositOverlay: BookingRowOverlay =
      action === 'waive'
        ? { deposit_status: 'Waived' }
        : action === 'record_cash'
          ? { deposit_status: 'Paid' }
          : action === 'refund'
            ? { deposit_status: 'Refunded' }
            : {};
    if (Object.keys(depositOverlay).length > 0) {
      setRowOverlay((prev) => mergeBookingRowOverlay(prev, depositOverlay));
    }
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        // Card-hold guard responses use { code, message }; legacy deposit
        // responses use { error }. Read both so the specific copy surfaces.
        setInlineActionError(payload.message ?? payload.error ?? 'Deposit action failed');
        setRowOverlay((prev) => pruneBookingRowOverlay(prev, booking));
        return;
      }
      setInlineActionError(null);
      onDetailUpdated();
    } finally {
      setInlineActionLoading(null);
    }
  };
  const resendConfirmation = async () => {
    setInlineActionLoading('resend-confirmation');
    setInlineActionError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${booking.id}/resend-confirmation`, { method: 'POST' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        setInlineActionError(payload.error ?? 'Failed to resend confirmation');
        return;
      }
      setInlineActionError(null);
      onDetailUpdated();
    } finally {
      setInlineActionLoading(null);
    }
  };

  const canCancel =
    canTransitionBookingStatus(effectiveBooking.status, 'Cancelled') &&
    (!linkedAct || linkedAct === 'create_edit_cancel');
  const canNoShow = canTransitionBookingStatus(effectiveBooking.status, 'No-Show');
  const canUndoNoShow =
    effectiveBooking.status === 'No-Show' &&
    canTransitionBookingStatus(effectiveBooking.status, 'Booked');
  const revertFromBookingStatus = BOOKING_REVERT_ACTIONS[effectiveBooking.status as BookingStatus];
  /** Suppress rarely-used Booked → Pending (“Mark pending”) in this dense inline bar. */
  const revertAction =
    revertFromBookingStatus?.target === 'Pending' || canUndoNoShow
      ? undefined
      : revertFromBookingStatus;
  const forwardPrimaryLabel = (target: BookingStatus, defaultLabel: string) => {
    if (target === 'Seated' && !tableStyle) return 'Start';
    return defaultLabel;
  };

  const revertButtonLabel = () => {
    if (!revertAction) return '';
    if (
      revertAction.target === 'Booked' &&
      effectiveBooking.status === 'Seated' &&
      !tableStyle
    ) {
      return 'Undo Start';
    }
    return revertAction.label;
  };

  const forwardActions = (
    [
      BOOKING_PRIMARY_ACTIONS.Pending,
      BOOKING_PRIMARY_ACTIONS.Booked,
      BOOKING_PRIMARY_ACTIONS.Confirmed,
      BOOKING_PRIMARY_ACTIONS.Seated,
    ] as Array<{ label: string; target: BookingStatus } | undefined>
  ).reduce<Array<{ label: string; target: BookingStatus }>>((actions, action) => {
    if (!action || !canTransitionBookingStatus(effectiveBooking.status, action.target)) return actions;
    /** Do not treat lifecycle reverts as “forward” primaries (e.g. Confirmed→Booked reused Pending’s {Confirm,Booked} row). */
    if (isRevertTransition(effectiveBooking.status as BookingStatus, action.target)) return actions;
    if (actions.some((existing) => existing.target === action.target)) return actions;
    return [...actions, action];
  }, []);

  const staffIndicatorRow = { ...effectiveBooking, status: effectiveBooking.status };
  const showStaffAttendanceConfirm = canShowConfirmBookingAttendanceAction(staffIndicatorRow);
  /** Attendance undo via PATCH; skip when status revert already offers “Undo confirm” (Confirmed → Booked). */
  const showUndoAttendanceViaPatch =
    canShowCancelStaffAttendanceConfirmationAction(staffIndicatorRow) &&
    !(effectiveBooking.status === 'Confirmed' && revertAction?.target === 'Booked') &&
    !suppressPatchCancelAfterUndoConfirm;
  const arrived = Boolean(effectiveBooking.client_arrived_at);
  const showArrivedClear =
    effectiveBooking.status === 'Pending' ||
    effectiveBooking.status === 'Booked' ||
    effectiveBooking.status === 'Confirmed';

  const toolbarBusy =
    inlineActionLoading !== null || statusActionPending || sendingMessage || confirmAction !== null;

  const copyBookingRef = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(booking.id);
      setRefCopied(true);
      window.setTimeout(() => setRefCopied(false), 2000);
    } catch (e) {
      console.error('[ExpandedBookingContent] copy booking ref', e);
    }
  }, [booking.id]);

  const runStatusAction = useCallback(
    async (status: BookingStatus) => {
      setStatusActionPending(true);
      setInlineActionError(null);
      if (resolvedGroupBookingId && !isGroupPeopleVisit) {
        setGroupVisitBookings((prev) => {
          if (prev.length <= 1) return prev;
          const next = applyStatusToAllGroupVisitRows(prev, status);
          primeGroupVisitBookings(resolvedGroupBookingId, next);
          return next;
        });
      }
      try {
        await Promise.resolve(onStatusAction(status));
        await refreshGroupVisitSegments();
      } catch {
        setRowOverlay((prev) => pruneBookingRowOverlay(prev, booking));
        setStatusActionPending(false);
        setInlineActionError('Could not update booking status');
        void refreshGroupVisitSegments();
      }
    },
    [
      booking,
      isGroupPeopleVisit,
      onStatusAction,
      refreshGroupVisitSegments,
      resolvedGroupBookingId,
    ],
  );

  const handleStatusClick = (status: BookingStatus, label: string) => {
    if (toolbarBusy) return;
    const fromStatus = effectiveBooking.status as BookingStatus;
    /** Label fallback when `tableStyle` mis-infers reservation (still “Undo start / undo confirm”). */
    if (
      (status === 'Booked' && (label === 'Undo Start' || label === 'Undo confirm')) ||
      isBookingInstantRevertTransition(fromStatus, status, tableStyle)
    ) {
      if (fromStatus === 'Confirmed' && status === 'Booked') {
        setSuppressPatchCancelAfterUndoConfirm(true);
      }
      setRowOverlay((prev) =>
        mergeBookingRowOverlay(prev, overlayFromStatusTransition(fromStatus, status, tableStyle)),
      );
      void runStatusAction(status);
      return;
    }
    if (isDestructiveBookingStatus(status) || isRevertTransition(fromStatus, status)) {
      setConfirmAction({ status, label });
    } else {
      setRowOverlay((prev) =>
        mergeBookingRowOverlay(prev, overlayFromStatusTransition(fromStatus, status, tableStyle)),
      );
      void runStatusAction(status);
    }
  };

  // Each lifecycle button previews the status the bar becomes when pressed.
  const forwardActionButtonClass = (action: { label: string; target: BookingStatus }) =>
    `${EXP_BOOKING_BTN} ${EXP_BOOKING_ST_FOCUS} font-semibold ${bookingTransitionButtonSurface(action.target)}`;

  const revertToolbarButtonClass = revertAction
    ? `${EXP_BOOKING_BTN} font-semibold ${bookingTransitionButtonSurface(revertAction.target)}`
    : EXP_BOOKING_REVERT;

  const bookingMetaSegments: { key: string; node: React.ReactNode }[] = [
    {
      key: 'previous-visit',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Previous visit</span>
        <span className="break-words font-semibold text-slate-800 [overflow-wrap:anywhere]">
          {previousVisitDate ? formatDateNice(previousVisitDate) : 'None yet'}
        </span>
      </span>
      ),
    },
    {
      key: 'visits',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Visits</span>
        <span className="font-semibold text-slate-800">
          {visitCount > 0 ? `${visitCount} visit${visitCount === 1 ? '' : 's'}` : 'First visit'}
        </span>
      </span>
      ),
    },
  ];

  if (tableStyle) {
    bookingMetaSegments.push({
      key: 'table',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Table</span>
        <span
          className={`break-words font-semibold [overflow-wrap:anywhere] ${tableNames.length > 0 ? 'text-emerald-800' : 'text-amber-800'}`}
        >
          {tableNames.length > 0 ? tableNames.join(' + ') : tableManagementEnabled ? 'Unassigned' : 'N/A'}
          {activeDetail?.combination_staff_notes ? (
            <span className="font-medium text-emerald-800"> — {activeDetail.combination_staff_notes}</span>
          ) : null}
        </span>
      </span>
      ),
    });
  } else if (booking.party_size > 1) {
    bookingMetaSegments.push({
      key: 'party',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Party</span>
        <span className="font-semibold text-slate-800">{booking.party_size} people</span>
      </span>
      ),
    });
  }

  bookingMetaSegments.push({
    key: 'deposit',
    node: (
    <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
      <span className="font-medium text-slate-500">
        {cardHoldState
          ? 'Card hold'
          : isFullPayment && effectiveBooking.deposit_status === 'Paid'
            ? 'Paid in full'
            : isFullPayment
              ? 'Payment'
              : 'Deposit'}
      </span>
      <span
        className={`font-semibold ${effectiveBooking.deposit_status === 'Paid' ? 'text-emerald-700' : effectiveBooking.deposit_status === 'Pending' || effectiveBooking.deposit_status === 'Charged' ? 'text-amber-700' : effectiveBooking.deposit_status === 'Card Held' ? 'text-sky-700' : 'text-slate-800'}`}
      >
        {cardHoldState?.pill
          ? cardHoldState.pill.label
          : effectiveBooking.deposit_status === 'Not Required'
            ? 'None'
            : effectiveBooking.deposit_status === 'Paid' && depositAmtStr
              ? isFullPayment
                ? depositAmtStr
                : `${depositAmtStr} paid`
              : effectiveBooking.deposit_status === 'Card Held'
                ? 'Card held'
                : effectiveBooking.deposit_status === 'Charged'
                  ? 'Fee charged'
                  : effectiveBooking.deposit_status}
      </span>
    </span>
    ),
  });

  if (activeDetail?.checked_in_at) {
    bookingMetaSegments.push({
      key: 'checked-in',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Checked in</span>
        <span className="font-semibold text-slate-800">{formatRelative(activeDetail.checked_in_at)}</span>
      </span>
      ),
    });
  }

  if (effectiveBooking.location_type === 'online') {
    bookingMetaSegments.push({
      key: 'location',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Location</span>
        <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-800 ring-1 ring-sky-200/80">Online</span>
      </span>
      ),
    });
  } else if (effectiveBooking.location_type === 'client_address') {
    const clientAddress = [
      effectiveBooking.client_address_line1,
      effectiveBooking.client_address_line2,
      effectiveBooking.client_address_city,
      effectiveBooking.client_address_postcode,
    ]
      .map((p) => (p ?? '').trim())
      .filter(Boolean)
      .join(', ');
    bookingMetaSegments.push({
      key: 'location',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Location</span>
        <span className="break-words font-semibold text-emerald-800 [overflow-wrap:anywhere]">
          Client&apos;s address{clientAddress ? ` — ${clientAddress}` : ' (not recorded)'}
        </span>
      </span>
      ),
    });
  }

  bookingMetaSegments.push(
    {
      key: 'source',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Source</span>
        <span className="break-words font-semibold text-slate-800 [overflow-wrap:anywhere]">{booking.source}</span>
      </span>
      ),
    },
    {
      key: 'ref',
      node: (
      <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1">
        <span className="font-medium text-slate-500">Ref</span>
        <button
          type="button"
          onClick={() => {
            void copyBookingRef();
          }}
          className="font-semibold text-slate-800 hover:text-brand-700"
          title={refCopied ? 'Copied!' : 'Copy booking reference'}
          aria-label={refCopied ? 'Booking reference copied' : 'Copy booking reference'}
        >
          #{booking.id.slice(0, 8)}
          {refCopied ? ' ✓' : ''}
        </button>
      </span>
      ),
    },
  );

  return (
    <div
      id={`booking-expand-${booking.id}`}
      className="mt-1.5 flex flex-col gap-2.5 px-0.5 pb-2.5 sm:px-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {linkedViewOnly ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50/80 px-3 py-2 text-xs text-sky-900">
          Linked booking — view only. You can see full details here but cannot edit, reschedule or
          cancel this booking.
        </p>
      ) : linkedLimitedEdit ? (
        <p className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs text-amber-950">
          Linked booking — you can edit existing bookings but cannot create new ones or cancel.
        </p>
      ) : null}
      <SectionCard
        className={`rounded-2xl ring-1 ring-slate-900/[0.04] ${detailHydrating ? 'opacity-[0.98]' : ''}`}
        aria-busy={detailHydrating}
      >
        <SectionCard.Body className="p-2.5 sm:p-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-br from-brand-400 to-brand-700 text-[15px] font-bold text-white shadow-[0_2px_8px_-2px_rgba(0,59,111,0.45)] ring-1 ring-white/40">
                {guestName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <p className="max-w-[12rem] truncate text-[15px] font-semibold tracking-tight text-slate-900 sm:max-w-[18rem]">{guestName}</p>
                  {contactsHref ? (
                    <Link
                      href={contactsHref}
                      className="-m-1 inline-flex shrink-0 rounded-md p-1 text-slate-400 outline-none transition-colors hover:text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
                      aria-label={`Open ${guestName} in Contacts`}
                      title="Open in Contacts"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                    </Link>
                  ) : null}
                  {(activeDetail?.guest?.customer_profile_notes ?? profileGuest?.customer_profile_notes) ? (
                    <Pill variant="info" size="sm">Guest note</Pill>
                  ) : null}
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-slate-500">
                  {guestEmail ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!linkedViewOnly) openGuestMessageComposer('email');
                      }}
                      disabled={linkedViewOnly}
                      className="max-w-full break-words font-medium text-slate-700 [overflow-wrap:anywhere] hover:text-brand-700 disabled:cursor-default disabled:opacity-50"
                    >
                      {guestEmail}
                    </button>
                  ) : (
                    <span className="text-slate-400">No email</span>
                  )}
                  {guestPhone ? (
                    <>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <a
                        href={guestTelHref ?? `tel:${guestPhone}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium tabular-nums text-slate-700 hover:text-brand-700"
                      >
                        {guestPhone}
                      </a>
                    </>
                  ) : (
                    <>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <span className="text-slate-400">No phone</span>
                    </>
                  )}
                  {serviceLine ? (
                    <>
                      <span className="text-slate-300" aria-hidden>
                        ·
                      </span>
                      <span className="font-medium text-slate-700">{serviceLine}</span>
                    </>
                  ) : null}
                  {showDepositPendingPill(effectiveBooking) ? (
                    <Pill variant="warning" size="sm" dot>
                      Deposit pending
                    </Pill>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
              {guestTelHref ? (
                <a
                  href={guestTelHref}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] sm:min-h-8 sm:text-[11px]"
                >
                  <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.125A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
                  </svg>
                  Call
                </a>
              ) : null}
              {guestEmail ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!linkedViewOnly) openGuestMessageComposer('email');
                  }}
                  disabled={linkedViewOnly}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-slate-200/80 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] sm:min-h-8 sm:text-[11px] disabled:cursor-default disabled:opacity-50 disabled:active:scale-100"
                >
                  <svg className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
                  </svg>
                  Email
                </button>
              ) : null}
            </div>
          </div>
          <div
            className="mt-2.5 flex min-w-0 flex-wrap gap-1.5 border-t border-slate-100 pt-2.5 text-[11px] text-slate-700"
            role="list"
          >
            {bookingMetaSegments.map((segment) => (
              <span
                key={segment.key}
                role="listitem"
                className="inline-flex items-baseline gap-1.5 rounded-lg border border-slate-200/70 bg-slate-50/70 px-2.5 py-1 leading-none transition-colors hover:border-slate-300/70 hover:bg-slate-50"
              >
                {segment.node}
              </span>
            ))}
          </div>
          {showGlobalExtras ? (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Extras</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                {bookingAddons.map((a) => (
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
                      +{addonCurrencySymbol}
                      {(a.price_pence_at_booking / 100).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </SectionCard.Body>
      </SectionCard>

      {/* Actions bar — hidden for linked view-only grants (§5.3). */}
      {!linkedViewOnly ? (
      <div
        className={bookingExpandActionsBarClass}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="rounded-b-2xl bg-gradient-to-b from-white to-slate-50/40 px-2.5 py-2.5 sm:px-3 sm:py-3">
          {/* Mobile: even 2-up grid of large (44px) tap targets; desktop keeps the compact pill wrap. */}
          <div className="grid grid-cols-2 gap-2 [&>button]:min-h-11 [&>button]:w-full [&>button]:rounded-xl [&>button]:text-[13px] sm:flex sm:flex-wrap sm:items-center sm:gap-x-1 sm:gap-y-2 sm:[&>button]:min-h-8 sm:[&>button]:w-auto sm:[&>button]:rounded-[10px] sm:[&>button]:text-[11px]">
            {forwardActions.map((action) => (
              <button
                key={action.target}
                type="button"
                disabled={toolbarBusy}
                onClick={() => handleStatusClick(action.target, forwardPrimaryLabel(action.target, action.label))}
                className={forwardActionButtonClass(action)}
              >
                {(action.target === 'Confirmed' || action.target === 'Booked') && (
                  <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
                )}
                {action.target === 'Seated' && tableStyle && (
                  <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>
                )}
                {forwardPrimaryLabel(action.target, action.label)}
              </button>
            ))}

            {showStaffAttendanceConfirm ? (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => void patchBookingQuick({ staff_attendance_confirmed: true }, 'staff-attendance')}
                className={`${EXP_BOOKING_BTN} font-semibold ${BOOKING_ATTENDANCE_CONFIRM_SOLID_BUTTON}`}
              >
                {inlineActionLoading === 'staff-attendance' ? (
                  <span
                    className={`${EXP_BOOKING_ICO} animate-spin rounded-full border-2 ${BOOKING_ATTENDANCE_CONFIRM_SPINNER}`}
                    aria-hidden
                  />
                ) : null}
                Confirm
              </button>
            ) : null}

            {showUndoAttendanceViaPatch ? (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => void patchBookingQuick({ staff_attendance_confirmed: false }, 'staff-attendance-cancel')}
                className={`${EXP_BOOKING_BTN} font-semibold ${BOOKING_BOOKED_LIGHT_BUTTON}`}
              >
                {inlineActionLoading === 'staff-attendance-cancel' ? (
                  <span className={`${EXP_BOOKING_ICO} animate-spin rounded-full border-2 ${BOOKING_ATTENDANCE_UNDO_SPINNER}`} aria-hidden />
                ) : null}
                Cancel confirmation
              </button>
            ) : null}

            {showArrivedClear ? (
              !arrived ? (
                <button
                  type="button"
                  disabled={toolbarBusy}
                  onClick={() => void patchBookingQuick({ client_arrived: true }, 'client-arrived')}
                  className={EXP_BOOKING_AMBER_ATTN}
                >
                  {inlineActionLoading === 'client-arrived' ? (
                    <span className={EXP_BOOKING_SPIN_AM} aria-hidden />
                  ) : null}
                  Arrived
                </button>
              ) : (
                <button
                  type="button"
                  disabled={toolbarBusy}
                  onClick={() => void patchBookingQuick({ client_arrived: false }, 'client-arrived-clear')}
                  className={EXP_BOOKING_SOFT}
                >
                  {inlineActionLoading === 'client-arrived-clear' ? (
                    <span className={EXP_BOOKING_SPIN_NA} aria-hidden />
                  ) : null}
                  Clear
                </button>
              )
            ) : null}

            {onRequestChangeTable && (
              <button type="button" disabled={toolbarBusy} onClick={onRequestChangeTable} className={EXP_BOOKING_NEUTRAL}>
                Change table
              </button>
            )}

            {revertAction && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => handleStatusClick(revertAction.target, revertButtonLabel())}
                className={revertToolbarButtonClass}
              >
                <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" /></svg>
                {revertButtonLabel()}
              </button>
            )}

            {!linkedBookingContext ? (
            <button
              type="button"
              aria-label="New booking"
              disabled={toolbarBusy}
              onClick={() => {
                setStaffBookingModal({
                  mode: 'new',
                  bootstrap: {
                    v: 1,
                    surface: staffNewBookingDefaultSurfaceTab,
                    guest: staffNewBookingGuestContacts,
                  },
                });
                setShowMessageBox(false);
                setModifyBookingOpen(false);
              }}
              className={EXP_BOOKING_NEUTRAL_PROMINENT}
            >
              <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New
            </button>
            ) : null}

            {canExpandStaffRebook && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => {
                  const payload = buildStaffRebookBootstrapFromBookingSource(booking, rebookGuestPrefill, {
                    venueTimeZone: venueTimezone,
                  });
                  if (!payload) return;
                  setStaffBookingModal({ mode: 'rebook', bootstrap: payload });
                  setShowMessageBox(false);
                  setModifyBookingOpen(false);
                }}
                className={EXP_BOOKING_NEUTRAL_PROMINENT}
              >
                Rebook
              </button>
            )}

            {canStaffModifyBooking && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => {
                  setModifyBookingOpen(true);
                  setShowMessageBox(false);
                }}
                className={EXP_BOOKING_NEUTRAL_PROMINENT}
              >
                Modify
              </button>
            )}

            {canCancel && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => handleStatusClick('Cancelled', 'Cancel Booking')}
                className={EXP_BOOKING_DANGER}
              >
                Cancel
              </button>
            )}
            {canNoShow && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => handleStatusClick('No-Show', 'Mark No-Show')}
                className={EXP_BOOKING_DANGER_ROSE}
              >
                No-Show
              </button>
            )}
            {canUndoNoShow && (
              <button
                type="button"
                disabled={toolbarBusy}
                onClick={() => handleStatusClick('Booked', 'Undo No-Show')}
                className={`${EXP_BOOKING_BTN} font-semibold ${BOOKING_BOOKED_LIGHT_BUTTON}`}
              >
                <svg className={EXP_BOOKING_ICO} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
                </svg>
                Undo No-Show
              </button>
            )}
          </div>
        </div>
      </div>
      ) : null}

      {profileGuestId ? multiServiceVisitCard : null}

      {profileGuestId ? (
        <details className={bookingExpandAccordionDetailsClass}>
          <summary className={bookingExpandAccordionSummaryClass}>
            <span>Notes</span>
            <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
              {guestProfileAndNotesCount > 0
                ? `${guestProfileAndNotesCount} item${guestProfileAndNotesCount === 1 ? '' : 's'}`
                : 'Tags and booking notes'}
            </span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className={`${bookingExpandAccordionBodyClass} space-y-2`}>
            <GuestTagEditor
              tags={Array.isArray(activeDetail?.guest?.tags) ? activeDetail!.guest!.tags : []}
              venueId={venueId}
              disabled={!profileGuestId || detailHydrating || linkedViewOnly}
              onTagsChange={async (nextTags) => {
                if (!profileGuestId) return;
                const res = await fetch(`/api/venue/guests/${profileGuestId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tags: nextTags }),
                });
                if (!res.ok) {
                  const j = (await res.json().catch(() => ({}))) as { error?: string };
                  throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                }
                onDetailUpdated();
              }}
            />
            <CustomerProfileNotesCard
              embedded
              guestId={profileGuestId}
              value={activeDetail?.guest?.customer_profile_notes ?? profileGuest?.customer_profile_notes ?? null}
              disabled={!profileGuestId || detailHydrating || linkedViewOnly}
              onSaved={onDetailUpdated}
            />
            <div className="border-t border-slate-100 pt-2">
              {booking.occasion ? (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Occasion</p>
                  <div className="rounded-lg border border-violet-100 bg-violet-50 px-2.5 py-1.5 text-xs font-semibold leading-snug text-violet-900">
                    {booking.occasion}
                  </div>
                </div>
              ) : null}
              <BookingNotesEditablePanel
                bookingId={booking.id}
                dietaryNotes={booking.dietary_notes}
                guestRequests={activeDetail?.special_requests}
                staffNotes={activeDetail?.internal_notes}
                onSaved={onDetailUpdated}
                notesVariant={notesVariant}
                compact
                embedded
                disabled={linkedViewOnly}
              />
            </div>
          </div>
        </details>
      ) : null}

      {(activeDetail?.guest?.id ?? booking.guest_id) ? (
        <div className="px-0 sm:px-0.5">
          <GuestBookingsForGuestAccordion
            guestId={profileGuestId!}
            initialRows={guestHistoryInitialRows}
            fetchWhenOpen
            currentBookingId={booking.id}
            guestDisplayNameForSnapshots={guestName}
            venueTimeZone={venueTimezone}
            historyVenueId={linkedBookingContext ? venueId : undefined}
            canOpenNested={Boolean(onOpenRelatedGuestBooking) && relatedBookingsStackDepth + 1 < BOOKING_DETAIL_MAX_STACK_DEPTH}
            onOpenBookingDetail={(payload) => {
              onOpenRelatedGuestBooking?.(payload);
            }}
            listRefreshKey={guestHistoryListRefresh}
            rebookGuestPrefill={rebookGuestPrefill}
            onStaffBookingCreated={onDetailUpdated}
            allowRebook={!linkedAct || linkedAct === 'create_edit_cancel'}
          />
        </div>
      ) : null}

      <details
        className={bookingExpandAccordionDetailsClass}
        open={!linkedViewOnly ? showMessageBox : undefined}
        onToggle={(event) => {
          if (linkedViewOnly) return;
          const nextOpen = event.currentTarget.open;
          setShowMessageBox(nextOpen);
          if (nextOpen) setModifyBookingOpen(false);
        }}
      >
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>SMS / email guest</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
            {(activeDetail?.communications ?? []).length > 0
              ? `${activeDetail!.communications.length} sent`
              : linkedViewOnly
                ? detailLoading
                  ? 'Loading…'
                  : 'None sent'
                : guestPhone && guestEmail
                  ? 'SMS + email'
                  : guestPhone
                    ? 'SMS'
                    : guestEmail
                      ? 'Email'
                      : 'No contact'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className={bookingExpandAccordionMessagingBodyClass}>
          {!linkedViewOnly ? (
            <>
              <div className="mb-2">
                <p className="text-xs font-semibold text-slate-700">Message {guestName.split(' ')[0]}</p>
              </div>
              <textarea
                ref={messageTextareaRef}
                value={draftMessage}
                onChange={(e) => onMessageDraftChange(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
                placeholder="Write a message"
              />
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <label className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
                  Send via
                  <GuestMessageChannelSelect
                    value={guestMessageChannel}
                    onChange={setGuestMessageChannel}
                    disabled={sendingMessage}
                  />
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-center sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowMessageBox(false)}
                    className="rounded-lg border border-slate-200 bg-white px-[11px] py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 sm:py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={sendingMessage || draftMessage.trim().length === 0}
                    onClick={() => {
                      void handleSendGuestMessage();
                    }}
                    className="inline-flex min-w-[5.25rem] items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-slate-900 disabled:opacity-50 sm:py-1.5"
                    aria-busy={sendingMessage}
                  >
                    {sendingMessage ? (
                      <span
                        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/25 border-t-white"
                        aria-hidden
                      />
                    ) : null}
                    <span>Send</span>
                  </button>
                </div>
              </div>
              {guestMessageFeedback ? (
                <p
                  role="status"
                  aria-live="polite"
                  className={`mt-2 rounded-lg border px-2.5 py-2 text-xs font-medium ${
                    guestMessageFeedback.tone === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                      : guestMessageFeedback.tone === 'warning'
                        ? 'border-amber-200 bg-amber-50 text-amber-950'
                        : 'border-red-200 bg-red-50 text-red-800'
                  }`}
                >
                  {guestMessageFeedback.text}
                </p>
              ) : null}
            </>
          ) : null}
          <div
            className={
              linkedViewOnly
                ? undefined
                : 'mt-4 border-t border-slate-200/80 pt-3'
            }
          >
            <p className="mb-2 text-xs font-semibold text-slate-700">Sent for this booking</p>
            {(activeDetail?.communications ?? []).length > 0 ? (
              <ul className="space-y-2">
                {(activeDetail?.communications ?? []).map((comm) => (
                  <li
                    key={comm.id}
                    className="rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-900/[0.03]"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded px-1 py-0.5 text-[10px] font-semibold uppercase ${
                              comm.channel === 'email'
                                ? 'bg-blue-50 text-blue-800'
                                : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            {comm.channel}
                          </span>
                          <span className="font-medium text-slate-800">
                            {formatCommunicationLogLabel(comm.message_type)}
                          </span>
                          <span
                            className={`rounded px-1 py-0.5 text-[10px] font-semibold capitalize ${
                              comm.status === 'sent' || comm.status === 'delivered'
                                ? 'bg-emerald-50 text-emerald-700'
                                : comm.status === 'failed' || comm.status === 'bounced'
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-amber-50 text-amber-800'
                            }`}
                          >
                            {comm.status}
                          </span>
                        </div>
                        {comm.recipient ? (
                          <p className="mt-0.5 truncate text-[10px] text-slate-400">To {comm.recipient}</p>
                        ) : null}
                        {comm.error_message && comm.status === 'failed' ? (
                          <p className="mt-0.5 text-[10px] text-red-600">{comm.error_message}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-slate-400">{formatRelative(comm.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                {detailLoading
                  ? 'Loading communications…'
                  : 'No emails or SMS have been sent to the guest for this booking yet.'}
              </p>
            )}
          </div>
        </div>
      </details>

      {complianceEnabled &&
      (activeDetail?.guest?.id ?? booking.guest_id) &&
      (booking.appointment_service_id || booking.service_item_id) ? (
        <details className={bookingExpandAccordionDetailsClass}>
          <summary className={bookingExpandAccordionSummaryClass}>
            <span>Compliance</span>
            <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </summary>
          <div className={bookingExpandAccordionBodyClass}>
            <ComplianceSection
              guestId={(activeDetail?.guest?.id ?? booking.guest_id)!}
              bookingId={booking.id}
              appointmentServiceId={booking.appointment_service_id ?? null}
              serviceItemId={booking.service_item_id ?? null}
              complianceEnabled={complianceEnabled}
            />
          </div>
        </details>
      ) : null}

      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span><span className="sm:hidden">Payments</span><span className="hidden sm:inline">Payments and confirmation</span></span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{cardHoldState?.pill?.label ?? effectiveBooking.deposit_status}</span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-2`}>
          {!linkedViewOnly ? (
          <>
          {cardHoldState ? (
            /* §9.1 hiding rule: hold bookings never show the legacy deposit
               actions; the card-aware set renders instead. */
            <CardHoldDetailSection
              bookingId={booking.id}
              guestName={booking.guest_name}
              state={cardHoldState}
              actionDisabled={inlineActionLoading !== null || statusActionPending}
              onLegacyDepositAction={(action) => {
                void runDepositAction(action);
              }}
              onChanged={() => {
                onDetailUpdated();
              }}
            />
          ) : null}
          <div className="flex flex-wrap gap-1">
            {!cardHoldState && effectiveBooking.deposit_status !== 'Paid' && effectiveBooking.deposit_status !== 'Refunded' ? (
              <>
                <button type="button" disabled={inlineActionLoading !== null || statusActionPending} onClick={() => { void runDepositAction('send_payment_link'); }} className="rounded-lg border border-slate-200 bg-white px-[9px] py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Send payment link</button>
                <button type="button" disabled={inlineActionLoading !== null || statusActionPending} onClick={() => { void runDepositAction('waive'); }} className="rounded-lg border border-slate-200 bg-white px-[9px] py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Waive</button>
                <button type="button" disabled={inlineActionLoading !== null || statusActionPending} onClick={() => { void runDepositAction('record_cash'); }} className="rounded-lg border border-slate-200 bg-white px-[9px] py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Record cash</button>
              </>
            ) : null}
            {!cardHoldState && effectiveBooking.deposit_status === 'Paid' ? (
              <button type="button" disabled={inlineActionLoading !== null || statusActionPending} onClick={() => { void runDepositAction('refund'); }} className="rounded-lg border border-red-200 bg-white px-[9px] py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">{isFullPayment ? 'Refund payment' : 'Refund deposit'}</button>
            ) : null}
            <button type="button" disabled={inlineActionLoading !== null || statusActionPending} onClick={() => { void resendConfirmation(); }} className="rounded-lg border border-slate-200 bg-white px-[9px] py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Resend confirmation</button>
          </div>
          </>
          ) : (
            <div className="space-y-1">
              <p className="text-[11px] text-slate-500">
                {cardHoldState?.pill
                  ? `Card hold: ${cardHoldState.pill.label}`
                  : `Deposit status: ${effectiveBooking.deposit_status}`}
              </p>
              {cardHoldState?.lines.map((line) => (
                <p key={line} className="text-[11px] text-slate-500">{line}</p>
              ))}
            </div>
          )}
          {activeDetail?.cancellation_deadline ? (
            <p className="text-[11px] text-slate-500">Cancellation deadline: {formatRelative(activeDetail.cancellation_deadline)}</p>
          ) : null}
          {inlineActionError ? (
            <p className="rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">{inlineActionError}</p>
          ) : null}
        </div>
      </details>

      {!profileGuestId ? multiServiceVisitCard : null}

      {!profileGuestId ? (
      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Notes</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
            {[booking.dietary_notes, booking.occasion, activeDetail?.special_requests, activeDetail?.internal_notes].filter(Boolean).length || 'None'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className={bookingExpandAccordionBodyClass}>
          <BookingNotesEditablePanel
            bookingId={booking.id}
            dietaryNotes={booking.dietary_notes}
            guestRequests={activeDetail?.special_requests}
            staffNotes={activeDetail?.internal_notes}
            onSaved={onDetailUpdated}
            notesVariant={notesVariant}
            compact
            disabled={linkedViewOnly}
          />
          {booking.occasion ? (
            <p className="mt-2 rounded-lg border border-violet-100 bg-violet-50 px-2 py-1.5 text-xs font-semibold text-violet-800">
              Occasion: {booking.occasion}
            </p>
          ) : null}
        </div>
      </details>
      ) : null}

      {/* CDE context — omitted when title already appears in the summary row */}
      {cdeContextForCard ? (
        <SectionCard className="border-emerald-200 bg-emerald-50/30">
          <SectionCard.Body className="p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">{cdeContextForCard.title}</p>
                {cdeContextForCard.subtitle ? (
                  <p className="mt-0.5 text-xs text-slate-600">{cdeContextForCard.subtitle}</p>
                ) : null}
                {(() => {
                  const detailLine =
                    cdeContextForCard.ticket_summary ??
                    cdeContextForCard.roster_summary ??
                    (cdeContextForCard.duration_minutes != null
                      ? formatDurationMinutesLabel(cdeContextForCard.duration_minutes)
                      : null);
                  return detailLine ? (
                    <p className="mt-0.5 text-[11px] font-medium text-emerald-700">{detailLine}</p>
                  ) : null;
                })()}
              </div>
            </div>
          </SectionCard.Body>
        </SectionCard>
      ) : null}

      {/* Group booking (multiple people, same group id) */}
      {isGroupPeopleVisit ? (
        <SectionCard className="border-violet-200 bg-violet-50/30">
          <SectionCard.Body className="p-4">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 shrink-0 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" /></svg>
              <span className="text-xs font-semibold text-violet-800">Group booking</span>
              {booking.person_label ? (
                <span className="text-xs text-violet-600">· {booking.person_label}</span>
              ) : null}
            </div>
            {displayLinkedBookings.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">
                  Others in this group
                </p>
                {displayLinkedBookings.map((lb) => {
                  const peerOfferingLine = expandedBookingOfferingLine({
                    serviceName: lb.booking_item_name,
                    variantName: lb.service_variant_name,
                    addonLabels: lb.booking_addon_labels,
                  });
                  return (
                  <div key={lb.id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-violet-800">
                        {lb.person_label ?? 'Guest'}
                      </span>
                      {peerOfferingLine ? (
                        <p className="mt-0.5 text-[10px] leading-snug text-violet-700">{peerOfferingLine}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs tabular-nums text-violet-600">
                        {lb.booking_time.slice(0, 5)}
                      </span>
                      <Pill
                        variant={
                          lb.status === 'Confirmed'
                            ? 'success'
                            : lb.status === 'Booked'
                              ? 'info'
                              : lb.status === 'Pending'
                                ? 'warning'
                                : lb.status === 'Cancelled'
                                  ? 'danger'
                                  : 'neutral'
                        }
                        size="sm"
                      >
                        {lb.status}
                      </Pill>
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : null}
          </SectionCard.Body>
        </SectionCard>
      ) : null}

      {/* Timeline — created, confirmed (guest/staff), modifications, cancellations */}
      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Timeline</span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">
            {timelineEvents.length > 0
              ? `${timelineEvents.length} event${timelineEvents.length === 1 ? '' : 's'}`
              : detailLoading
                ? 'Loading…'
                : 'No events'}
          </span>
          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
          </svg>
        </summary>
        <div className={bookingExpandAccordionBodyClass}>
          {timelineEvents.length > 0 ? (
            <ul className="space-y-2">
              {timelineEvents.map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-slate-200/90 bg-white px-2.5 py-2 text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-900/[0.03]"
                >
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <span className="min-w-0 font-medium text-slate-800">{event.title}</span>
                    <span className="shrink-0 text-slate-400">{formatRelative(event.created_at)}</span>
                  </div>
                  {event.detail ? (
                    <p className="mt-0.5 break-words text-[10px] leading-snug text-slate-500 [overflow-wrap:anywhere]">
                      {event.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              {detailLoading ? 'Loading timeline…' : 'No booking activity recorded yet.'}
            </p>
          )}
        </div>
      </details>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction?.label ?? ''}
        message={
          confirmAction
            ? `Confirm ${confirmAction.label.toLowerCase()} for ${guestName} (${booking.party_size} ${
                tableStyle
                  ? `cover${booking.party_size !== 1 ? 's' : ''}`
                  : `person${booking.party_size !== 1 ? 's' : ''}`
              }) at ${booking.booking_time.slice(0, 5)}?`
            : ''
        }
        confirmLabel={confirmAction?.label ?? 'Confirm'}
        cancelLabel="Keep as is"
        onConfirm={() => {
          if (!confirmAction) return;
          const fromStatus = effectiveBooking.status as BookingStatus;
          const nextStatus = confirmAction.status;
          setConfirmAction(null);
          setRowOverlay((prev) =>
            mergeBookingRowOverlay(
              prev,
              overlayFromStatusTransition(fromStatus, nextStatus, tableStyle),
            ),
          );
          void runStatusAction(nextStatus);
        }}
        destructive={confirmAction ? isDestructiveBookingStatus(confirmAction.status) : false}
      />

      {modifyBookingOpen && (
        <StaffExpandedBookingModifyModal
          open
          onClose={() => setModifyBookingOpen(false)}
          onSaved={() => {
            setModifyBookingOpen(false);
            onDetailUpdated();
          }}
          venueId={venueId}
          venueCurrency={venueCurrency}
          tableManagementEnabled={tableManagementEnabled}
          linkedAct={linkedAct}
          booking={booking}
          detail={
            activeDetail
              ? {
                  special_requests: activeDetail.special_requests,
                  internal_notes: activeDetail.internal_notes,
                  guest: activeDetail.guest
                    ? {
                        first_name: activeDetail.guest.first_name,
                        last_name: activeDetail.guest.last_name,
                        email: activeDetail.guest.email,
                        phone: activeDetail.guest.phone,
                      }
                    : null,
                }
              : undefined
          }
        />
      )}

      {staffBookingModal ? (
        <StaffSurfaceBookingModal
          open
          heading={staffBookingModal.mode === 'rebook' ? 'Rebook' : undefined}
          onClose={() => setStaffBookingModal(null)}
          onCreated={() => {
            setStaffBookingModal(null);
            onDetailUpdated();
          }}
          venueId={venueId}
          currency={venueCurrency ?? 'GBP'}
          bookingModel={venueStaffBookingModel ?? inferBookingRowModel(booking)}
          enabledModels={venueStaffEnabledBookingModels ?? NO_EXTRA_ENABLED_BOOKING_MODELS}
          intent="new"
          advancedMode={tableManagementEnabled}
          staffRebookBootstrap={staffBookingModal.bootstrap}
        />
      ) : null}
    </div>
  );
}
