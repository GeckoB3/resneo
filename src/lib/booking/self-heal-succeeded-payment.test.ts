import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/booking/confirm-deposit-payment', () => ({
  confirmBookingsForSucceededPaymentIntent: vi.fn(),
  sendDepositPaidBookingComms: vi.fn(async () => undefined),
}));
vi.mock('@/lib/emails/venue-email-data', () => ({ venueRowToEmailData: vi.fn(() => ({})) }));

import {
  confirmBookingsForSucceededPaymentIntent,
  sendDepositPaidBookingComms,
} from '@/lib/booking/confirm-deposit-payment';
import { selfHealSucceededPaymentIntent } from './self-heal-succeeded-payment';

const mockConfirm = vi.mocked(confirmBookingsForSucceededPaymentIntent);
const mockComms = vi.mocked(sendDepositPaidBookingComms);

type TableResponse = { data?: unknown; error?: unknown };

/** Minimal fake admin: records reconciliation_alerts inserts, serves venue/booking/guest reads. */
function makeAdmin(overrides: Partial<Record<string, TableResponse>> = {}) {
  const alertInserts: unknown[] = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let op: 'select' | 'insert' = 'select';
      let insertPayload: unknown;
      const chain = (fn?: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          fn?.(...args);
          return builder;
        };
      builder.select = chain();
      builder.insert = chain((payload) => {
        op = 'insert';
        insertPayload = payload;
      });
      builder.eq = chain();
      builder.in = chain();
      const respond = (): TableResponse => {
        if (op === 'insert') {
          if (table === 'reconciliation_alerts') alertInserts.push(insertPayload);
          return overrides[`${table}:insert`] ?? { data: null, error: null };
        }
        if (table === 'venues') return overrides.venues ?? { data: { name: 'V' }, error: null };
        if (table === 'bookings') return overrides.bookings ?? { data: { guest_id: 'g1' }, error: null };
        if (table === 'guests') {
          return overrides.guests ?? { data: { first_name: 'A', last_name: 'B', email: 'a@b.c', phone: null }, error: null };
        }
        return { data: null, error: null };
      };
      builder.single = async () => respond();
      builder.maybeSingle = builder.single;
      builder.then = (resolve: (v: unknown) => unknown, reject: (r?: unknown) => unknown) =>
        Promise.resolve(respond()).then(resolve, reject);
      return builder;
    },
  };
  return { admin, alertInserts };
}

const PARAMS = {
  paymentIntentId: 'pi_1',
  venueId: 'venue-1',
  paymentMethodId: 'pm_1',
  leadBookingId: 'b1',
  source: 'auto-cancel-sweep' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('selfHealSucceededPaymentIntent', () => {
  it('confirms, sends comms, and inserts the self-healed alert', async () => {
    mockConfirm.mockResolvedValue({ ok: true, confirmedIds: ['b1', 'b2'], depositOnlyIds: [], alreadyConfirmed: false });
    const { admin, alertInserts } = makeAdmin();

    const result = await selfHealSucceededPaymentIntent(admin as never, PARAMS);

    expect(result).toEqual({ outcome: 'confirmed', confirmedIds: ['b1', 'b2'] });
    expect(mockComms).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ confirmedIds: ['b1', 'b2'], venueId: 'venue-1' }),
    );
    expect(alertInserts).toEqual([
      expect.objectContaining({
        booking_id: 'b1',
        expected_status: 'Booked',
        actual_stripe_status: 'succeeded_unconfirmed_selfhealed',
      }),
    ]);
  });

  it('a cancelled unit inserts the alert only and sends no comms (J2 parity)', async () => {
    mockConfirm.mockResolvedValue({ ok: false, reason: 'booking_cancelled' });
    const { admin, alertInserts } = makeAdmin();

    const result = await selfHealSucceededPaymentIntent(admin as never, PARAMS);

    expect(result).toEqual({ outcome: 'cancelled_unit' });
    expect(mockComms).not.toHaveBeenCalled();
    expect(alertInserts).toEqual([
      expect.objectContaining({ actual_stripe_status: 'succeeded_cancelled_unit' }),
    ]);
  });

  it('an already-confirmed unit is a no-op: no comms, no alert', async () => {
    mockConfirm.mockResolvedValue({ ok: true, confirmedIds: [], depositOnlyIds: [], alreadyConfirmed: true });
    const { admin, alertInserts } = makeAdmin();

    const result = await selfHealSucceededPaymentIntent(admin as never, PARAMS);

    expect(result).toEqual({ outcome: 'already_confirmed' });
    expect(mockComms).not.toHaveBeenCalled();
    expect(alertInserts).toHaveLength(0);
  });

  it('a comms failure does not lose the confirm or the alert', async () => {
    mockConfirm.mockResolvedValue({ ok: true, confirmedIds: ['b1'], depositOnlyIds: [], alreadyConfirmed: false });
    mockComms.mockRejectedValue(new Error('smtp down'));
    const { admin, alertInserts } = makeAdmin();

    const result = await selfHealSucceededPaymentIntent(admin as never, PARAMS);

    expect(result).toEqual({ outcome: 'confirmed', confirmedIds: ['b1'] });
    expect(alertInserts).toHaveLength(1);
  });

  it('other confirm failures change nothing and report failed', async () => {
    mockConfirm.mockResolvedValue({ ok: false, reason: 'booking_update_failed' });
    const { admin, alertInserts } = makeAdmin();

    const result = await selfHealSucceededPaymentIntent(admin as never, PARAMS);

    expect(result).toEqual({ outcome: 'failed', reason: 'booking_update_failed' });
    expect(mockComms).not.toHaveBeenCalled();
    expect(alertInserts).toHaveLength(0);
  });
});
