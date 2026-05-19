import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/app/dashboard/bookings/BookingDetailPanel.tsx';
let c = readFileSync(path, 'utf8');

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

const pattern = /\{confirmDialog && \([\s\S]*?Cancel[\s\S]*?\)\}/g;

const before = (c.match(pattern) || []).length;
c = c.replace(pattern, newBlock);
const after = (c.match(pattern) || []).length;

if (before === 0) {
  console.error('pattern not found');
  process.exit(1);
}

writeFileSync(path, c);
console.log(`replaced ${before - after} confirm blocks`);
