'use client';

import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';

interface EraseGuestDataModalProps {
  open: boolean;
  /** Visible label for the person whose data will be erased. */
  guestDisplayName: string;
  /** Lowercase terminology (e.g. client / customer). */
  clientLower: string;
  /** Lowercase booking word for contextual copy. */
  bookingWordLower: string;
  onClose: () => void;
  /** Perform erase; return true when the server succeeded (dialog closes). */
  onConfirmErase: () => Promise<boolean>;
  busy: boolean;
}

export function EraseGuestDataModal({
  open,
  guestDisplayName,
  clientLower,
  bookingWordLower,
  onClose,
  onConfirmErase,
  busy,
}: EraseGuestDataModalProps) {
  const handleConfirm = async () => {
    const ok = await onConfirmErase();
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy && !next) onClose();
      }}
      title="Erase personal data?"
      size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={busy} loading={busy} onClick={() => void handleConfirm()}>
            {busy ? 'Erasing…' : 'Erase personal data'}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-slate-700">
        This permanently anonymises <span className="font-semibold text-slate-900">{guestDisplayName}</span> at your
        venue. <span className="font-semibold text-amber-800">Admin only.</span> You cannot undo this.
      </p>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">What will happen</p>
        <ul className="mt-2 list-inside list-disc space-y-1.5 text-sm text-slate-700">
          <li>
            <strong>{bookingWordLower}s stay on record</strong> (dates, party size, status, deposits, etc.) so reporting stays intact.
          </li>
          <li>
            Guest <strong>name, email, and phone snapshots</strong> on those {bookingWordLower}s are cleared where stored on the{' '}
            {bookingWordLower} row.
          </li>
          <li>Dietary notes, occasion, guest requests, and staff-only booking notes on those {bookingWordLower}s are cleared.</li>
          <li>Message logs tied to this {clientLower} and delivery logs tied to their {bookingWordLower}s are removed.</li>
          <li>Uploaded documents are marked deleted; loyalty entries, household links, and marketing consent history for this profile go.</li>
          <li>
            The {clientLower} profile is wiped (names, email, phone, tags, custom fields, profile notes) and marketing is opted out.
          </li>
        </ul>
      </div>
    </Dialog>
  );
}
