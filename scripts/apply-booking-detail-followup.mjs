import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// --- imports ---
if (!c.includes('booking-detail-panel-model')) {
  const insertAt = c.indexOf('export type { BookingDetailPanelSnapshot }');
  const imports = `import { BookingDetailSurface } from '@/components/booking/BookingDetailSurface';
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

`;
  c = c.slice(0, insertAt) + imports + c.slice(insertAt);
}

// remove duplicate helpers
if (c.includes('booking-detail-panel-model') && c.includes('function displayBookingGuestName(')) {
  const s = c.indexOf('function displayBookingGuestName(');
  const e = c.indexOf('export function BookingDetailPanel(');
  c = c.slice(0, s) + c.slice(e);
}

// remove bottom UI helpers
const ui = c.indexOf('\nfunction CompactInfo(');
if (ui !== -1) c = c.slice(0, ui) + '\n';

// fix hold condition
c = c.replace(
  'const shouldHoldPopoverForFullDetail = isPopover && !displayDetail;',
  'const shouldHoldPopoverForFullDetail = isPopover && !isHydrated;',
);

function spliceOpenClose(startNeedle, openEndNeedle, closeNeedle, openReplacement, closeReplacement) {
  const start = c.indexOf(startNeedle);
  if (start === -1) return false;
  const openEnd = c.indexOf(openEndNeedle, start);
  if (openEnd === -1) return false;
  const openEndPos = openEnd + openEndNeedle.length;
  const closeStart = c.indexOf(closeNeedle, openEndPos);
  if (closeStart === -1) return false;
  const closeEnd = closeStart + closeNeedle.length;
  c = c.slice(0, start) + openReplacement + c.slice(openEndPos, closeStart) + closeReplacement + c.slice(closeEnd);
  return true;
}

// loading
if (!c.includes('loadingPresentation')) {
  spliceOpenClose(
    '  if (!displayDetail) {\n    return (\n      <>\n        {popoverDismissLayer}',
    'onClick={(e) => e.stopPropagation()}\n          >',
    '          </motion>\n        </motion>\n        {nestedDetailPanelEl}'.replaceAll('motion', 'div'),
    `  if (!displayDetail) {
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
        >`,
    `        </BookingDetailSurface>
        {nestedDetailPanelEl}`,
  );
}

// hold
if (!c.includes("bookingDetailPanelClassName('popover', 'expanded-popover')")) {
  spliceOpenClose(
    '  if (isPopover && shouldHoldPopoverForFullDetail) {\n    return (\n      <>\n        {popoverDismissLayer}',
    'onClick={(event) => event.stopPropagation()}\n          >',
    `          </div>
        </div>
        {nestedDetailPanelEl}
      </>
    );
  }

  if (useExpandedContentLayout)`,
    `  if (isPopover && shouldHoldPopoverForFullDetail) {
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
        >`,
    `        </BookingDetailSurface>
        {nestedDetailPanelEl}
      </>
    );
  }

  if (useExpandedContentLayout)`,
  );
}

// confirm dialogs
const confirmOld = /\{confirmDialog && \([\s\S]*?Cancel[\s\S]*?\)\}/g;
if (confirmOld.test(c)) {
  const newBlock = `<ConfirmDialog
          open={confirmDialog != null}
          onOpenChange={(open) => {
            if (!open) setConfirmDialog(null);
          }}
          title={confirmDialog?.title ?? ''}
          message={confirmDialog?.message ?? ''}
          confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
          onConfirm={() => confirmDialog?.onConfirm()}
        />`;
  c = c.replace(confirmOld, newBlock);
}

// remove expandedBody, inject expanded ctx before expanded return
const ebStart = c.indexOf('    const expandedBody = (');
if (ebStart !== -1) {
  const ebEnd = c.indexOf('\n\n    return (\n      <>\n        {popoverDismissLayer}\n        <div\n          className={\n            isModal', ebStart);
  if (ebEnd !== -1) {
    const setup = `    const bookingForExpanded = buildBookingForExpanded(d, {
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
    c = c.slice(0, ebStart) + setup + c.slice(ebEnd);
  }
}

// expanded surface shell
if (!c.includes("presentation={isModal ? 'modal' : 'popover'}")) {
  spliceOpenClose(
    '    return (\n      <>\n        {popoverDismissLayer}\n        <div\n          className={\n            isModal\n              ? \'fixed inset-0 flex items-end justify-center',
    'onClick={(event) => event.stopPropagation()}\n          >',
    '          </div>\n        </motion>\n        <ConfirmDialog'.replace('motion', 'motion'),
    `    return (
      <>
        <BookingDetailSurface
          presentation={isModal ? 'modal' : 'popover'}
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName(isModal ? 'modal' : 'popover', isModal ? 'modal' : 'expanded-popover')}
        >`,
    `          <BookingDetailExpandedContent ctx={expandedCtx} />
        </BookingDetailSurface>
        <ConfirmDialog`,
  );
  // fix if close marker was div
  if (!c.includes('<BookingDetailExpandedContent ctx={expandedCtx} />')) {
    spliceOpenClose(
      '    return (\n      <>\n        {popoverDismissLayer}\n        <motion\n          className={\n            isModal\n              ? \'fixed inset-0 flex items-end justify-center'.replaceAll('motion', 'div'),
      'onClick={(event) => event.stopPropagation()}\n          >',
      '          </div>\n        </div>\n        <ConfirmDialog',
      `    return (
      <>
        <BookingDetailSurface
          presentation={isModal ? 'modal' : 'popover'}
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName(isModal ? 'modal' : 'popover', isModal ? 'modal' : 'expanded-popover')}
        >`,
      `          <BookingDetailExpandedContent ctx={expandedCtx} />
        </BookingDetailSurface>
        <ConfirmDialog`,
    );
  }
}

// drawer: insert ctx + surface before last return
if (!c.includes('drawerCtx')) {
  const mainReturn = c.lastIndexOf('  return (\n    <>\n      {popoverDismissLayer}\n      <div\n        className={\n          isPopover\n            ? \'fixed\'');
  if (mainReturn !== -1) {
    const drawerCtx = `  const drawerCtx: BookingDetailDrawerContext = {
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

`;
    c = c.slice(0, mainReturn) + drawerCtx + c.slice(mainReturn);
    spliceOpenClose(
      '  return (\n    <>\n      {popoverDismissLayer}\n      <div\n        className={\n          isPopover\n            ? \'fixed\'',
      'onClick={(e) => e.stopPropagation()}\n        >',
      '      </div>\n      <ConfirmDialog',
      `  return (
    <>
      <BookingDetailSurface
        presentation={isPopover ? 'popover' : 'drawer'}
        onClose={onClose}
        panelRef={panelRef}
        panelShellStyle={panelShellStyle}
        popoverDismissLayer={popoverDismissLayer}
        nestedBookingOpen={nestedBookingOpen != null}
        panelClassName={bookingDetailPanelClassName(isPopover ? 'popover' : 'drawer', isPopover ? 'popover' : 'drawer')}
      >`,
      `        <BookingDetailContent ctx={drawerCtx} />
      </BookingDetailSurface>
      <ConfirmDialog`,
    );
    c = c.replace('\n      </div>\n      {nestedDetailPanelEl}', '\n      {nestedDetailPanelEl}');
  }
}

writeFileSync(path, c);
console.log('applied follow-up');
