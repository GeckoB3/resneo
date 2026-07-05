import { describe, expect, it } from 'vitest';
import {
  isRosterChargeLinkCandidate,
  resolveCardHoldUiState,
  type CardHoldSummary,
} from './card-hold-ui-state';

const NOW = new Date('2026-07-05T12:00:00Z');

function hold(overrides: Partial<CardHoldSummary> = {}): CardHoldSummary {
  return {
    fee_pence: 2500,
    saved: false,
    charged_pence: null,
    charged_at: null,
    released_at: null,
    charge_failure_code: null,
    charge_window_ends_at: null,
    ...overrides,
  };
}

const savedOpenHold = () =>
  hold({ saved: true, charge_window_ends_at: '2026-07-15T12:00:00Z' });

describe('resolveCardHoldUiState: no hold', () => {
  it('returns null for a plain deposit booking (legacy UI applies)', () => {
    expect(
      resolveCardHoldUiState({ status: 'Booked', deposit_status: 'Pending' }, null, {
        isAdmin: true,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      resolveCardHoldUiState({ status: 'Booked', deposit_status: 'Paid' }, undefined, {
        isAdmin: true,
        now: NOW,
      }),
    ).toBeNull();
  });

  it('returns null for a deposit refund without a hold row', () => {
    expect(
      resolveCardHoldUiState({ status: 'Cancelled', deposit_status: 'Refunded' }, null, {
        isAdmin: true,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe('resolveCardHoldUiState: 9.1 state table', () => {
  it('Pending + open unsaved hold: Card request sent + Resend link + Waive', () => {
    const s = resolveCardHoldUiState(
      { status: 'Pending', deposit_status: 'Pending' },
      hold(),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('awaiting_card');
    expect(s?.pill).toEqual({ label: 'Card request sent', variant: 'warning', dot: true });
    expect(s?.lines).toEqual([
      'Waiting for the guest to add card details. No-show fee up to £25.00.',
    ]);
    expect(s?.showResendLink).toBe(true);
    expect(s?.showWaive).toBe(true);
    expect(s?.showChargeAction).toBe(false);
    expect(s?.showRefundAction).toBe(false);
    expect(s?.hideLegacyDepositActions).toBe(true);
  });

  it('Pending + released hold: informational only, no pill, no actions', () => {
    const s = resolveCardHoldUiState(
      { status: 'Cancelled', deposit_status: 'Pending' },
      hold({ released_at: '2026-07-01T10:00:00Z' }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('request_cancelled');
    expect(s?.pill).toBeNull();
    expect(s?.lines).toEqual(['The card request was cancelled with the booking.']);
    expect(s?.showResendLink).toBe(false);
    expect(s?.showWaive).toBe(false);
    expect(s?.showChargeAction).toBe(false);
  });

  it('Card Held, not released: teal/info pill with fee line', () => {
    const s = resolveCardHoldUiState(
      { status: 'Booked', deposit_status: 'Card Held' },
      savedOpenHold(),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('held');
    expect(s?.pill).toEqual({ label: 'Card held', variant: 'info', dot: true });
    expect(s?.lines).toEqual(['No-show fee up to £25.00. No payment taken.']);
    expect(s?.showChargeAction).toBe(false); // not a No-Show yet
  });

  it('Card Held, released: neutral Card hold ended with release date', () => {
    const s = resolveCardHoldUiState(
      { status: 'Cancelled', deposit_status: 'Card Held' },
      hold({ saved: true, released_at: '2026-07-02T09:00:00Z' }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('ended');
    expect(s?.pill).toEqual({ label: 'Card hold ended', variant: 'neutral' });
    expect(s?.lines).toEqual(['The card hold was released on 2 Jul 2026.']);
    expect(s?.showChargeAction).toBe(false);
  });

  it('Charged: amber pill with amount and date', () => {
    const s = resolveCardHoldUiState(
      { status: 'No-Show', deposit_status: 'Charged' },
      hold({
        saved: true,
        charged_pence: 1500,
        charged_at: '2026-07-03T18:30:00Z',
        charge_window_ends_at: '2026-07-15T12:00:00Z',
      }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('charged');
    expect(s?.pill).toEqual({ label: 'No-show fee charged', variant: 'warning', dot: true });
    expect(s?.lines).toEqual(['£15.00 charged on 3 Jul 2026.']);
    expect(s?.showChargeAction).toBe(false); // one charge per hold
    expect(s?.showRefundAction).toBe(true);
  });

  it('Refunded after a charge: refunded pill with amount', () => {
    const s = resolveCardHoldUiState(
      { status: 'No-Show', deposit_status: 'Refunded' },
      hold({
        saved: true,
        charged_pence: 1500,
        charged_at: '2026-07-03T18:30:00Z',
        released_at: '2026-07-04T10:00:00Z',
      }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('refunded');
    expect(s?.pill).toEqual({ label: 'No-show fee refunded', variant: 'brand' });
    expect(s?.lines).toEqual(['£15.00 refunded.']);
    expect(s?.showRefundAction).toBe(false);
  });

  it('appends the plain-words failure line while the hold stays Card held', () => {
    const s = resolveCardHoldUiState(
      { status: 'No-Show', deposit_status: 'Card Held' },
      hold({
        saved: true,
        charge_failure_code: 'card_declined',
        charge_window_ends_at: '2026-07-15T12:00:00Z',
      }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.pill?.label).toBe('Card held');
    expect(s?.lines).toEqual([
      'No-show fee up to £25.00. No payment taken.',
      'Last charge attempt failed: the card was declined.',
    ]);
    expect(s?.showChargeAction).toBe(true); // retry within window
  });

  it('maps authentication_required to the plain 3DS phrase', () => {
    const s = resolveCardHoldUiState(
      { status: 'No-Show', deposit_status: 'Card Held' },
      hold({
        saved: true,
        charge_failure_code: 'authentication_required',
        charge_window_ends_at: '2026-07-15T12:00:00Z',
      }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.lines[1]).toBe(
      'Last charge attempt failed: the card issuer requires the client to authorise the payment.',
    );
  });

  it('waived-with-hold is inactive: legacy actions stay hidden, nothing else renders', () => {
    const s = resolveCardHoldUiState(
      { status: 'Pending', deposit_status: 'Waived' },
      hold({ released_at: '2026-07-01T10:00:00Z' }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('inactive');
    expect(s?.pill).toBeNull();
    expect(s?.lines).toEqual([]);
    expect(s?.hideLegacyDepositActions).toBe(true);
    expect(s?.showResendLink).toBe(false);
    expect(s?.showChargeAction).toBe(false);
  });
});

describe('resolveCardHoldUiState: charge gate (client mirror of 9.2a guards)', () => {
  const noShowHeld = { status: 'No-Show', deposit_status: 'Card Held' };

  it('shows the charge action for an admin on an open saved hold within the window', () => {
    const s = resolveCardHoldUiState(noShowHeld, savedOpenHold(), { isAdmin: true, now: NOW });
    expect(s?.showChargeAction).toBe(true);
  });

  it('hides the charge action for non-admin staff (state only)', () => {
    const s = resolveCardHoldUiState(noShowHeld, savedOpenHold(), { isAdmin: false, now: NOW });
    expect(s?.showChargeAction).toBe(false);
    expect(s?.pill?.label).toBe('Card held');
  });

  it('requires No-Show status', () => {
    const s = resolveCardHoldUiState(
      { status: 'Completed', deposit_status: 'Card Held' },
      savedOpenHold(),
      { isAdmin: true, now: NOW },
    );
    expect(s?.showChargeAction).toBe(false);
  });

  it('requires a saved card', () => {
    const s = resolveCardHoldUiState(
      noShowHeld,
      hold({ saved: false, charge_window_ends_at: '2026-07-15T12:00:00Z' }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.showChargeAction).toBe(false);
  });

  it('requires the hold to be open (not released)', () => {
    const s = resolveCardHoldUiState(
      noShowHeld,
      hold({
        saved: true,
        released_at: '2026-07-04T10:00:00Z',
        charge_window_ends_at: '2026-07-15T12:00:00Z',
      }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.showChargeAction).toBe(false);
  });

  it('requires now to be within the charge window', () => {
    const s = resolveCardHoldUiState(
      noShowHeld,
      hold({ saved: true, charge_window_ends_at: '2026-07-04T12:00:00Z' }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.showChargeAction).toBe(false);
  });

  it('allows charging exactly at the window boundary', () => {
    const s = resolveCardHoldUiState(
      noShowHeld,
      hold({ saved: true, charge_window_ends_at: NOW.toISOString() }),
      { isAdmin: true, now: NOW },
    );
    expect(s?.showChargeAction).toBe(true);
  });

  it('never shows the charge action without the hold row fields (enum-only fallback)', () => {
    const s = resolveCardHoldUiState(noShowHeld, null, { isAdmin: true, now: NOW });
    expect(s?.showChargeAction).toBe(false);
  });
});

describe('resolveCardHoldUiState: enum-only fallback (payloads without card_hold)', () => {
  it("renders Card held from the enum alone, with a fee-less line", () => {
    const s = resolveCardHoldUiState(
      { status: 'Booked', deposit_status: 'Card Held' },
      undefined,
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('held');
    expect(s?.pill?.label).toBe('Card held');
    expect(s?.lines).toEqual(['Card securely on file. No payment taken.']);
    expect(s?.feePence).toBeNull();
  });

  it('renders No-show fee charged from the enum alone, without amount or date', () => {
    const s = resolveCardHoldUiState(
      { status: 'No-Show', deposit_status: 'Charged' },
      undefined,
      { isAdmin: true, now: NOW },
    );
    expect(s?.kind).toBe('charged');
    expect(s?.lines).toEqual(['A no-show fee was charged.']);
    expect(s?.showRefundAction).toBe(true); // 'Charged' is a hold-only value; server re-guards
  });
});

describe('isRosterChargeLinkCandidate', () => {
  it('matches canonical No-Show with Card Held', () => {
    expect(isRosterChargeLinkCandidate({ status: 'No-Show', deposit_status: 'Card Held' })).toBe(
      true,
    );
  });

  it('rejects other statuses and deposit states', () => {
    expect(isRosterChargeLinkCandidate({ status: 'Booked', deposit_status: 'Card Held' })).toBe(
      false,
    );
    expect(isRosterChargeLinkCandidate({ status: 'No-Show', deposit_status: 'Charged' })).toBe(
      false,
    );
    expect(isRosterChargeLinkCandidate({ status: 'No-Show', deposit_status: null })).toBe(false);
    // Pre-Phase-0 space variant must not match: the roster writes canonical 'No-Show' now (D9).
    expect(isRosterChargeLinkCandidate({ status: 'No Show', deposit_status: 'Card Held' })).toBe(
      false,
    );
  });
});

describe('no em-dashes in any staff-facing hold copy', () => {
  it('contains no U+2014 characters across all states', () => {
    const states = [
      resolveCardHoldUiState({ status: 'Pending', deposit_status: 'Pending' }, hold(), {
        isAdmin: true,
        now: NOW,
      }),
      resolveCardHoldUiState(
        { status: 'Cancelled', deposit_status: 'Pending' },
        hold({ released_at: '2026-07-01T10:00:00Z' }),
        { isAdmin: true, now: NOW },
      ),
      resolveCardHoldUiState(
        { status: 'No-Show', deposit_status: 'Card Held' },
        hold({ saved: true, charge_failure_code: 'card_declined' }),
        { isAdmin: true, now: NOW },
      ),
      resolveCardHoldUiState(
        { status: 'Cancelled', deposit_status: 'Card Held' },
        hold({ saved: true, released_at: '2026-07-02T09:00:00Z' }),
        { isAdmin: true, now: NOW },
      ),
      resolveCardHoldUiState(
        { status: 'No-Show', deposit_status: 'Charged' },
        hold({ saved: true, charged_pence: 2500, charged_at: '2026-07-03T18:30:00Z' }),
        { isAdmin: true, now: NOW },
      ),
      resolveCardHoldUiState(
        { status: 'No-Show', deposit_status: 'Refunded' },
        hold({ saved: true, charged_pence: 2500 }),
        { isAdmin: true, now: NOW },
      ),
    ];
    const all = states
      .flatMap((s) => [s?.pill?.label ?? '', ...(s?.lines ?? [])])
      .join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain('—');
  });
});
