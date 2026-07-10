/**
 * Card-hold staff UI state resolution
 * (docs: CARD_HOLD_DEPOSITS_DESIGN_AND_IMPLEMENTATION §9.1 state table, §9.2 charge gate).
 *
 * Single source of gating truth for every staff surface: which pill to show,
 * which detail lines, whether the three legacy deposit actions are replaced by
 * card-aware ones, and whether the admin charge / refund actions render. Pure
 * function so it is unit-testable and cannot drift between surfaces.
 */

import {
  CARD_HOLD_LATE_CANCELLED_LINE,
  CARD_HOLD_PILL_CHARGED,
  CARD_HOLD_PILL_ENDED,
  CARD_HOLD_PILL_HELD,
  CARD_HOLD_PILL_REFUNDED,
  CARD_HOLD_PILL_REQUEST_SENT,
  CARD_HOLD_REQUEST_CANCELLED_LINE,
  CARD_HOLD_WAIVED_LINE,
  CARD_HOLD_WINDOW_EXPIRED_LINE,
  cardHoldAwaitingCardLine,
  cardHoldChargeFailureLine,
  cardHoldChargedLine,
  cardHoldEndedLine,
  cardHoldHeldLine,
  cardHoldRefundedLine,
} from '@/components/booking/card-hold-copy';

/** `card_hold` object on `GET /api/venue/bookings/[id]` (§9.1). */
export interface CardHoldSummary {
  fee_pence: number;
  saved: boolean;
  charged_pence: number | null;
  charged_at: string | null;
  released_at: string | null;
  charge_failure_code: string | null;
  charge_window_ends_at: string | null;
  /** Set when a late cancellation kept the hold chargeable (§9.3 amended). */
  late_cancellation_at?: string | null;
}

export interface CardHoldBookingFields {
  status: string;
  deposit_status: string;
}

export type CardHoldUiKind =
  | 'awaiting_card' // 'Pending' + open unsaved hold (staff flow, awaiting card)
  | 'request_cancelled' // 'Pending' + released hold (cancelled before the card was saved)
  | 'held' // 'Card Held', not released
  | 'ended' // 'Card Held', released
  | 'charged' // 'Charged'
  | 'refunded' // 'Refunded' (was 'Charged')
  | 'inactive'; // hold row exists but no display state applies (e.g. 'Waived', 'Failed')

export type CardHoldPillVariant = 'warning' | 'info' | 'neutral' | 'brand';

export interface CardHoldUiState {
  kind: CardHoldUiKind;
  /** Pill for the deposit block; null for informational-only states. */
  pill: { label: string; variant: CardHoldPillVariant; dot?: boolean } | null;
  /** Detail lines, in render order (charge-failure line already appended). */
  lines: string[];
  /** Consented fee snapshot when known; feeds the charge dialog and fee lines. */
  feePence: number | null;
  /**
   * A hold row exists (or the enum value proves one), so the three legacy
   * deposit actions (send payment link / waive / record cash) must be hidden.
   * Always true when this object is non-null; explicit for readability.
   */
  hideLegacyDepositActions: true;
  /** Awaiting-card only: card-aware `Resend link` (posts `send_payment_link`, §9.2b). */
  showResendLink: boolean;
  /** Awaiting-card only: `Waive` (server releases the unsaved hold, §9.2c). */
  showWaive: boolean;
  /** Admin-only client mirror of the §9.2a charge guards. */
  showChargeAction: boolean;
  /** Admin-only `Refund no-show fee` when the fee was charged (§9.2e). */
  showRefundAction: boolean;
  /**
   * `Release card hold` for a hold kept by a late cancellation (§9.3 amended):
   * releases without charging, e.g. when the venue asked for the cancellation.
   * Any staff, matching the waive action.
   */
  showReleaseAction: boolean;
}

/**
 * Resolve the §9.1 display + action state for a booking.
 *
 * Returns null when the booking has no card hold at all, in which case the
 * legacy deposit UI applies unchanged. When `cardHold` is missing from the
 * payload (list rows, optimistic snapshots) but `deposit_status` is one of the
 * hold-only enum values (`'Card Held'` / `'Charged'`), a conservative
 * enum-only state is returned: correct pill, fee-less lines, and no charge
 * action (the gate needs the hold row's `saved` / window fields).
 */
