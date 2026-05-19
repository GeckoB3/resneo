import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Remove duplicate local helpers if model imports exist
if (c.includes("from '@/app/dashboard/bookings/booking-detail-panel-model'")) {
  const start = c.indexOf('function displayBookingGuestName(');
  const end = c.indexOf('export function BookingDetailPanel(');
  if (start !== -1 && end !== -1 && start < end) {
    c = c.slice(0, start) + c.slice(end);
  }
}

// Remove duplicate bottom UI helpers
const uiStart = c.indexOf('\nfunction CompactInfo(');
if (uiStart !== -1) {
  c = c.slice(0, uiStart) + '\n';
}

// Remove expandedBody block (keep bookingForExpanded builders if present)
const eb = c.indexOf('    const expandedBody = (');
if (eb !== -1) {
  const ebEnd = c.indexOf('\n\n    return (\n      <>\n        {popoverDismissLayer}\n        <div\n          className={\n            isModal', eb);
  if (ebEnd === -1) {
    const ebEnd2 = c.indexOf('\n\n    const bookingForExpanded = buildBookingForExpanded', eb);
    if (ebEnd2 !== -1) c = c.slice(0, eb) + c.slice(ebEnd2);
  } else {
    c = c.slice(0, eb) + c.slice(ebEnd);
  }
}

// Remove duplicate inline bookingForExpanded objects when followed by buildBookingForExpanded
c = c.replace(
  /    const bookingForExpanded = \{[\s\S]*?    const detailForExpanded = \{[\s\S]*?    \};\n\n    const bookingForExpanded = buildBookingForExpanded/,
  '    const bookingForExpanded = buildBookingForExpanded',
);

// Expanded return -> Surface + BookingDetailExpandedContent
const expOld = `    return (
      <>
        {popoverDismissLayer}
        <motion
          className={
            isModal
              ? 'fixed inset-0 flex items-end justify-center bg-slate-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-[2px] sm:items-center sm:pb-4'
              : 'fixed'
          }
          style={panelShellStyle}
          onClick={isModal ? (nestedBookingOpen ? undefined : onClose) : undefined}
        >
          <motion
            ref={panelRef}`.replaceAll('motion', 'div');

if (c.includes(expOld.slice(0, 80))) {
  const expStart = c.indexOf(expOld.slice(0, 80));
  const expEnd = c.indexOf('        {nestedDetailPanelEl}\n      </>\n    );\n  }\n\n  return (', expStart);
  const expNew = `    const bookingForExpanded = buildBookingForExpanded(d, {
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

  return (`;
  if (expEnd !== -1) {
    c = c.slice(0, expStart) + expNew + c.slice(expEnd + '        {nestedDetailPanelEl}\n      </>\n    );\n  }\n\n  return ('.length);
  }
}

// Main drawer return
if (!c.includes('drawerCtx')) {
  const mainMarker = `  return (
    <>
      {popoverDismissLayer}
      <motion
        className={
          isPopover
            ? 'fixed'`.replaceAll('motion', 'div');
  const mainStart = c.lastIndexOf(mainMarker.slice(0, 60) === mainMarker.slice(0, 60) ? mainMarker : `  return (
    <>
      {popoverDismissLayer}
      <div
        className={
          isPopover
            ? 'fixed'`);
  if (mainStart !== -1) {
    const openEnd = c.indexOf('onClick={(e) => e.stopPropagation()}\n        >', mainStart) + 'onClick={(e) => e.stopPropagation()}\n        >'.length;
    const closeTag = '      </BookingDetailSurface>\n      <ConfirmDialog';
    let closeIdx = c.indexOf(closeTag, mainStart);
    if (closeIdx === -1) {
      closeIdx = c.indexOf('      </div>\n      <ConfirmDialog', openEnd);
    }
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
`;
    if (closeIdx !== -1) {
      c = c.slice(0, mainStart) + drawerCtx + c.slice(closeIdx);
      c = c.replace(
        `          onConfirm={() => confirmDialog?.onConfirm()}
        />
      </motion>
      {nestedDetailPanelEl}`,
        `          onConfirm={() => confirmDialog?.onConfirm()}
        />
      {nestedDetailPanelEl}`,
      ).replace('      </motion>\n      {nestedDetailPanelEl}', '      {nestedDetailPanelEl}');
    }
  }
}

// Loading state
if (!c.includes('loadingPresentation')) {
  c = wireLoading(c);
}

writeFileSync(path, c);
console.log('finalized');

function wireLoading(content) {
  const start = content.indexOf('  if (!displayDetail) {');
  const refIdx = content.indexOf('ref={panelRef}', start);
  const openEndTag = 'onClick={(e) => e.stopPropagation()}\n          >';
  const openEnd = content.indexOf(openEndTag, refIdx);
  if (start === -1 || openEnd === -1) return content;
  const openEndPos = openEnd + openEndTag.length;
  const closeMarker = `          </div>
        </div>
        {nestedDetailPanelEl}`;
  const closeStart = content.indexOf(closeMarker, openEndPos);
  if (closeStart === -1) return content;
  const closeEnd = closeStart + closeMarker.length;
  const openReplacement = `  if (!displayDetail) {
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
        >`;
  const closeReplacement = `        </BookingDetailSurface>
        {nestedDetailPanelEl}`;
  return content.slice(0, start) + openReplacement + content.slice(openEndPos, closeStart) + closeReplacement + content.slice(closeEnd);
}
