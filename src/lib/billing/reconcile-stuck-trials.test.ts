import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { reconcileStuckTrialingVenues } from './reconcile-stuck-trials';

const NOW = new Date('2026-06-28T12:00:00Z');
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => iso(new Date(NOW.getTime() + n * 86_400_000));
const unix = (n: number) => Math.floor((NOW.getTime() + n * 86_400_000) / 1000);
const venueById = (fake: FakeSupabase, id: string) =>
  (fake.tables.venues ?? []).find((v) => v.id === id)!;

/** Minimal Stripe stub: resolves canned subscriptions by id, or throws for unknown ids. */
function stubStripe(subsById: Record<string, unknown>): Stripe {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id: string) => {
        if (!(id in subsById)) throw new Error(`No such subscription: ${id}`);
        return subsById[id];
      }),
    },
  } as unknown as Stripe;
}

describe('reconcileStuckTrialingVenues', () => {
  it('rewrites stuck trials to their real Stripe status (active / past_due / cancelled)', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'converted', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-2), stripe_subscription_id: 'sub_active' },
        { id: 'failed', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-2), stripe_subscription_id: 'sub_pastdue' },
        { id: 'churned', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-2), stripe_subscription_id: 'sub_canceled' },
      ],
    });
    const stripe = stubStripe({
      sub_active: { status: 'active', current_period_start: unix(-2), current_period_end: unix(28) },
      sub_pastdue: { status: 'past_due', current_period_start: unix(-2), current_period_end: unix(28) },
      sub_canceled: { status: 'canceled', current_period_start: unix(-32), current_period_end: unix(-2) },
    });

    const res = await reconcileStuckTrialingVenues(fake.asClient(), stripe, NOW);

    expect(res.scanned).toBe(3);
    expect(res.reconciled).toBe(3);
    expect(res.stillTrialing).toBe(0);
    expect(res.errors).toEqual([]);
    expect(venueById(fake, 'converted').plan_status).toBe('active');
    expect(venueById(fake, 'failed').plan_status).toBe('past_due');
    expect(venueById(fake, 'churned').plan_status).toBe('cancelled');
    // Period dates are refreshed from Stripe.
    expect(venueById(fake, 'converted').subscription_current_period_end).toBe(iso(new Date(unix(28) * 1000)));
  });

  it('keeps trialing (and refreshes the end date) when Stripe still reports a trial', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'extended', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-1), stripe_subscription_id: 'sub_trial' },
      ],
    });
    const stripe = stubStripe({
      // Trial was extended in Stripe: still trialing, new future end.
      sub_trial: { status: 'trialing', current_period_start: unix(-10), current_period_end: unix(10) },
    });

    const res = await reconcileStuckTrialingVenues(fake.asClient(), stripe, NOW);

    expect(res.reconciled).toBe(0);
    expect(res.stillTrialing).toBe(1);
    expect(venueById(fake, 'extended').plan_status).toBe('trialing');
    expect(venueById(fake, 'extended').subscription_current_period_end).toBe(iso(new Date(unix(10) * 1000)));
  });

  it('ignores trials still in window, trials without a period end, and venues without a subscription id', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'inwindow', plan_status: 'trialing', subscription_current_period_end: daysFromNow(3), stripe_subscription_id: 'sub_x' },
        { id: 'noend', plan_status: 'trialing', subscription_current_period_end: null, stripe_subscription_id: 'sub_x' },
        { id: 'nosub', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-1), stripe_subscription_id: null },
        { id: 'active', plan_status: 'active', subscription_current_period_end: daysFromNow(-1), stripe_subscription_id: 'sub_x' },
      ],
    });
    const stripe = stubStripe({ sub_x: { status: 'active', current_period_end: unix(28) } });

    const res = await reconcileStuckTrialingVenues(fake.asClient(), stripe, NOW);

    expect(res.scanned).toBe(0);
    expect(res.reconciled).toBe(0);
    expect(venueById(fake, 'inwindow').plan_status).toBe('trialing');
    expect(venueById(fake, 'noend').plan_status).toBe('trialing');
    expect(venueById(fake, 'nosub').plan_status).toBe('trialing');
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  it('records an error and leaves the venue untouched when the Stripe retrieve fails', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'gone', plan_status: 'trialing', subscription_current_period_end: daysFromNow(-1), stripe_subscription_id: 'sub_missing' },
      ],
    });
    const stripe = stubStripe({}); // retrieve throws for any id

    const res = await reconcileStuckTrialingVenues(fake.asClient(), stripe, NOW);

    expect(res.scanned).toBe(1);
    expect(res.reconciled).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(venueById(fake, 'gone').plan_status).toBe('trialing');
  });
});
