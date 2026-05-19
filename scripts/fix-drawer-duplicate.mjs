import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8');

const surfaceOpen = c.indexOf('        panelClassName={bookingDetailPanelClassName(isPopover ? \'popover\' : \'drawer\', isPopover ? \'popover\' : \'drawer\')}\n      >');
const contentTag = c.indexOf('        <BookingDetailContent ctx={drawerCtx} />', surfaceOpen);
if (surfaceOpen === -1 || contentTag === -1) {
  console.error('markers not found');
  process.exit(1);
}
const innerStart = c.indexOf('\n', surfaceOpen + 10) + 1;
c = c.slice(0, innerStart) + '        <BookingDetailContent ctx={drawerCtx} />\n' + c.slice(contentTag + '        <BookingDetailContent ctx={drawerCtx} />\n'.length);
writeFileSync(path, c);
console.log('removed duplicate drawer body');
