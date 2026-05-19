'use client';

interface StaffBookingConfirmationFooterProps {
  onDone: () => void;
  doneLabel?: string;
}

/**
 * Shown at the bottom of staff booking success screens so parents can refresh/close
 * only after the user has seen the confirmation (not when the API succeeds).
 */
export function StaffBookingConfirmationFooter({
  onDone,
  doneLabel = 'Done',
}: StaffBookingConfirmationFooterProps) {
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        onClick={onDone}
        className="min-w-[10rem] rounded-xl bg-green-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-green-800 focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2"
      >
        {doneLabel}
      </button>
    </div>
  );
}
