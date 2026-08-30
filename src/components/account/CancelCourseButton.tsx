'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, ConfirmDialog } from '@/components/ui/primitives';

/**
 * "Cancel the whole course" (P2-2a, Register Q-21).
 *
 * Until now the bookings list told a customer to cancel a course by opening
 * every session and cancelling it one at a time, in a footnote that existed
 * only because this control did not.
 *
 * **The consequence lines are computed on the SERVER and passed in.** A course
 * runs for weeks, so part of it is routinely inside its free-cancellation
 * window and part of it is not, and the page already holds every session's
 * deadline and deposit. Fetching them again from the browser would be a second
 * source for one answer, and a spinner in a dialog whose whole job is to say
 * what happens before the customer commits.
 *
 * **It posts to the booking's own cancel route with `scope: 'course'`**, at the
 * id of the first remaining session. The service walks the group from there, so
 * the browser never names the other sessions and cannot be talked into naming
 * ones that are not the customer's.
 */
export function CancelCourseButton({
  anchorBookingId,
  courseName,
  lines,
  disabled,
}: {
  /** The first remaining session; the service finds the rest of the group. */
  anchorBookingId: string;
  courseName: string | null;
  /** What will happen, already worked out server-side. */
  lines: string[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelCourse() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/account/bookings/${anchorBookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'course' }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Could not cancel this course. Please try again.');
        return;
      }
      /*
        The dialog closes and the LIST reloads, rather than this component
        rendering its own success state. A partial cancellation is a real
        outcome, so the honest thing to show is the sessions as they now
        stand: a green tick over a list still showing six live sessions is
        the one thing worse than the error.
      */
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="inline-flex flex-col items-end gap-1">
        <Button
          type="button"
          variant="link"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          disabled={disabled || busy}
          className="inline-flex min-h-6 items-center text-brand-700 underline underline-offset-2 disabled:opacity-60"
        >
          {busy ? 'Cancelling…' : 'Cancel the whole course'}
        </Button>
        {/*
          The failure is rendered on the ROW, not in the dialog.
          `ConfirmDialog` closes itself the moment confirm is pressed, so a
          message inside its body could never be read: the customer would be
          left looking at an unchanged list with no idea whether anything
          happened. `role="alert"` because it appears after the thing that
          had focus has gone.
        */}
        {error && (
          <span role="alert" className="text-[11px] font-medium text-red-700">
            {error}
          </span>
        )}
      </span>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={courseName ? `Cancel ${courseName}` : 'Cancel this course'}
        message="This cancels every session you still have booked. Here is what happens:"
        body={
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-700">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        }
        confirmLabel={busy ? 'Cancelling…' : 'Yes, cancel the course'}
        cancelLabel="Keep my sessions"
        onConfirm={() => void cancelCourse()}
      />
    </>
  );
}
