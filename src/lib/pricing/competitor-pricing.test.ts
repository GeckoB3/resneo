import { describe, expect, it } from 'vitest';
import {
  BOOKSY,
  DEFAULT_INPUTS,
  FRESHA,
  computeAll,
  computeBooksy,
  computeFresha,
  computePhorest,
  computeResneo,
  computeTreatwell,
  computeVagaro,
  resneoPlanFor,
  vagaroSubscription,
  type CalculatorInputs,
} from './competitor-pricing';

const input = (over: Partial<CalculatorInputs> = {}): CalculatorInputs => ({
  ...DEFAULT_INPUTS,
  ...over,
});

describe('resneoPlanFor', () => {
  it('picks the cheapest plan that carries the calendars', () => {
    expect(resneoPlanFor(1).name).toBe('Appointments Light');
    expect(resneoPlanFor(2).name).toBe('Appointments Plus');
    expect(resneoPlanFor(5).name).toBe('Appointments Plus');
    expect(resneoPlanFor(6).name).toBe('Appointments Pro');
    expect(resneoPlanFor(50).name).toBe('Appointments Pro');
  });
});

describe('computeResneo', () => {
  it('charges the flat plan fee and nothing else when SMS is inside the allowance', () => {
    const r = computeResneo(input({ calendars: 3, smsPerMonth: 200 }));
    expect(r.total).toBe(49);
    expect(r.lines).toHaveLength(1);
  });

  it('adds SMS overage at 6p once the allowance is used up', () => {
    // Plus includes 250; 400 sent means 150 over at 6p.
    const r = computeResneo(input({ calendars: 3, smsPerMonth: 400 }));
    expect(r.total).toBe(49 + 9);
  });

  it('never charges commission, however many marketplace clients are entered', () => {
    const withClients = computeResneo(input({ marketplaceNewClientsPerMonth: 80 }));
    const without = computeResneo(input({ marketplaceNewClientsPerMonth: 0 }));
    expect(withClients.total).toBe(without.total);
  });
});

describe('computeFresha', () => {
  it('uses the Independent price for a single person', () => {
    const r = computeFresha(input({ calendars: 1, smsPerMonth: 0, useMarketplace: false }));
    expect(r.total).toBe(FRESHA.independentMonthly);
  });

  it('bills per team member above one', () => {
    const r = computeFresha(input({ calendars: 4, smsPerMonth: 0, useMarketplace: false }));
    expect(r.total).toBe(round(FRESHA.perTeamMemberMonthly * 4));
  });

  it('applies the £4 minimum when 20% of the booking is smaller', () => {
    // £15 booking: 20% is £3, so the £4 floor applies.
    const r = computeFresha(
      input({
        calendars: 1,
        averageBookingValue: 15,
        marketplaceNewClientsPerMonth: 10,
        smsPerMonth: 0,
      }),
    );
    const commission = r.lines.find((l) => l.label === 'New client commission');
    expect(commission?.amount).toBe(40);
  });

  it('applies 20% when it beats the minimum', () => {
    const r = computeFresha(
      input({
        calendars: 1,
        averageBookingValue: 50,
        marketplaceNewClientsPerMonth: 10,
        smsPerMonth: 0,
      }),
    );
    expect(r.lines.find((l) => l.label === 'New client commission')?.amount).toBe(100);
  });

  it('charges for texts beyond the 20 included', () => {
    const r = computeFresha(input({ calendars: 1, smsPerMonth: 120, useMarketplace: false }));
    // 100 chargeable at 6p.
    expect(r.total).toBe(round(FRESHA.independentMonthly + 6));
  });
});

