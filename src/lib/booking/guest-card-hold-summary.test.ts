import { describe, expect, it } from 'vitest';
import {
  deriveGuestCardHoldSummary,
  guestCardHoldHeldLine,
  guestCardHoldLateCancelWarning,
  type GuestCardHoldRowInput,
} from './guest-card-hold-summary';

const openUnsavedHold: GuestCardHoldRowInput = {
  fee_pence: 2500,
  released_at: null,
  charged_pence: null,
  charged_at: null,
  stripe_payment_method_id: null,
};

const openSavedHold: GuestCardHoldRowInput = {
  ...openUnsavedHold,
  stripe_payment_method_id: 'pm_123',
};

describe('deriveGuestCardHoldSummary', () => {
  it('returns null when there is no hold row', () => {
    expect(deriveGuestCardHoldSummary({ deposit_status: 'Paid' }, null)).toBeNull();
    expect(deriveGuestCardHoldSummary({ deposit_status: 'Pending' }, undefined)).toBeNull();
  });

  it('Pending + open + unsaved -> awaiting_card (staff link flow, pre-save)', () => {
    const s = deriveGuestCardHoldSummary({ deposit_status: 'Pending' }, openUnsavedHold);
    expect(s).toEqual({
      fee_pence: 2500,
      state: 'awaiting_card',
      charged_pence: null,
      charged_at: null,
    });
  });

  it('Pending + open + card saved -> held (confirm/webhook race; card is on file)', () => {
    const s = deriveGuestCardHoldSummary({ deposit_status: 'Pending' }, openSavedHold);
    expect(s?.state).toBe('held');
  });

  it('Card Held + open -> held', () => {
    const s = deriveGuestCardHoldSummary({ deposit_status: 'Card Held' }, openSavedHold);
    expect(s?.state).toBe('held');
    expect(s?.fee_pence).toBe(2500);
  });

  it('Card Held + released -> released', () => {
    const s = deriveGuestCardHoldSummary(
      { deposit_status: 'Card Held' },
      { ...openSavedHold, released_at: '2026-07-01T10:00:00Z' },
    );
    expect(s?.state).toBe('released');
  });

  it('Pending + released (cancelled before save) -> released', () => {
    const s = deriveGuestCardHoldSummary(
      { deposit_status: 'Pending' },
      { ...openUnsavedHold, released_at: '2026-07-01T10:00:00Z' },
    );
    expect(s?.state).toBe('released');
  });

  it('Charged -> charged with amount and date, even after release', () => {
    const s = deriveGuestCardHoldSummary(
      { deposit_status: 'Charged' },
      {
        ...openSavedHold,
        charged_pence: 2000,
        charged_at: '2026-07-02T09:00:00Z',
      },
    );
    expect(s).toEqual({
      fee_pence: 2500,
      state: 'charged',
      charged_pence: 2000,
      charged_at: '2026-07-02T09:00:00Z',
    });
  });

  it('Refunded with a hold row -> refunded', () => {
    const s = deriveGuestCardHoldSummary(
      { deposit_status: 'Refunded' },
      {
        ...openSavedHold,
        released_at: '2026-07-03T09:00:00Z',
        charged_pence: 2000,
        charged_at: '2026-07-02T09:00:00Z',
      },
    );
    expect(s?.state).toBe('refunded');
    expect(s?.charged_pence).toBe(2000);
  });

  it('is case-insensitive on deposit_status', () => {
    expect(
      deriveGuestCardHoldSummary({ deposit_status: 'card held' }, openSavedHold)?.state,
    ).toBe('held');
  });

  it('returns null for hold-irrelevant statuses on an open row', () => {
    expect(
      deriveGuestCardHoldSummary({ deposit_status: 'Not Required' }, openUnsavedHold),
    ).toBeNull();
  });
});

describe('guestCardHoldHeldLine (§10.1, deadline-aware)', () => {
  it('quotes the cancellation deadline when one exists', () => {
    const line = guestCardHoldHeldLine('Glow Studio', 2500, '2026-07-08T19:00:00.000Z');
    expect(line).toContain('Glow Studio may charge a no-show fee of up to £25.00');
    expect(line).toContain('if you miss this booking or cancel late.');
    expect(line).toContain('Cancel before ');
    expect(line).toContain('to avoid any charge.');
    expect(line).not.toContain('before it starts');
    expect(line).not.toContain('—');
  });

  it('falls back to before-it-starts wording without a deadline', () => {
    for (const deadline of [null, undefined, 'not-a-date']) {
      const line = guestCardHoldHeldLine('Glow Studio', 2500, deadline);
      expect(line).toContain('Cancel before it starts to avoid any charge.');
    }
  });
});

describe('guestCardHoldLateCancelWarning', () => {
  it('names the venue and the fee, with no em-dashes', () => {
    const warning = guestCardHoldLateCancelWarning('Glow Studio', 2500);
    expect(warning).toBe(
      'The free cancellation deadline for this booking has passed. ' +
        'If you cancel now, Glow Studio may still charge a no-show fee of up to £25.00.',
    );
    expect(warning).not.toContain('—');
  });
});
