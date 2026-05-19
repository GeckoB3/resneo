import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

if (!c.includes('booking-detail-panel-model')) {
  const helperStart = c.indexOf('function displayBookingGuestName(');
  const exportPanel = c.indexOf('export function BookingDetailPanel(');
  const modelImport = `import {
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

`;
  c = c.slice(0, helperStart) + modelImport + c.slice(exportPanel);
}

const compactStart = c.indexOf('\nfunction CompactInfo(');
if (compactStart !== -1) {
  c = c.slice(0, compactStart) + '\n';
}

// Drop duplicate bookingForExpanded object literals inside useExpandedContentLayout
const blockStart = c.indexOf('  if (useExpandedContentLayout) {');
const blockEnd = c.indexOf('    return (\n      <>\n        <BookingDetailSurface\n          presentation={isModal ? \'modal\' : \'popover\'}', blockStart);
if (blockStart !== -1 && blockEnd !== -1 && !c.includes('buildBookingForExpanded(d')) {
  const inner = c.slice(blockStart, blockEnd);
  const newInner = `  if (useExpandedContentLayout) {
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

`;
  // remove old const bookingForExpanded = { ... }; const detailForExpanded = { ... }; const expandedBody = ( ... );
  const oldObjectsEnd = c.indexOf('    const expandedBody = (', blockStart);
  if (oldObjectsEnd !== -1 && oldObjectsEnd < blockEnd) {
    c = c.slice(0, blockStart) + newInner + c.slice(blockEnd);
  }
}

// Remove expandedBody variable body through closing );
const ebStart = c.indexOf('    const expandedBody = (');
if (ebStart !== -1) {
  const ebEnd = c.indexOf('\n\n    return (\n      <>\n        <BookingDetailSurface\n          presentation={isModal ? \'modal\' : \'popover\'}', ebStart);
  if (ebEnd !== -1) {
    c = c.slice(0, ebStart) + c.slice(ebEnd);
  }
}

const expandedInnerOld = `            <motion className={\`sticky top-0`;
const expandedInnerOld2 = `            <div className={\`sticky top-0 z-10 flex items-center justify-end border-b border-slate-100 bg-white/95 backdrop-blur \${isModal ? 'px-4 py-3' : 'px-2 py-1.5'}\`}>`;
const expandedClosePattern = `            {isModal ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{expandedBody}</motion>
            ) : (
              expandedBody
            )}`;
const expandedClosePatternDiv = `            {isModal ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{expandedBody}</div>
            ) : (
              expandedBody
            )}`;

if (c.includes(expandedClosePatternDiv)) {
  const headerStart = c.indexOf(expandedInnerOld2);
  const expandedSurfaceClose = c.indexOf('        </BookingDetailSurface>\n        <ConfirmDialog', headerStart);
  if (headerStart !== -1 && expandedSurfaceClose !== -1) {
    const surfaceContentStart = c.indexOf('        >\n', c.indexOf("presentation={isModal ? 'modal' : 'popover'}", headerStart - 200)) + '        >\n'.length;
    c = c.slice(0, surfaceContentStart) + '          <BookingDetailExpandedContent ctx={expandedCtx} />\n' + c.slice(expandedSurfaceClose);
  }
}

// Main drawer integration
if (!c.includes('drawerCtx')) {
  const mainReturn = c.indexOf('  return (\n    <>\n      <BookingDetailSurface\n        presentation={isPopover ? \'popover\' : \'drawer\'}');
  const drawerCtxBlock = `  const drawerCtx: BookingDetailDrawerContext = {
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
  };

`;
  c = c.slice(0, mainReturn) + drawerCtxBlock + c.slice(mainReturn);
}

const drawerSurfaceTag = "panelClassName={bookingDetailPanelClassName(isPopover ? 'popover' : 'drawer', isPopover ? 'popover' : 'drawer')}\n      >";
const dsIdx = c.lastIndexOf(drawerSurfaceTag);
if (dsIdx !== -1 && !c.includes('<BookingDetailContent ctx={drawerCtx} />')) {
  const innerStart = dsIdx + drawerSurfaceTag.length + 1;
  const confirmIdx = c.indexOf('      </BookingDetailSurface>\n      <ConfirmDialog', innerStart);
  if (confirmIdx !== -1) {
    c = c.slice(0, innerStart) + '        <BookingDetailContent ctx={drawerCtx} />\n' + c.slice(confirmIdx);
  }
}

writeFileSync(path, c);
console.log('done');
