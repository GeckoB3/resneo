import { readFileSync, writeFileSync } from 'node:fs';

const panelPath = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
const lines = readFileSync(panelPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

const drawerStart = 1379; // 0-based line index for content inside Surface
const drawerEnd = 2166; // exclusive end (line before </BookingDetailSurface>)
const expandedStart = 1125;
const expandedEnd = 1318;

const drawerBody = lines.slice(drawerStart, drawerEnd).join('\n');
const expandedBody = lines.slice(expandedStart, expandedEnd).join('\n');

const drawerImports = `'use client';

import { type ReactNode } from 'react';
import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { bookingStatusDisplayLabel } from '@/lib/booking/infer-booking-row-model';
import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
import {
  GuestBookingsForGuestAccordion,
} from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import type { BookingDetailDrawerContext } from '@/components/booking/booking-detail-drawer-context';
import {
  displayBookingGuestName,
  formatDateNice,
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

  return (
${drawerBody}
  );
}
`;

const expandedImports = `'use client';

import { ExpandedBookingContent } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import type { BookingStatus } from '@/lib/table-management/booking-status';
import { canMarkNoShowForSlot } from '@/lib/table-management/booking-status';
import { isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import type { BookingDetailExpandedContext } from '@/components/booking/booking-detail-expanded-context';

export function BookingDetailExpandedContent({ ctx }: { ctx: BookingDetailExpandedContext }) {
  const {
    bookingForExpanded,
    detailForExpanded,
    isHydrated,
    tableManagementEnabled,
    venueId,
    venueCurrency,
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
  } = ctx;

  return (
${expandedBody}
  );
}
`;

writeFileSync('src/components/booking/BookingDetailContent.tsx', drawerImports);
writeFileSync('src/components/booking/BookingDetailExpandedContent.tsx', expandedImports);
console.log('extracted drawer', drawerEnd - drawerStart, 'lines, expanded', expandedEnd - expandedStart, 'lines');
