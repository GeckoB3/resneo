'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';

/**
 * The 409 body the staff PATCH returns for an unpaid promotion
 * (deposit-payment-robustness-plan 6.1/6.2).
 */
export type DepositUnpaidPayload = {
  code?: string;
  deposit_status?: string | null;
  deposit_amount_pence?: number | null;
  card_hold_fee_pence?: number | null;
};

export function isDepositUnpaid409(resStatus: number, data: unknown): data is DepositUnpaidPayload {
  return (
    resStatus === 409 &&
    typeof data === 'object' &&
    data !== null &&
    (data as { code?: string }).code === 'DEPOSIT_UNPAID'
  );
}

function poundsLine(pence: number | null | undefined): string | null {
  if (!pence || pence <= 0) return null;
  return `£${(pence / 100).toFixed(2)}`;
}

function bodyCopy(info: DepositUnpaidPayload): string {
  const deposit = poundsLine(info.deposit_amount_pence);
  const holdFee = poundsLine(info.card_hold_fee_pence);
  const failed = info.deposit_status === 'Failed';
  if (deposit) {
    return failed
      ? `The ${deposit} deposit for this booking has not been paid. The last payment attempt failed.`
      : `The ${deposit} deposit for this booking has not been paid yet.`;
  }
  if (holdFee) {
    return `Card details have not been saved for this booking yet. The no-show fee is ${holdFee}.`;
  }
  return failed
    ? 'The payment for this booking failed and it is still owed.'
    : 'The payment for this booking has not been completed yet.';
}

export function AcceptUnpaidBookingDialog({
  open,
  info,
  busy,
  linkSent,
  linkError,
  onSendLink,
  onAccept,
  onClose,
}: {
  open: boolean;
  info: DepositUnpaidPayload | null;
  busy: boolean;
  linkSent: boolean;
  linkError: string | null;
  onSendLink: () => void;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Deposit not paid"
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          {info ? bodyCopy(info) : 'The payment for this booking has not been completed yet.'}
        </p>
        <p className="text-sm text-slate-600">
          You can send the customer a new payment link, or accept the booking without payment and
          collect it later.
        </p>
        {linkSent ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Payment link sent to the customer.
          </p>
        ) : null}
        {linkError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {linkError}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button onClick={onSendLink} disabled={busy || linkSent} loading={busy}>
            Send payment link
          </Button>
          <Button variant="secondary" onClick={onAccept} disabled={busy}>
            Accept without payment
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Go back
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Owns the dialog state for a booking surface (single-booking sheets and
 * multi-booking lists alike). Wire it around any staff status/attendance
 * PATCH:
 *
 * ```ts
 * const guard = useAcceptUnpaidGuard();
 * // in the PATCH error path:
 * if (guard.intercept(bookingId, res.status, data, (extra) => patchJson({ ...body, ...extra }))) return;
 * // in the JSX:
 * {guard.dialog}
 * ```
 *
 * "Accept without payment" replays the original PATCH with
 * `accept_unpaid: true`; "Send payment link" posts the deposit action.
 */
export function useAcceptUnpaidGuard(): {
  intercept: (
    bookingId: string,
    resStatus: number,
    data: unknown,
    retry: (extra: { accept_unpaid: true }) => void | Promise<unknown>,
  ) => boolean;
  dialog: ReactNode;
} {
  const [state, setState] = useState<{
    bookingId: string;
    info: DepositUnpaidPayload;
    retry: (extra: { accept_unpaid: true }) => void | Promise<unknown>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const close = useCallback(() => {
    setState(null);
    setBusy(false);
    setLinkSent(false);
    setLinkError(null);
  }, []);

  const intercept = useCallback(
    (
      bookingId: string,
      resStatus: number,
      data: unknown,
      retry: (extra: { accept_unpaid: true }) => void | Promise<unknown>,
    ): boolean => {
      if (!isDepositUnpaid409(resStatus, data)) return false;
      setLinkSent(false);
      setLinkError(null);
      setState({ bookingId, info: data, retry });
      return true;
    },
    [],
  );

  const sendLink = useCallback(async () => {
    const bookingId = state?.bookingId;
    if (!bookingId) return;
    setBusy(true);
    setLinkError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_payment_link' }),
      });
      if (res.ok) {
        setLinkSent(true);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setLinkError(data.error ?? 'Could not send the payment link. Please try again.');
      }
    } catch {
      setLinkError('Could not send the payment link. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [state?.bookingId]);

  const accept = useCallback(() => {
    const retry = state?.retry;
    close();
    if (retry) void retry({ accept_unpaid: true });
  }, [state, close]);

  const dialog = (
    <AcceptUnpaidBookingDialog
      open={state !== null}
      info={state?.info ?? null}
      busy={busy}
      linkSent={linkSent}
      linkError={linkError}
      onSendLink={() => void sendLink()}
      onAccept={accept}
      onClose={close}
    />
  );

  return { intercept, dialog };
}
