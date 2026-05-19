import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/components/booking/StaffExpandedBookingModifyModal.tsx';
let c = readFileSync(path, 'utf8');

const shellIdx = c.lastIndexOf('  const shellTitle = branch ===');
const returnIdx = c.indexOf('  return (', shellIdx);
const bodyStart = '        <motion className="min-h-0 overflow-y-auto px-5 py-4">';
const bodyStartFixed = bodyStart.replace('motion', 'div');
const bodyIdx = c.indexOf(bodyStartFixed, returnIdx);

if (returnIdx === -1 || bodyIdx === -1) {
  console.error('markers not found', returnIdx, bodyIdx);
  process.exit(1);
}

const openNew = `  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={shellTitle}
      size="md"
      contentClassName="flex max-h-[min(90dvh,90vh)] max-w-xl flex-col overflow-hidden p-0"
    >
      <div className="min-h-0 overflow-y-auto px-5 py-4">`;

c = c.slice(0, returnIdx) + openNew + c.slice(bodyIdx + bodyStartFixed.length);

const closeNew = `      </div>
    </Dialog>
  );
}`;

c = c.replace(
  /        <\/div>\s*<\/div>\s*<\/div>\s*  \);\s*\}\s*$/m,
  closeNew,
);

writeFileSync(path, c);
console.log('patched');
