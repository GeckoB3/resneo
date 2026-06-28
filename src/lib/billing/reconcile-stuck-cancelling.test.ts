import { describe, expect, it } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { reconcileStuckCancellingVenues } from './reconcile-stuck-cancelling';

const NOW = new Date('2026-06-28T12:00:00Z');
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => iso(new Date(NOW.getTime() + n * 86_400_000));
const venueById = (fake: FakeSupabase, id: string) =>
  (fake.tables.venues ?? []).find((v) => v.id === id)!;

describe('reconcileStuckCancellingVenues', () => {
  it('flips only cancelling venues whose period end has passed', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'past', plan_status: 'cancelling', subscription_current_period_end: daysFromNow(-1) },
        { id: 'future', plan_status: 'cancelling', subscription_current_period_end: daysFromNow(1) },
        { id: 'noend', plan_status: 'cancelling', subscription_current_period_end: null },
        { id: 'active', plan_status: 'active', subscription_current_period_end: daysFromNow(-1) },
        { id: 'already', plan_status: 'cancelled', subscription_current_period_end: daysFromNow(-1) },
      ],
    });

    const res = await reconcileStuckCancellingVenues(fake.asClient(), NOW);

    expect(res).toEqual({ reconciled: 1, errors: [] });
    expect(venueById(fake, 'past').plan_status).toBe('cancelled'); // flipped
    expect(venueById(fake, 'future').plan_status).toBe('cancelling'); // still in paid period
    expect(venueById(fake, 'noend').plan_status).toBe('cancelling'); // no period end → never expire on missing data
    expect(venueById(fake, 'active').plan_status).toBe('active'); // not cancelling
    expect(venueById(fake, 'already').plan_status).toBe('cancelled'); // unchanged
  });

  it('treats the exact period-end boundary as ended (lte, matching effectivePlanStatus)', async () => {
    const fake = new FakeSupabase({
      venues: [{ id: 'boundary', plan_status: 'cancelling', subscription_current_period_end: iso(NOW) }],
    });

    const res = await reconcileStuckCancellingVenues(fake.asClient(), NOW);

    expect(res.reconciled).toBe(1);
    expect(venueById(fake, 'boundary').plan_status).toBe('cancelled');
  });

  it('is a no-op when nothing is stuck', async () => {
    const fake = new FakeSupabase({
      venues: [
        { id: 'a', plan_status: 'active', subscription_current_period_end: daysFromNow(-1) },
        { id: 'b', plan_status: 'cancelling', subscription_current_period_end: daysFromNow(5) },
      ],
    });

    const res = await reconcileStuckCancellingVenues(fake.asClient(), NOW);

    expect(res.reconciled).toBe(0);
    expect(venueById(fake, 'b').plan_status).toBe('cancelling');
  });
});
