'use client';

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
  if (!open) return null;

  const handleConfirm = async () => {
    const ok = await onConfirmErase();
    if (ok) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[65] flex items-end justify-center bg-slate-900/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="erase-guest-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="erase-guest-title" className="text-lg font-semibold text-slate-900">
          Erase personal data?
        </h3>
        <p className="mt-2 text-sm text-slate-700">
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

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Erasing…' : 'Erase personal data'}
          </button>
        </div>
      </div>
    </div>
  );
}