describe('computeBooksy', () => {
  it('adds £5 per team member above the first', () => {
    const r = computeBooksy(input({ calendars: 4, smsPerMonth: 0, useMarketplace: false }));
    expect(r.total).toBe(BOOKSY.baseMonthly + 15);
  });

  it('takes 30% of a new client first visit through Boost', () => {
    const r = computeBooksy(
      input({
        calendars: 1,
        averageBookingValue: 40,
        marketplaceNewClientsPerMonth: 10,
        smsPerMonth: 0,
      }),
    );
    expect(r.lines.find((l) => l.label === 'Boost commission')?.amount).toBe(120);
  });

  it('drops the commission entirely when Boost is off', () => {
    const r = computeBooksy(input({ calendars: 1, smsPerMonth: 0, useMarketplace: false }));
    expect(r.lines.find((l) => l.label === 'Boost commission')).toBeUndefined();
  });

  it('never charges for reminder texts, however many are sent', () => {
    // Booksy states confirmations and reminders are always free; its 500 allowance
    // and 5p overage are for marketing blasts, which this calculator does not model.
    const quiet = computeBooksy(input({ calendars: 1, smsPerMonth: 0, useMarketplace: false }));
    const shouty = computeBooksy(input({ calendars: 1, smsPerMonth: 5000, useMarketplace: false }));
    expect(shouty.total).toBe(quiet.total);
  });
});

describe('vagaroSubscription', () => {
  it('climbs £10 a calendar and stops at the cap', () => {
    expect(vagaroSubscription(1)).toBe(20);
    expect(vagaroSubscription(2)).toBe(30);
    expect(vagaroSubscription(6)).toBe(70);
    expect(vagaroSubscription(7)).toBe(80);
    expect(vagaroSubscription(20)).toBe(80);
  });
});

describe('computeVagaro', () => {
  it('takes 20% of a new Marketplace client’s first appointment', () => {
    const r = computeVagaro(
      input({ calendars: 1, averageBookingValue: 50, marketplaceNewClientsPerMonth: 10 }),
    );
    expect(r.lines.find((l) => l.label === 'Marketplace commission')?.amount).toBe(100);
    expect(r.total).toBe(120);
  });

  it('applies no minimum fee, because Vagaro publishes none', () => {
    // A £5 first appointment yields 20% = £1. Fresha and Booksy would floor this
    // at £4 and £5; Vagaro publishes no floor, so it must not get one here.
    const r = computeVagaro(
      input({ calendars: 1, averageBookingValue: 5, marketplaceNewClientsPerMonth: 10 }),
    );
    expect(r.lines.find((l) => l.label === 'Marketplace commission')?.amount).toBe(10);
  });

  it('drops the commission when the marketplace is off', () => {
    const r = computeVagaro(input({ calendars: 1, useMarketplace: false }));
    expect(r.total).toBe(20);
  });

  it('never charges for texts, because UK plan prices are not published', () => {
    const quiet = computeVagaro(input({ calendars: 1, smsPerMonth: 0, useMarketplace: false }));
    const loud = computeVagaro(input({ calendars: 1, smsPerMonth: 5000, useMarketplace: false }));
    expect(loud.total).toBe(quiet.total);
  });
});

describe('estimate-backed providers', () => {
  it('makes Phorest exactly the visitor figure and nothing more', () => {
    const r = computePhorest(input({ phorestMonthlyEstimate: 200, bookingsPerMonth: 100 }));
    expect(r.estimated).toBe(true);
    expect(r.total).toBe(200);
  });

  it('does not charge Phorest a per-booking fee, which is a client-paid deposit', () => {
    const few = computePhorest(input({ phorestMonthlyEstimate: 150, bookingsPerMonth: 20 }));
    const many = computePhorest(input({ phorestMonthlyEstimate: 150, bookingsPerMonth: 900 }));
    expect(few.total).toBe(many.total);
  });

  it('costs Treatwell on commission alone, because its published plans start free', () => {
    const r = computeTreatwell(
      input({
        treatwellMonthlyEstimate: 0,
        averageBookingValue: 40,
        marketplaceNewClientsPerMonth: 10,
      }),
    );
    // Nothing is estimated: the free plan and the 35% are both published.
    expect(r.estimated).toBe(false);
    expect(r.total).toBe(140);
  });

  it('marks Treatwell as an estimate only once a paid tier fee is entered', () => {
    const r = computeTreatwell(
      input({ treatwellMonthlyEstimate: 30, useMarketplace: false }),
    );
    expect(r.estimated).toBe(true);
    expect(r.total).toBe(30);
  });

  it('defaults Treatwell to no software fee', () => {
    expect(DEFAULT_INPUTS.treatwellMonthlyEstimate).toBe(0);
  });
});

