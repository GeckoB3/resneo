import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8');

const start = c.indexOf('            <div className={`sticky top-0 z-10 flex items-center justify-end');
const comp = c.indexOf('<BookingDetailExpandedContent ctx={expandedCtx} />');
if (start === -1 || comp === -1) {
  console.error('markers not found', start, comp);
  process.exit(1);
}
c = c.slice(0, start) + '          ' + c.slice(comp);
writeFileSync(path, c);
console.log('ok');