export function resolveCardHoldUiState(
  booking: CardHoldBookingFields,
  cardHold: CardHoldSummary | null | undefined,
  opts: { isAdmin: boolean; now?: Date },
): CardHoldUiState | null {
  const ds = booking.deposit_status;
  const holdOnlyEnum = ds === 'Card Held' || ds === 'Charged';
  if (!cardHold && !holdOnlyEnum) return null;

  const released = cardHold?.released_at != null;
  const feePence = cardHold ? cardHold.fee_pence : null;

  const now = opts.now ?? new Date();
  const windowEndsAt = cardHold?.charge_window_ends_at
    ? Date.parse(cardHold.charge_window_ends_at)
    : Number.NaN;
  const windowExpired = Number.isFinite(windowEndsAt) && now.getTime() > windowEndsAt;

  // Kept by a late cancellation (§9.3 amended): booking Cancelled, hold open,
  // late_cancellation_at stamped. The fee stays chargeable and staff may
  // release without charging.
  const keptByLateCancellation =
    booking.status === 'Cancelled' &&
    ds === 'Card Held' &&
    !released &&
    cardHold?.late_cancellation_at != null;

  let kind: CardHoldUiKind;
  if (ds === 'Charged') {
    kind = 'charged';
  } else if (ds === 'Refunded') {
    kind = 'refunded';
  } else if (ds === 'Card Held') {
    kind = released ? 'ended' : 'held';
  } else if (ds === 'Pending') {
    // A saved-but-not-yet-flipped row (confirm race) reads as held: the card
    // is on file and the resend/waive affordances no longer apply.
    kind = released ? 'request_cancelled' : cardHold?.saved ? 'held' : 'awaiting_card';
  } else {
    kind = 'inactive';
  }

  let pill: CardHoldUiState['pill'] = null;
  const lines: string[] = [];
  switch (kind) {
    case 'awaiting_card':
      pill = { label: CARD_HOLD_PILL_REQUEST_SENT, variant: 'warning', dot: true };
      lines.push(cardHoldAwaitingCardLine(feePence ?? 0));
      break;
    case 'request_cancelled':
      lines.push(CARD_HOLD_REQUEST_CANCELLED_LINE);
      break;
    case 'held':
      pill = { label: CARD_HOLD_PILL_HELD, variant: 'info', dot: true };
      lines.push(cardHoldHeldLine(feePence));
      // A hold kept by a late cancellation: say why it is still chargeable
      // on a Cancelled booking (§9.3 amended).
      if (keptByLateCancellation) {
        lines.push(CARD_HOLD_LATE_CANCELLED_LINE);
      }
      if (cardHold?.charge_failure_code) {
        lines.push(cardHoldChargeFailureLine(cardHold.charge_failure_code));
      }
      // Explain the missing Charge button once the window has passed for a
      // saved hold that would otherwise still look chargeable.
      if (
        (booking.status === 'No-Show' || keptByLateCancellation) &&
        cardHold?.saved &&
        windowExpired
      ) {
        lines.push(CARD_HOLD_WINDOW_EXPIRED_LINE);
      }
      break;
    case 'ended':
      pill = { label: CARD_HOLD_PILL_ENDED, variant: 'neutral' };
      lines.push(cardHoldEndedLine(cardHold?.released_at ?? null));
      break;
    case 'charged':
      pill = { label: CARD_HOLD_PILL_CHARGED, variant: 'warning', dot: true };
      lines.push(cardHoldChargedLine(cardHold?.charged_pence ?? null, cardHold?.charged_at ?? null));
      break;
    case 'refunded':
      pill = { label: CARD_HOLD_PILL_REFUNDED, variant: 'brand' };
      lines.push(cardHoldRefundedLine(cardHold?.charged_pence ?? null));
      break;
    case 'inactive':
      // A waived request is the only inactive state with something to say.
      if (ds === 'Waived') lines.push(CARD_HOLD_WAIVED_LINE);
      break;
  }

  // Client mirror of the §9.2a guards 2-6 (the server re-checks all of them):
  // No-Show status OR a late-cancellation keep, 'Card Held', hold open, saved
  // card, within the charge window.
  const chargeEligible =
    (booking.status === 'No-Show' || keptByLateCancellation) &&
    ds === 'Card Held' &&
    cardHold != null &&
    cardHold.saved &&
    cardHold.released_at == null &&
    !windowExpired &&
    Number.isFinite(windowEndsAt);

  return {
    kind,
    pill,
    lines,
    feePence,
    hideLegacyDepositActions: true,
    showResendLink: kind === 'awaiting_card',
    showWaive: kind === 'awaiting_card',
    showChargeAction: opts.isAdmin && chargeEligible,
    showRefundAction: opts.isAdmin && kind === 'charged',
    showReleaseAction: keptByLateCancellation && cardHold?.saved === true,
  };
}

/**
 * Roster affordance candidate (§9.2 class roster). The attendees payload
 * carries only `status` + `deposit_status` (no hold row fields), so the roster
 * cannot mirror the full charge gate; it deep-links chargeable-looking rows to
 * the booking detail surface, which re-derives the real gate from the full
 * payload. Enum-only check: canonical No-Show plus the hold-only 'Card Held'.
 */
export function isRosterChargeLinkCandidate(attendee: {
  status: string;
  deposit_status: string | null;
}): boolean {
  return attendee.status === 'No-Show' && attendee.deposit_status === 'Card Held';
}
