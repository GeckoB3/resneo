'use client';

/**
 * Shared card-hold block for the staff booking detail surfaces
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §9.1 display, §9.2 charge UI).
 *
 * Rendered by `BookingDetailContent` and `ExpandedBookingContent` in place of
 * the legacy deposit actions whenever `resolveCardHoldUiState` returns a state.
 * The compact `CardHoldStateLine` is reused by the appointment and resource
 * detail sheets, which show state only (the charge action lives on the full
 * booking detail surface).
 */

import { useState } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { Button } from '@/components/ui/primitives/Button';
import { formatCardHoldFeePence } from '@/lib/booking/card-hold-terms';
import {
  CARD_HOLD_CHARGE_ACTION_LABEL,
  CARD_HOLD_CHARGE_DIALOG_TITLE,
  CARD_HOLD_REFUND_ACTION_LABEL,
  CARD_HOLD_RELEASE_ACTION_LABEL,
  CARD_HOLD_RESEND_LINK_LABEL,
  CARD_HOLD_WAIVE_LABEL,
  cardHoldChargeConfirmLabel,
  cardHoldChargeDialogBody,
  cardHoldReleaseDialogBody,
} from '@/components/booking/card-hold-copy';
import type { CardHoldUiState } from '@/components/booking/card-hold-ui-state';

/** Deposit-route actions the card-hold block posts through the surface's runner (§9.2b/c/e + release_hold). */
export type CardHoldLegacyDepositAction = 'send_payment_link' | 'waive' | 'refund' | 'release_hold';

/**
 * Charge action state: posts `charge_no_show_fee` to the deposit route and
 * surfaces 402 (and other 4xx) messages inline (§9.2a).
 */
