import { describe, expect, it, vi } from 'vitest';
import { recordStripeChargesEnabled } from './charges-enabled';

function adminRecording(result: { error: { message: string } | null } = { error: null }) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['update', 'eq', 'or']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
  const admin = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { admin: admin as never, calls };
}

describe('recordStripeChargesEnabled', () => {
  it("writes Stripe's answer onto every venue holding the account, only when it differs", async () => {
    const { admin, calls } = adminRecording();
    await recordStripeChargesEnabled(admin, 'acct_1', true);
    expect(calls).toEqual([
      ['from', 'venues'],
      ['update', { stripe_charges_enabled: true }],
      ['eq', 'stripe_connected_account_id', 'acct_1'],
      ['or', 'stripe_charges_enabled.is.null,stripe_charges_enabled.neq.true'],
    ]);
  });

  it('treats a missing answer as not able to take charges', async () => {
    const { admin, calls } = adminRecording();
    await recordStripeChargesEnabled(admin, 'acct_1', undefined);
    expect(calls[1]).toEqual(['update', { stripe_charges_enabled: false }]);
  });

  it('does nothing without an account id', async () => {
    const { admin, calls } = adminRecording();
    await recordStripeChargesEnabled(admin, '', true);
    expect(calls).toEqual([]);
  });

  it('logs and does not throw when the write fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = adminRecording({ error: { message: 'column does not exist' } });
    await expect(recordStripeChargesEnabled(admin, 'acct_1', false)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
