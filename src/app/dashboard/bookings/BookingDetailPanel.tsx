'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_REVERT_ACTIONS,
  canMarkNoShowForSlot,
  isDestructiveBookingStatus,
  isRevertTransition,
  isBookingInstantRevertTransition,
  type BookingStatus,
} from '@/lib/table-management/booking-status';
import { BOOKING_START_PRIMARY_BUTTON_CLASSES } from '@/lib/table-management/booking-status-visual';
import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { ExpandedBookingContent } from './ExpandedBookingContent';
import type { BookingNotesVariant } from '@/components/booking/BookingNotesEditablePanel';
import type { BookingModel } from '@/types/booking-models';
import { bookingStatusDisplayLabel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel, GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { computePopoverPanelStyle } from '@/lib/ui/clamped-floating-styles';
import { isBookingDetailPopoverDismissExempt } from '@/lib/ui/booking-detail-popover-dismiss';
import { useViewportBounds } from '@/lib/ui/use-viewport-bounds';
import { parseProcessingTimeBlocksFromDb } from '@/lib/appointments/processing-time';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { formatGuestDisplayName, splitLegacyGuestName } from '@/lib/guests/name';
import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import {
  bookingDisplayEndHm,
  estimatedEndIsoFromSchedule,
} from '@/lib/booking/booking-detail-from-row';
import {
  useOptionalDashboardDetailCache,
  type VenueBookingDetailPayload,
} from '@/components/providers/DashboardDetailCacheProvider';

import { BookingDetailSurface } from '@/components/booking/BookingDetailSurface';
import { bookingDetailPanelClassName } from '@/components/booking/booking-detail-types';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import {
  type BookingDetail,
  type AssignmentSuggestion,
  buildPlaceholderDetail,
  displayBookingGuestName,
  endHHMMOrFallback,
  formatDateNice,
  guestFirstLastForBookingRow,
  isTableStyleBookingDetail,
  timeToMinutes,
} from '@/app/dashboard/bookings/booking-detail-panel-model';
import { BookingDetailContent } from '@/components/booking/BookingDetailContent';
import { BookingDetailExpandedContent } from '@/components/booking/BookingDetailExpandedContent';
import {
  buildBookingForExpanded,
  buildDetailForExpanded,
} from '@/components/booking/booking-detail-expanded-payload';
import type { BookingDetailDrawerContext } from '@/components/booking/booking-detail-drawer-context';
import type { BookingDetailExpandedContext } from '@/components/booking/booking-detail-expanded-context';
import {
  ActionButton,
  CompactInfo,
  DepositRefundBanner,
} from '@/app/dashboard/bookings/booking-detail-panel-ui';

export type { BookingDetailPanelSnapshot } from '@/app/dashboard/bookings/booking-detail-panel-snapshot';
import {
  BOOKING_DETAIL_MAX_STACK_DEPTH,
  GuestBookingsForGuestAccordion,
} from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';

export function BookingDetailPanel({
  bookingId,
  onClose,
  onUpdated,
  onStatusChange,
  venueId,
  venueCurrency,
  initialSnapshot,
  isAppointment = false,
  presentation = 'drawer',
  anchor,
  stackDepth = 0,
  venueTimezone = 'Europe/London',
}: {
  bookingId: string;
  onClose: () => void;
  onUpdated: () => void;
  onStatusChange?: (bookingId: string, currentStatus: BookingStatus, nextStatus: BookingStatus) => Promise<void> | void;
  /** Required for optimistic placeholder from grid/floor views. */
  venueId?: string;
  venueCurrency?: string;
  initialSnapshot?: BookingDetailPanelSnapshot | null;
  isAppointment?: boolean;
  presentation?: 'drawer' | 'popover' | 'modal';
  anchor?: { x: number; y: number } | null;
  /** Nested detail panels use a higher z-index and swallow Escape / outside-click first. */
  stackDepth?: number;
  /** Used to split upcoming vs previous guest bookings (defaults to UK). */
  venueTimezone?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const detailCache = useOptionalDashboardDetailCache();
  const [detail, setDetail] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [modifyBookingOpen, setModifyBookingOpen] = useState(false);
  const [assignedTables, setAssignedTables] = useState<Array<{ id: string; name: string }>>([]);
  const [allTables, setAllTables] = useState<Array<{ id: string; name: string; max_covers: number }>>([]);
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [recommendedTableIds, setRecommendedTableIds] = useState<string[]>([]);
  const [customMessage, setCustomMessage] = useState('');
  const [guestMessageChannel, setGuestMessageChannel] = useState<GuestMessageChannel>('both');
  const [assignmentSuggestions, setAssignmentSuggestions] = useState<AssignmentSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [processingBlocksDraft, setProcessingBlocksDraft] = useState<ProcessingTimeBlock[]>([]);
  const [nestedBookingOpen, setNestedBookingOpen] = useState<{
    id: string;
    snapshot: BookingDetailPanelSnapshot;
    isAppointment: boolean;
  } | null>(null);
  const [guestHistoryListRefresh, setGuestHistoryListRefresh] = useState(0);

  const { zDismiss, zPanel, zConfirm } = useMemo(
    () => ({
      zDismiss: 40 + stackDepth * 25,
      zPanel: 50 + stackDepth * 25,
      zConfirm: 65 + stackDepth * 25,
    }),
    [stackDepth],
  );

  const optimisticDetail = useMemo(() => {
    if (!initialSnapshot || !venueId) return null;
    return buildPlaceholderDetail(bookingId, venueId, initialSnapshot);
  }, [bookingId, venueId, initialSnapshot]);

  const viewport = useViewportBounds();
  const hydratedDetail = detail?.id === bookingId ? detail : null;
  const displayDetail = hydratedDetail ?? optimisticDetail;
  const isHydrated = hydratedDetail !== null;
  const isPopover = presentation === 'popover';
  const isModal = presentation === 'modal';
  const useExpandedContentLayout = isPopover || isModal;
  const popoverStyle = useMemo((): CSSProperties | undefined => {
    if (!isPopover) return undefined;

    const anchorX = anchor?.x ?? viewport.width / 2;
    const anchorY = anchor?.y ?? 120;
    return computePopoverPanelStyle({
      anchorX,
      anchorY,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      maxPanelWidth: 640,
    });
  }, [anchor?.x, anchor?.y, isPopover, viewport.width, viewport.height]);

  const panelShellStyle = useMemo((): CSSProperties => {
    if (isPopover && popoverStyle) {
      return { ...popoverStyle, zIndex: zPanel };
    }
    return { zIndex: zPanel };
  }, [isPopover, popoverStyle, zPanel]);

  const notesVariant: BookingNotesVariant = useMemo(() => {
    const m = displayDetail?.inferred_booking_model;
    if (m === 'table_reservation') return 'table';
    if (m != null) return 'cde';
    return isAppointment ? 'cde' : 'table';
  }, [displayDetail?.inferred_booking_model, isAppointment]);

  const appointmentCoreMinutesForProcessing = useMemo(() => {
    const det = displayDetail;
    if (!det) return 15;
    const st = det.booking_time?.slice(0, 5) ?? '00:00';
    const et = endHHMMOrFallback(det.estimated_end_time, st, 90);
    const durationMins = Math.max(15, timeToMinutes(et) - timeToMinutes(st));
    const bt = det.booking_end_time;
    if (typeof bt === 'string' && bt.trim().length >= 5) {
      return Math.max(15, timeToMinutes(bt.slice(0, 5)) - timeToMinutes(st));
    }
    return Math.max(15, durationMins);
  }, [displayDetail]);

  const guestHistoryRebookPrefill = useMemo((): StaffRebookGuestPrefill | undefined => {
    const row = displayDetail;
    if (!isHydrated || !row?.guest?.id) return undefined;
    return {
      firstName: row.guest.first_name ?? undefined,
      lastName: row.guest.last_name ?? undefined,
      email: row.guest.email,
      phone: row.guest.phone,
      dietaryNotes: row.dietary_notes,
      occasion: row.occasion,
      specialRequests: row.special_requests,
      internalNotes: row.internal_notes,
      customerProfileNotes: row.guest.customer_profile_notes,
    };
  }, [isHydrated, displayDetail]);

  const resolveSeededDetail = useCallback((): BookingDetail | null => {
    const raw = detailCache?.peekVenueBookingDetail(bookingId);
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as { id?: unknown }).id === 'string' &&
      (raw as { id: string }).id === bookingId
    ) {
      return raw as unknown as BookingDetail;
    }
    if (initialSnapshot && venueId) {
      return buildPlaceholderDetail(bookingId, venueId, initialSnapshot);
    }
    return null;
  }, [bookingId, detailCache, initialSnapshot, venueId]);

  const loadBookingCore = useCallback(async () => {
    const cached = detailCache?.peekVenueBookingDetail(bookingId);
    if (
      cached &&
      typeof cached === 'object' &&
      typeof (cached as { id?: unknown }).id === 'string' &&
      (cached as { id: string }).id === bookingId
    ) {
      const data = cached as unknown as BookingDetail;
      setDetail(data);
      setAssignedTables(data.table_assignments ?? []);
      return data;
    }

    const summaryRes = await fetch(`/api/venue/bookings/${bookingId}/summary`, {
      credentials: 'same-origin',
    });
    if (summaryRes.ok) {
      const summary = (await summaryRes.json()) as BookingDetail;
      if (summary.id === bookingId) {
        setDetail(summary);
        setAssignedTables(summary.table_assignments ?? []);
        detailCache?.primeVenueBookingDetail(bookingId, summary as unknown as VenueBookingDetailPayload);
      }
    }

    const bookingRes = await fetch(`/api/venue/bookings/${bookingId}`, { credentials: 'same-origin' });

    if (!bookingRes.ok) {
      if (!summaryRes.ok) {
        setError(bookingRes.status === 404 ? 'Booking not found' : 'Failed to load booking');
      }
      return null;
    }

    const data = (await bookingRes.json()) as BookingDetail;
    setDetail(data);
    detailCache?.primeVenueBookingDetail(bookingId, data as unknown as VenueBookingDetailPayload);
    setGuestHistoryListRefresh((k) => k + 1);

    setAssignedTables(data.table_assignments ?? []);

    return data;
  }, [bookingId, detailCache]);

  const loadTableContext = useCallback(async (data: BookingDetail) => {
    try {
      const tablesRes = await fetch('/api/venue/tables');
      if (tablesRes.ok) {
        const tablesData = await tablesRes.json();
        setTableManagementEnabled(tablesData.settings?.table_management_enabled ?? false);
        setAllTables(
          (tablesData.tables ?? [])
            .filter((t: { is_active: boolean }) => t.is_active)
            .map((t: { id: string; name: string; max_covers: number }) => ({
              id: t.id,
              name: t.name,
              max_covers: t.max_covers,
            })),
        );

        if (data.table_assignments) {
          setAssignedTables(data.table_assignments);
        } else {
          setAssignedTables([]);
        }
      }
    } catch {
      // Table data is supplementary
    }

    try {
      const availabilityRes = await fetch(`/api/venue/tables/availability?date=${data.booking_date}`);
      if (availabilityRes.ok) {
        const availability = await availabilityRes.json();
        const time = (data.booking_time ?? '').slice(0, 5);
        const availableAtTime = new Set<string>(
          (availability.cells ?? [])
            .filter((cell: { time: string; is_available: boolean }) => cell.time === time && cell.is_available)
            .map((cell: { table_id: string }) => cell.table_id),
        );
        const fitting = (availability.tables ?? [])
          .filter(
            (table: { id: string; max_covers: number }) =>
              availableAtTime.has(table.id) && table.max_covers >= data.party_size,
          )
          .map((table: { id: string }) => table.id);
        setRecommendedTableIds(fitting);
      }
    } catch {
      setRecommendedTableIds([]);
    }
  }, []);

  const load = useCallback(async () => {
    const data = await loadBookingCore();
    if (data && isTableStyleBookingDetail(data, isAppointment)) {
      await loadTableContext(data);
    }
  }, [loadBookingCore, loadTableContext, isAppointment]);

  const loadAssignmentSuggestions = useCallback(async () => {
    if (!detail) return;
    setSuggestionsLoading(true);
    try {
      const params = new URLSearchParams({
        date: detail.booking_date,
        time: detail.booking_time.slice(0, 5),
        party_size: String(detail.party_size),
        booking_id: detail.id,
      });
      if (detail.area_id) {
        params.set('area_id', detail.area_id);
      }
      const res = await fetch(`/api/venue/tables/combinations/suggest?${params.toString()}`);
      if (!res.ok) {
        setAssignmentSuggestions([]);
        return;
      }
      const payload = await res.json();
      setAssignmentSuggestions(payload.suggestions ?? []);
    } catch {
      setAssignmentSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }, [detail]);

  useEffect(() => {
    if (!showAssignModal) return;
    void loadAssignmentSuggestions();
  }, [showAssignModal, loadAssignmentSuggestions]);

  useLayoutEffect(() => {
    setCustomMessage('');
    setModifyBookingOpen(false);
    setShowAssignModal(false);
    setNestedBookingOpen(null);
    setAllTables([]);
    setRecommendedTableIds([]);
    setAssignmentSuggestions([]);
    setTableManagementEnabled(false);
    setError(null);

    const seeded = resolveSeededDetail();
    setDetail(seeded);
    setAssignedTables(seeded?.table_assignments ?? []);
    setLoading(!seeded);

    void load().finally(() => setLoading(false));
  }, [bookingId, load, resolveSeededDetail]);

  useEffect(() => {
    if (!detail) return;
    setProcessingBlocksDraft(parseProcessingTimeBlocksFromDb(detail.processing_time_blocks));
  }, [detail?.id, detail?.processing_time_blocks, detail]);

  /** Keep popover/detail schedule in sync when calendar drag-resize updates the list row. */
  useEffect(() => {
    if (!initialSnapshot) return;
    const startHm = initialSnapshot.startTime.slice(0, 5);
    const endHm = initialSnapshot.endTime.slice(0, 5);
    const timeForStore = startHm.length === 5 ? `${startHm}:00` : startHm;
    const endForStore = `${endHm}:00`;
    const estimatedEndIso = estimatedEndIsoFromSchedule(
      initialSnapshot.bookingDate,
      startHm,
      endHm,
    );

    setDetail((prev) => {
      if (!prev || prev.id !== bookingId) return prev;
      const prevEnd =
        bookingDisplayEndHm({
          booking_time: prev.booking_time,
          booking_end_time: prev.booking_end_time ?? null,
          estimated_end_time: prev.estimated_end_time,
        }) ?? '';
      if (
        prev.booking_date === initialSnapshot.bookingDate &&
        (prev.booking_time?.slice(0, 5) ?? '') === startHm &&
        prevEnd === endHm
      ) {
        return prev;
      }
      return {
        ...prev,
        booking_date: initialSnapshot.bookingDate,
        booking_time: timeForStore,
        booking_end_time: endForStore,
        estimated_end_time: estimatedEndIso,
      };
    });

    const cached = detailCache?.peekVenueBookingDetail(bookingId);
    if (cached && typeof cached === 'object' && detailCache) {
      detailCache.primeVenueBookingDetail(bookingId, {
        ...(cached as VenueBookingDetailPayload),
        booking_date: initialSnapshot.bookingDate,
        booking_time: timeForStore,
        booking_end_time: endForStore,
        estimated_end_time: estimatedEndIso,
      });
    }
  }, [bookingId, detailCache, initialSnapshot]);

  useEffect(() => {
    if (stackDepth === 0 && nestedBookingOpen) {
      return undefined;
    }
    if (stackDepth > 0) {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => window.removeEventListener('keydown', onKeyDown, true);
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, stackDepth, nestedBookingOpen]);

  useEffect(() => {
    if (!isPopover) return;
    if (nestedBookingOpen) return;

    /** Capture phase so the underneath grid/floor booking never receives this pointer gesture (would open another booking or drag). */
    const onPointerDownCapture = (event: PointerEvent) => {
      if (confirmDialog) return;
      if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const onClickCapture = (event: MouseEvent) => {
      if (confirmDialog) return;
      if (isBookingDetailPopoverDismissExempt(event.target, panelRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose();
    };

    document.addEventListener('pointerdown', onPointerDownCapture, true);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [confirmDialog, isPopover, onClose, nestedBookingOpen]);

  const executeStatusChange = useCallback(async (newStatus: BookingStatus) => {
    const snapshot = detail ?? optimisticDetail;
    if (!snapshot) return;
    const previous = snapshot.status as BookingStatus;
    setActionLoading(true);
    if (detail) {
      setDetail((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, status: newStatus };
        if (previous === 'Confirmed' && newStatus === 'Booked') {
          updated.staff_attendance_confirmed_at = null;
          updated.guest_attendance_confirmed_at = null;
        } else if (newStatus === 'Confirmed' && previous !== 'Confirmed') {
          updated.staff_attendance_confirmed_at = new Date().toISOString();
        }
        return updated;
      });
    }
    try {
      if (onStatusChange) {
        await onStatusChange(bookingId, previous, newStatus);
      } else {
        const res = await fetch(`/api/venue/bookings/${bookingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? 'Failed');
          if (detail) {
            setDetail((prev) => (prev ? { ...prev, status: previous } : prev));
          }
          return;
        }
      }
      setError(null);
      await load();
      onUpdated();
    } catch (err) {
      console.error('Booking detail status update failed:', err);
      setError('Failed to update booking status');
      if (detail) {
        setDetail((prev) => (prev ? { ...prev, status: previous } : prev));
      }
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, detail, load, optimisticDetail, onStatusChange, onUpdated]);

  const executePermanentDelete = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError((j as { error?: string }).error ?? 'Could not delete booking');
        return;
      }
      onUpdated();
      onClose();
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, onUpdated, onClose]);

  const persistProcessingBlocks = useCallback(async () => {
    if (!detail) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processing_time_blocks: processingBlocksDraft }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? 'Could not save processing time');
        return;
      }
      await load();
      onUpdated();
    } catch (e) {
      console.error('processing_time_blocks patch failed:', e);
      setError('Could not save processing time');
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, detail, load, onUpdated, processingBlocksDraft]);

  const updateStatus = useCallback(async (newStatus: BookingStatus) => {
    if (!detail) return;
    if (newStatus === 'No-Show' && !canMarkNoShowForSlot(detail.booking_date, detail.booking_time?.slice(0, 5) ?? '12:00', 0)) {
      setError('No-show can only be marked after the booking start time');
      return;
    }
    const currentStatus = detail.status as BookingStatus;
    const revert = isRevertTransition(currentStatus, newStatus);
    if (revert) {
      const tableStyle = isTableStyleBookingDetail(detail, isAppointment);
      if (isBookingInstantRevertTransition(currentStatus, newStatus, tableStyle)) {
        void executeStatusChange(newStatus);
        return;
      }
      const revertAction = BOOKING_REVERT_ACTIONS[currentStatus];
      const confirmLabel =
        currentStatus === 'Seated' && newStatus === 'Booked' && !tableStyle
          ? 'Undo Start'
          : revertAction?.label ?? `Revert to ${newStatus}`;
      setConfirmDialog({
        title: confirmLabel,
        message: `${displayBookingGuestName(detail.guest)} (${detail.party_size}) at ${detail.booking_time?.slice(0, 5) ?? ''} on ${detail.booking_date} will be changed from ${detail.status} back to ${newStatus}.`,
        confirmLabel,
        onConfirm: () => { void executeStatusChange(newStatus); },
      });
      return;
    }
    if (isDestructiveBookingStatus(newStatus)) {
      setConfirmDialog({
        title: `Mark ${newStatus}`,
        message: `${displayBookingGuestName(detail.guest)} (${detail.party_size}) at ${detail.booking_time?.slice(0, 5) ?? ''} on ${detail.booking_date} will be marked ${newStatus}.`,
        confirmLabel: `Mark ${newStatus}`,
        onConfirm: () => { void executeStatusChange(newStatus); },
      });
      return;
    }
    void executeStatusChange(newStatus);
  }, [detail, executeStatusChange, isAppointment]);

  const runDepositAction = useCallback(async (action: 'send_payment_link' | 'waive' | 'record_cash' | 'refund') => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setError(payload.error ?? 'Deposit action failed');
        return;
      }
      setError(null);
      await load();
      onUpdated();
    } finally {
      setActionLoading(false);
    }
  }, [bookingId, load, onUpdated]);

  const popoverDismissLayer = isPopover ? (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Close booking details"
      className="fixed inset-0 cursor-default bg-transparent p-0"
      style={{ zIndex: zDismiss }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    />
  ) : null;

  const nestedDetailPanelEl =
    nestedBookingOpen && stackDepth + 1 < BOOKING_DETAIL_MAX_STACK_DEPTH ? (
      <BookingDetailPanel
        key={nestedBookingOpen.id}
        bookingId={nestedBookingOpen.id}
        initialSnapshot={nestedBookingOpen.snapshot}
        venueId={detail?.venue_id ?? venueId}
        venueCurrency={venueCurrency}
        isAppointment={nestedBookingOpen.isAppointment}
        presentation={presentation}
        anchor={null}
        stackDepth={stackDepth + 1}
        venueTimezone={venueTimezone}
        onClose={() => setNestedBookingOpen(null)}
        onUpdated={() => {
          void load();
          onUpdated();
        }}
        onStatusChange={onStatusChange}
      />
    ) : null;

  if (!displayDetail) {
    const loadingPresentation = isPopover ? 'popover' : isModal ? 'modal' : 'drawer';
    return (
      <>
        <BookingDetailSurface
          presentation={loadingPresentation}
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName(loadingPresentation, 'loading')}
        >
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="h-4 w-28 animate-pulse rounded bg-slate-200" />
              <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-100" />
            </div>
            <div className="animate-pulse space-y-3 p-4">
              <div className="h-20 rounded-xl bg-slate-100" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-14 rounded-lg bg-slate-100" />
                <div className="h-14 rounded-lg bg-slate-100" />
                <div className="h-14 rounded-lg bg-slate-100" />
                <div className="h-14 rounded-lg bg-slate-100" />
              </div>
            </div>
            {error && (
              <div className="mx-4 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
                <button type="button" onClick={onClose} className="mt-2 block text-[11px] font-medium text-brand-600 hover:text-brand-700">
                  Close
                </button>
              </div>
            )}
        </BookingDetailSurface>
        {nestedDetailPanelEl}
      </>
    );
  }

  const d = displayDetail;
  const shouldHoldPopoverForFullDetail = isPopover && !isHydrated;
  const optimisticTableLabel =
    !isHydrated && initialSnapshot?.tableNames && initialSnapshot.tableNames.length > 0
      ? initialSnapshot.tableNames.join(' + ')
      : null;

  const depositPaid = d.deposit_status === 'Paid' && d.deposit_amount_pence;
  const depositAmountStr = d.deposit_amount_pence ? `£${(d.deposit_amount_pence / 100).toFixed(2)}` : null;
  const nextStatuses = BOOKING_STATUS_TRANSITIONS[d.status as BookingStatus] ?? [];
  const canChangeStatus = nextStatuses.length > 0;
  const bookingStyleIsTable = isTableStyleBookingDetail(d, isAppointment);
  const currentStatus = d.status as BookingStatus;
  const forwardStatuses = nextStatuses.filter((status) => !isRevertTransition(currentStatus, status));
  const statusRevertAction = BOOKING_REVERT_ACTIONS[currentStatus];
  const forwardLabel = (status: BookingStatus) => {
    if (status === 'Confirmed') return 'Confirm';
    if (status === 'Seated') return bookingStyleIsTable ? 'Seat' : 'Start';
    if (status === 'Completed') return 'Complete';
    if (status === 'Cancelled') return 'Cancel';
    return status;
  };
  const revertLabel =
    statusRevertAction &&
    currentStatus === 'Seated' &&
    statusRevertAction.target === 'Booked' &&
    !bookingStyleIsTable
      ? 'Undo Start'
      : statusRevertAction?.label;
  const forwardActionVariant = (
    status: BookingStatus,
  ): 'primary' | 'primary-start' | 'danger' | 'outline-danger' => {
    if (status === 'Cancelled') return 'outline-danger';
    if (status === 'No-Show') return 'danger';
    if (status === 'Seated' && !bookingStyleIsTable) return 'primary-start';
    return 'primary';
  };
  const confirmationSentAt = d.communications.find(
    (comm) =>
      comm.message_type === 'booking_confirmation_email' ||
      comm.message_type === 'booking_confirmation_sms',
  )?.created_at;
  const startTime = d.booking_time?.slice(0, 5) ?? '00:00';
  const endTime =
    bookingDisplayEndHm({
      booking_time: d.booking_time,
      booking_end_time: d.booking_end_time ?? null,
      estimated_end_time: d.estimated_end_time,
    }) ?? endHHMMOrFallback(d.estimated_end_time, startTime, 90);
  const durationMinutes = Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime));
  const showAppointmentProcessingEditor =
    isHydrated &&
    (d.inferred_booking_model === 'unified_scheduling' || d.inferred_booking_model === 'practitioner_appointment') &&
    (Boolean(d.service_item_id) || Boolean(d.appointment_service_id));
  const tableLine =
    optimisticTableLabel ??
    (assignedTables.length > 0 ? assignedTables.map((table) => table.name).join(' + ') : null);
  const hasAssignedTable = Boolean(tableLine);
  const serviceLine =
    d.service_variant_name ??
    d.cde_context?.title ??
    initialSnapshot?.serviceName ??
    null;
  const panelBodySpacing = isPopover ? 'space-y-1.5 p-2' : 'space-y-3 p-4';
  const sectionPadding = isPopover ? 'p-2' : 'p-3.5';

  if (isPopover && shouldHoldPopoverForFullDetail) {
    return (
      <>
        <BookingDetailSurface
          presentation="popover"
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName('popover', 'expanded-popover')}
        >
            <div className="flex items-center justify-end border-b border-slate-100 bg-white/95 px-2 py-1.5">
              <button
                type="button"
                aria-label="Close booking detail"
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ExpandedBookingContent
              booking={{
                id: d.id,
                booking_date: d.booking_date,
                booking_time: d.booking_time,
                estimated_end_time: d.estimated_end_time,
                created_at: d.created_at ?? null,
                party_size: d.party_size,
                status: d.status,
                source: d.source,
                deposit_status: d.deposit_status,
                deposit_amount_pence: d.deposit_amount_pence,
                dietary_notes: d.dietary_notes,
                occasion: d.occasion,
                guest_name: displayBookingGuestName(d.guest, initialSnapshot?.guestName),
                ...guestFirstLastForBookingRow(d.guest ?? null, initialSnapshot?.guestName),
                guest_email: d.guest?.email ?? null,
                guest_phone: d.guest?.phone ?? null,
                guest_id: d.guest?.id,
                table_assignments: initialSnapshot?.tableNames?.map((name, index) => ({ id: `snapshot-table-${index}`, name })),
                service_id: d.service_id,
                area_id: d.area_id,
                area_name: d.area_name,
                inferred_booking_model: d.inferred_booking_model,
                booking_model: d.booking_model,
                practitioner_id: d.practitioner_id,
                calendar_id: d.calendar_id,
                appointment_service_id: d.appointment_service_id,
                service_item_id: d.service_item_id,
                booking_end_time: d.booking_end_time ?? null,
                service_variant_id: d.service_variant_id ?? null,
                processing_time_blocks: d.processing_time_blocks ?? null,
                experience_event_id: d.experience_event_id,
                class_instance_id: d.class_instance_id,
                resource_id: d.resource_id,
                event_session_id: d.event_session_id,
                service_name: serviceLine,
                booking_item_name: initialSnapshot?.serviceName ?? serviceLine,
              }}
              detail={undefined}
              detailLoading={!isHydrated}
              tableManagementEnabled={tableManagementEnabled}
              venueId={d.venue_id || venueId || ''}
              venueCurrency={venueCurrency ?? 'GBP'}
              draftMessage=""
              sendingMessage={false}
              onMessageDraftChange={() => {}}
              onSendMessage={async (_channel): Promise<GuestMessageSendResult> => ({ ok: true })}
              onStatusAction={() => {}}
              onDetailUpdated={() => {}}
            />
        </BookingDetailSurface>
        {nestedDetailPanelEl}
      </>
    );
  }

  if (useExpandedContentLayout) {
    const bookingForExpanded = buildBookingForExpanded(d, {
      initialSnapshot,
      serviceLine,
      isHydrated,
      assignedTables,
    });
    const detailForExpanded = buildDetailForExpanded(d, { isHydrated, assignedTables });
    const expandedCtx: BookingDetailExpandedContext = {
      bookingForExpanded,
      detailForExpanded,
      isHydrated,
      tableManagementEnabled,
      venueId: d.venue_id || venueId || '',
      venueCurrency: venueCurrency ?? 'GBP',
      customMessage,
      actionLoading,
      setCustomMessage,
      setActionLoading,
      setError,
      bookingId,
      load,
      d,
      executeStatusChange,
      onUpdated,
      bookingStyleIsTable,
      showAssignModal,
      setShowAssignModal,
      suggestionsLoading,
      assignmentSuggestions,
      assignedTables,
      allTables,
      recommendedTableIds,
      venueTimezone,
      guestHistoryListRefresh,
      stackDepth,
      setNestedBookingOpen,
    };



    return (
      <>
        <BookingDetailSurface
          presentation={isModal ? 'modal' : 'popover'}
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName(isModal ? 'modal' : 'popover', isModal ? 'modal' : 'expanded-popover')}
        >
          <BookingDetailExpandedContent ctx={expandedCtx} />
        </BookingDetailSurface>
        <ConfirmDialog
          open={confirmDialog != null}
          onOpenChange={(open) => {
            if (!open) setConfirmDialog(null);
          }}
          title={confirmDialog?.title ?? ''}
          message={confirmDialog?.message ?? ''}
          confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
          onConfirm={() => confirmDialog?.onConfirm()}
        />
        {nestedDetailPanelEl}
      </>
    );
  }

  const drawerCtx: BookingDetailDrawerContext = {
    d, isPopover, panelBodySpacing, sectionPadding, loading, optimisticDetail, error,
    startTime, endTime, serviceLine, durationMinutes, bookingStyleIsTable, depositPaid, depositAmountStr,
    canChangeStatus, forwardStatuses, statusRevertAction, forwardLabel, revertLabel, forwardActionVariant,
    hasAssignedTable, tableLine, showAppointmentProcessingEditor, confirmationSentAt, initialSnapshot,
    setGuestHistoryListRefresh, actionLoading, isHydrated, detail, updateStatus, assignedTables, optimisticTableLabel,
    tableManagementEnabled, showAssignModal, setShowAssignModal, suggestionsLoading, assignmentSuggestions,
    allTables, recommendedTableIds, bookingId, setActionLoading, setError, load, onUpdated, notesVariant,
    modifyBookingOpen, setModifyBookingOpen, guestHistoryRebookPrefill, guestHistoryListRefresh, setNestedBookingOpen,
    stackDepth, venueTimezone, venueCurrency, venueId, processingBlocksDraft, setProcessingBlocksDraft,
    appointmentCoreMinutesForProcessing, persistProcessingBlocks, runDepositAction, executePermanentDelete,
    setConfirmDialog, customMessage, setCustomMessage, guestMessageChannel, setGuestMessageChannel, onClose,
  };

  return (
    <>
      <BookingDetailSurface
        presentation={isPopover ? 'popover' : 'drawer'}
        onClose={onClose}
        panelRef={panelRef}
        panelShellStyle={panelShellStyle}
        popoverDismissLayer={popoverDismissLayer}
        nestedBookingOpen={nestedBookingOpen != null}
        panelClassName={bookingDetailPanelClassName(isPopover ? 'popover' : 'drawer', isPopover ? 'popover' : 'drawer')}
      >
        <BookingDetailContent ctx={drawerCtx} />
      </BookingDetailSurface>
      <ConfirmDialog
          open={confirmDialog != null}
          onOpenChange={(open) => {
            if (!open) setConfirmDialog(null);
          }}
          title={confirmDialog?.title ?? ''}
          message={confirmDialog?.message ?? ''}
          confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
          onConfirm={() => confirmDialog?.onConfirm()}
        />
      {nestedDetailPanelEl}
    </>
  );
}

