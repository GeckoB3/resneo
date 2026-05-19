import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

function wireLoading() {
  if (c.includes('loadingPresentation')) {
    console.log('loading: skip');
    return;
  }
  const start = c.indexOf('  if (!displayDetail) {');
  if (start === -1) {
    console.error('loading: block not found');
    process.exit(1);
  }
  const refIdx = c.indexOf('ref={panelRef}', start);
  const openEndTag = 'onClick={(e) => e.stopPropagation()}\n          >';
  const openEnd = c.indexOf(openEndTag, refIdx);
  if (openEnd === -1) {
    console.error('loading: open end not found');
    process.exit(1);
  }
  const openEndPos = openEnd + openEndTag.length;
  const closeMarker = `          </motion>\n        </motion>\n        {nestedDetailPanelEl}`.replaceAll('motion', 'div');
  const closeStart = c.indexOf(closeMarker, openEndPos);
  if (closeStart === -1) {
    console.error('loading: close not found');
    process.exit(1);
  }
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
  c = c.slice(0, start) + openReplacement + c.slice(openEndPos, closeStart) + closeReplacement + c.slice(closeEnd);
  console.log('loading: ok');
}

function wireHold() {
  if (c.includes("bookingDetailPanelClassName('popover', 'expanded-popover')")) {
    console.log('hold: skip');
    return;
  }
  const start = c.indexOf('  if (isPopover && shouldHoldPopoverForFullDetail) {');
  const refIdx = c.indexOf('ref={panelRef}', start);
  const openEnd = c.indexOf('onClick={(event) => event.stopPropagation()}\n          >', refIdx);
  const openEndPos = openEnd + 'onClick={(event) => event.stopPropagation()}\n          >'.length;
  const closeMarker = `          </div>
        </div>
        {nestedDetailPanelEl}
      </>
    );
  }

  if (useExpandedContentLayout) {`;
  const closeStart = c.indexOf(closeMarker, openEndPos);
  if (closeStart === -1) {
    console.error('hold: close not found');
    process.exit(1);
  }
  const closeEnd = closeStart + closeMarker.length;
  const openReplacement = `  if (isPopover && shouldHoldPopoverForFullDetail) {
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
        >`;
  const closeReplacement = `        </BookingDetailSurface>
        {nestedDetailPanelEl}
      </>
    );
  }

  if (useExpandedContentLayout) {`;
  c = c.slice(0, start) + openReplacement + c.slice(openEndPos, closeStart) + closeReplacement + c.slice(closeEnd);
  console.log('hold: ok');
}

function wireExpanded() {
  if (c.includes("presentation={isModal ? 'modal' : 'popover'}")) {
    console.log('expanded: skip');
    return;
  }
  const start = c.indexOf(`    return (
      <>
        {popoverDismissLayer}
        <div
          className={
            isModal
              ? 'fixed inset-0 flex items-end justify-center`);
  const refIdx = c.indexOf('ref={panelRef}', start);
  const openEnd = c.indexOf('onClick={(event) => event.stopPropagation()}\n          >', refIdx);
  const openEndPos = openEnd + 'onClick={(event) => event.stopPropagation()}\n          >'.length;
  const closeMarker = `          </div>
        </div>
        <ConfirmDialog`;
  const closeStart = c.indexOf(closeMarker, openEndPos);
  if (closeStart === -1) {
    console.error('expanded: close not found');
    process.exit(1);
  }
  const closeEnd = closeStart + closeMarker.length;
  const openReplacement = `    return (
      <>
        <BookingDetailSurface
          presentation={isModal ? 'modal' : 'popover'}
          onClose={onClose}
          panelRef={panelRef}
          panelShellStyle={panelShellStyle}
          popoverDismissLayer={popoverDismissLayer}
          nestedBookingOpen={nestedBookingOpen != null}
          panelClassName={bookingDetailPanelClassName(isModal ? 'modal' : 'popover', isModal ? 'modal' : 'expanded-popover')}
        >`;
  const closeReplacement = `        </BookingDetailSurface>
        {confirmDialog && (`;
  c = c.slice(0, start) + openReplacement + c.slice(openEndPos, closeStart) + closeReplacement + c.slice(closeEnd);
  console.log('expanded: ok');
}

function wireMain() {
  if (c.includes("presentation={isPopover ? 'popover' : 'drawer'}")) {
    console.log('main: skip');
    return;
  }
  const mainStart = `  return (
    <>
      {popoverDismissLayer}
      <div
        className={
          isPopover
            ? 'fixed'
            : 'fixed inset-0 flex justify-end bg-slate-900/25 backdrop-blur-[2px]'
        }
        style={panelShellStyle}
        onClick={isPopover ? undefined : nestedBookingOpen ? undefined : onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal={!isPopover}
          aria-label="Booking detail panel"
          className={
            isPopover
              ? 'flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100'
              : 'w-full max-w-md overflow-y-auto border-l border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 lg:rounded-l-2xl'
          }
          onClick={(e) => e.stopPropagation()}
        >`;
  const mIdx = c.lastIndexOf(mainStart);
  if (mIdx === -1) {
    console.error('main: start not found');
    process.exit(1);
  }
  const mOpenEnd = c.indexOf('onClick={(e) => e.stopPropagation()}\n        >', mIdx) + 'onClick={(e) => e.stopPropagation()}\n        >'.length;
  c =
    c.slice(0, mIdx) +
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
      >` +
    c.slice(mOpenEnd);

  const mainCloseOld = `      </SectionCard>
          </div>
        </div>
      </div>
      <ConfirmDialog`;
  const mainCloseNew = `      </SectionCard>
          </div>
        </div>
      </BookingDetailSurface>
      <ConfirmDialog`;
  if (!c.includes(mainCloseOld)) {
    console.error('main: close not found');
    process.exit(1);
  }
  c = c.replace(mainCloseOld, mainCloseNew);
  c = c.replace(
    `          onConfirm={() => confirmDialog?.onConfirm()}
        />
      </div>
      {nestedDetailPanelEl}`,
    `          onConfirm={() => confirmDialog?.onConfirm()}
        />
      {nestedDetailPanelEl}`,
  );
  console.log('main: ok');
}

wireLoading();
wireHold();
wireExpanded();
wireMain();

writeFileSync(path, c);
console.log('done');
