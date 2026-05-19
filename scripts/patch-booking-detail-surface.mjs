import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8');

if (!c.includes('<BookingDetailSurface')) {
  const openOld = `  return (
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

  const openOldFixed = openOld.replaceAll('</' + 'motion' + '>', '</div>').replaceAll('<' + 'motion', '<div');

  const openNew = `  const drawerPanelClassName = isPopover
    ? 'flex max-h-[inherit] min-w-0 max-w-full w-full flex-col overflow-x-hidden overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100'
    : 'w-full max-w-md overflow-y-auto border-l border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 lg:rounded-l-2xl';

  return (
    <>
      <BookingDetailSurface
        presentation={isPopover ? 'popover' : 'drawer'}
        onClose={onClose}
        panelRef={panelRef}
        panelShellStyle={panelShellStyle}
        popoverDismissLayer={popoverDismissLayer}
        nestedBookingOpen={nestedBookingOpen != null}
        panelClassName={drawerPanelClassName}
      >`;

  if (!c.includes('return (\n    <>\n      {popoverDismissLayer}')) {
    console.error('open anchor not found');
    process.exit(1);
  }

  const idx = c.indexOf('  return (\n    <>\n      {popoverDismissLayer}');
  const end = c.indexOf('onClick={(e) => e.stopPropagation()}\n        >', idx) + 'onClick={(e) => e.stopPropagation()}\n        >'.length;
  c = c.slice(0, idx) + openNew + c.slice(end);
}

// Close surface before ConfirmDialog in main return (after last SectionCard in drawer body)
const closePattern = /(\s*<\/SectionCard>\s*<\/div>\s*<\/motion>\s*<\/motion>\s*)<ConfirmDialog/;
const closeSrc = closePattern.source.replaceAll('motion', 'div');
if (new RegExp(closeSrc).test(c)) {
  c = c.replace(new RegExp(closeSrc), '\n      </BookingDetailSurface>\n      <ConfirmDialog');
}

c = c.replace(/\n      <\/div>\n      \{nestedDetailPanelEl\}/, '\n      {nestedDetailPanelEl}');

writeFileSync(path, c);
console.log('done');