export function useCardHoldActions(bookingId: string, onChanged: () => void | Promise<void>) {
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);

  const chargeNoShowFee = async (amountPence: number): Promise<boolean> => {
    setCharging(true);
    setChargeError(null);
    try {
      const res = await fetch(`/api/venue/bookings/${bookingId}/deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'charge_no_show_fee', amount_pence: amountPence }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };
        setChargeError(
          payload.message ?? payload.error ?? 'The charge could not be completed. Please try again.',
        );
        return false;
      }
      setChargeError(null);
      await onChanged();
      return true;
    } catch {
      setChargeError('The charge could not be completed. Please try again.');
      return false;
    } finally {
      setCharging(false);
    }
  };

  return { charging, chargeError, setChargeError, chargeNoShowFee };
}

/** Pounds string for the amount input, e.g. 2500 -> "25.00". */
function penceToPoundsInput(pence: number): string {
  return (pence / 100).toFixed(2);
}

/** Parse the amount input to pence; null when not a usable number. */
function parsePoundsInputToPence(value: string): number | null {
  const trimmed = value.trim().replace(/^£/, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const pounds = Number(trimmed);
  if (!Number.isFinite(pounds)) return null;
  return Math.round(pounds * 100);
}

/**
 * §9.2 charge dialog: amount pre-filled with the full fee, max = fee, min £1,
 * confirm label live-updating, 402 messages inline.
 */
export function CardHoldChargeDialog({
  open,
  onOpenChange,
  bookingId,
  guestName,
  feePence,
  onCharged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: string;
  guestName: string;
  feePence: number;
  onCharged: () => void | Promise<void>;
}) {
  const [amountInput, setAmountInput] = useState(penceToPoundsInput(feePence));
  const { charging, chargeError, setChargeError, chargeNoShowFee } = useCardHoldActions(
    bookingId,
    onCharged,
  );

  // Reset the form each time the dialog opens. Adjust-state-during-render
  // instead of an effect, so no cascading render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setAmountInput(penceToPoundsInput(feePence));
      setChargeError(null);
    }
  }

  // Spec floor is 1 pence, and the server's invalid_amount message quotes
  // £0.01: the dialog must enforce the same bound, not a stricter one.
  const minPence = Math.min(1, feePence);
  const amountPence = parsePoundsInputToPence(amountInput);
  const amountValid = amountPence != null && amountPence >= minPence && amountPence <= feePence;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (charging) return;
        onOpenChange(next);
      }}
      title={CARD_HOLD_CHARGE_DIALOG_TITLE}
      description={cardHoldChargeDialogBody(guestName, feePence)}
      size="sm"
      showClose={false}
      contentClassName="max-w-sm"
      footer={
        <div className="flex gap-2.5">
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            disabled={!amountValid || charging}
            onClick={() => {
              if (amountPence == null || !amountValid) return;
              void (async () => {
                const ok = await chargeNoShowFee(amountPence);
                if (ok) onOpenChange(false);
              })();
            }}
          >
            {charging
              ? 'Charging…'
              : cardHoldChargeConfirmLabel(amountValid && amountPence != null ? amountPence : feePence)}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={charging}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <label htmlFor="card-hold-charge-amount" className="block text-xs font-semibold text-slate-700">
          Amount to charge
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-500">£</span>
          <input
            id="card-hold-charge-amount"
            type="text"
            inputMode="decimal"
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value)}
            disabled={charging}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
            aria-invalid={!amountValid && amountInput.trim().length > 0}
          />
        </div>
        <p className="text-[11px] text-slate-500">
          Between {formatCardHoldFeePence(minPence)} and {formatCardHoldFeePence(feePence)}.
        </p>
        {!amountValid && amountInput.trim().length > 0 ? (
          <p className="text-[11px] font-medium text-red-600">
            Enter an amount between {formatCardHoldFeePence(minPence)} and{' '}
            {formatCardHoldFeePence(feePence)}.
          </p>
        ) : null}
        {chargeError ? (
          <p className="rounded-lg border border-red-100 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">
            {chargeError}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/** Compact pill + detail lines, for the appointment / resource detail sheets (§9.1). */
export function CardHoldStateLine({ state }: { state: CardHoldUiState }) {
  if (!state.pill && state.lines.length === 0) return null;
  return (
    <div className="space-y-1">
      {state.pill ? (
        <Pill variant={state.pill.variant} size="sm" dot={state.pill.dot}>
          {state.pill.label}
        </Pill>
      ) : null}
      {state.lines.map((line) => (
        <p key={line} className="text-xs leading-snug text-slate-600">
          {line}
        </p>
      ))}
    </div>
  );
}

/**
 * Full deposit-block body for card-hold bookings: detail lines plus the
 * card-aware actions (§9.1 hiding rule: the caller renders this INSTEAD of the
 * three legacy deposit buttons whenever a hold state resolves).
 */
export function CardHoldDetailSection({
  bookingId,
  guestName,
  state,
  actionDisabled,
  onLegacyDepositAction,
  onChanged,
}: {
  bookingId: string;
  guestName: string;
  state: CardHoldUiState;
  actionDisabled: boolean;
  /** Reuses the surface's existing deposit-route runner (server swaps the comms / releases). */
  onLegacyDepositAction: (action: CardHoldLegacyDepositAction) => void;
  /** Reload after a successful charge. */
  onChanged: () => void | Promise<void>;
}) {
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [refundConfirmOpen, setRefundConfirmOpen] = useState(false);
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const hasActions =
    state.showResendLink ||
    state.showWaive ||
    state.showChargeAction ||
    state.showRefundAction ||
    state.showReleaseAction;

  return (
    <div className="mt-1.5 space-y-1.5">
      {state.lines.map((line) => (
        <p key={line} className="text-xs leading-snug text-slate-600">
          {line}
        </p>
      ))}
      {hasActions ? (
        <div className="flex flex-wrap gap-1.5">
          {state.showResendLink ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => onLegacyDepositAction('send_payment_link')}
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {CARD_HOLD_RESEND_LINK_LABEL}
            </button>
          ) : null}
          {state.showWaive ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => onLegacyDepositAction('waive')}
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {CARD_HOLD_WAIVE_LABEL}
            </button>
          ) : null}
          {state.showChargeAction && state.feePence != null && state.feePence > 0 ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => setChargeDialogOpen(true)}
              className="inline-flex min-h-9 items-center rounded-lg bg-red-600 px-2.5 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {CARD_HOLD_CHARGE_ACTION_LABEL}
            </button>
          ) : null}
          {state.showRefundAction ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => setRefundConfirmOpen(true)}
              className="inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {CARD_HOLD_REFUND_ACTION_LABEL}
            </button>
          ) : null}
          {state.showReleaseAction ? (
            <button
              type="button"
              disabled={actionDisabled}
              onClick={() => setReleaseConfirmOpen(true)}
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              {CARD_HOLD_RELEASE_ACTION_LABEL}
            </button>
          ) : null}
        </div>
      ) : null}
      {state.showChargeAction && state.feePence != null && state.feePence > 0 ? (
        <CardHoldChargeDialog
          open={chargeDialogOpen}
          onOpenChange={setChargeDialogOpen}
          bookingId={bookingId}
          guestName={guestName}
          feePence={state.feePence}
          onCharged={onChanged}
        />
      ) : null}
      {state.showReleaseAction ? (
        // Releasing forfeits the venue's ability to charge the fee and cannot
        // be undone, so it gets a confirm dialog like the money actions.
        <Dialog
          open={releaseConfirmOpen}
          onOpenChange={setReleaseConfirmOpen}
          title={CARD_HOLD_RELEASE_ACTION_LABEL}
          size="sm"
          showClose={false}
          contentClassName="max-w-sm"
          footer={
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                onClick={() => {
                  setReleaseConfirmOpen(false);
                  onLegacyDepositAction('release_hold');
                }}
              >
                {CARD_HOLD_RELEASE_ACTION_LABEL}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setReleaseConfirmOpen(false)}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600">{cardHoldReleaseDialogBody(guestName)}</p>
        </Dialog>
      ) : null}
      {state.showRefundAction ? (
        // Refunding moves real money and cannot be undone (the hold is
        // released), so it gets the same confirm affordance as the charge.
        <Dialog
          open={refundConfirmOpen}
          onOpenChange={setRefundConfirmOpen}
          title={CARD_HOLD_REFUND_ACTION_LABEL}
          size="sm"
          showClose={false}
          contentClassName="max-w-sm"
          footer={
            <div className="flex gap-2.5">
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                onClick={() => {
                  setRefundConfirmOpen(false);
                  onLegacyDepositAction('refund');
                }}
              >
                {CARD_HOLD_REFUND_ACTION_LABEL}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setRefundConfirmOpen(false)}
              >
                Cancel
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-600">
            This refunds the charged no-show fee to {guestName}&apos;s card. The card hold ends and
            the fee cannot be charged again.
          </p>
        </Dialog>
      ) : null}
    </div>
  );
}
