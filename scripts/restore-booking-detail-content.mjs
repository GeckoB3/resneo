import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const lines = execSync('git show HEAD:src/app/dashboard/bookings/BookingDetailPanel.tsx', { encoding: 'utf8' })
  .replace(/\r\n/g, '\n')
  .split('\n');

const drawerBody = lines.slice(1440, 2227).join('\n');
let expandedBody = lines.slice(1143, 1332).join('\n');

const drawerFile = `'use client';

import { StaffExpandedBookingModifyModal } from '@/components/booking/StaffExpandedBookingModifyModal';
import { BookingNotesEditablePanel } from '@/components/booking/BookingNotesEditablePanel';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import { BookingStatusPill } from '@/components/ui/dashboard/BookingStatusPill';
import { Pill } from '@/components/ui/dashboard/Pill';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { ProcessingTimeTimelineEditor } from '@/components/dashboard/appointment-services/ProcessingTimeTimelineEditor';
import { bookingStatusDisplayLabel, isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import {
  showAttendanceConfirmedSupplementPill,
  showDepositPendingPill,
} from '@/lib/booking/booking-staff-indicators';
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

  return (
    <>
${drawerBody}
    </>
  );
}
`;

const expandedFile = `'use client';

import { ExpandedBookingContent } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
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
    <>
${expandedBody}
    </>
  );
}
`;

writeFileSync('src/components/booking/BookingDetailContent.tsx', drawerFile);
writeFileSync('src/components/booking/BookingDetailExpandedContent.tsx', expandedFile);
console.log('ok');