describe('computeAll', () => {
  it('sorts competitors cheapest first and reports the saving band', () => {
    const all = computeAll(input());
    const totals = all.competitors.map((c) => c.total);
    expect([...totals].sort((a, b) => a - b)).toEqual(totals);
    expect(all.savingVsCheapest).toBe(round(totals[0] - all.resneo.total));
    expect(all.savingVsDearest).toBe(round(totals[totals.length - 1] - all.resneo.total));
  });

  it('undercuts every competitor on the defaults, now Vagaro carries its commission', () => {
    const all = computeAll(input());
    expect(all.competitors).toHaveLength(5);
    for (const c of all.competitors) {
      expect(c.total).toBeGreaterThan(all.resneo.total);
    }
    expect(all.savingVsCheapest).toBeGreaterThan(0);
  });

  it('does not pretend to beat Vagaro on subscription alone', () => {
    // With the marketplace off, Vagaro's ladder genuinely undercuts Plus at three
    // calendars (£40 against £49). The model must keep showing that: the claim is
    // about total cost including commission, not a blanket win on every input.
    const all = computeAll(
      input({ calendars: 3, useMarketplace: false, marketplaceNewClientsPerMonth: 0 }),
    );
    const vagaro = all.competitors.find((c) => c.id === 'vagaro');
    expect(vagaro?.total).toBeLessThan(all.resneo.total);
    expect(all.savingVsCheapest).toBeLessThan(0);
  });

  it('turns decisively in ResNeo’s favour once marketplace clients are in play', () => {
    const quiet = computeAll(input({ useMarketplace: false, marketplaceNewClientsPerMonth: 0 }));
    const busy = computeAll(input({ useMarketplace: true, marketplaceNewClientsPerMonth: 20 }));
    // ResNeo's own bill does not move with marketplace volume; the others' do.
    expect(busy.resneo.total).toBe(quiet.resneo.total);
    expect(busy.savingVsDearest).toBeGreaterThan(quiet.savingVsDearest);
  });

  it('never returns a negative total for any provider on sane inputs', () => {
    const all = computeAll(input({ calendars: 1, bookingsPerMonth: 0, smsPerMonth: 0 }));
    for (const p of [all.resneo, ...all.competitors]) {
      expect(p.total).toBeGreaterThanOrEqual(0);
    }
  });

  it('caps marketplace clients at total bookings so commission cannot be invented', () => {
    // 60 new clients against 20 bookings a month is impossible; the commission
    // must be charged on 20, not 60.
    const impossible = computeAll(
      input({ bookingsPerMonth: 20, marketplaceNewClientsPerMonth: 60, averageBookingValue: 50 }),
    );
    const honest = computeAll(
      input({ bookingsPerMonth: 20, marketplaceNewClientsPerMonth: 20, averageBookingValue: 50 }),
    );
    const booksyOf = (r: ReturnType<typeof computeAll>) =>
      r.competitors.find((c) => c.id === 'booksy')?.total;
    expect(booksyOf(impossible)).toBe(booksyOf(honest));
  });

  it('reports cost per booking, and nulls it rather than dividing by zero', () => {
    const busy = computeAll(input({ bookingsPerMonth: 200 }));
    expect(busy.costPerBooking?.resneo).toBe(round(busy.resneo.total / 200));
    expect(computeAll(input({ bookingsPerMonth: 0 })).costPerBooking).toBeNull();
  });

  it('treats out-of-range inputs as their floor rather than producing nonsense', () => {
    const all = computeAll(
      input({ calendars: 0, bookingsPerMonth: -50, smsPerMonth: -10, averageBookingValue: -5 }),
    );
    for (const p of [all.resneo, ...all.competitors]) {
      expect(Number.isFinite(p.total)).toBe(true);
      expect(p.total).toBeGreaterThanOrEqual(0);
    }
  });
});

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
