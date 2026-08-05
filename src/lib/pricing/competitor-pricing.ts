/**
 * The cost model behind the public /calculator page.
 *
 * Pure and dependency-light on purpose: every figure below is a published list
 * price, so the whole model is unit-testable and a reader can check any number
 * against the source links in {@link PRICING_SOURCES}.
 *
 * Ground rules, so the comparison stays defensible under scrutiny:
 *
 * 1. **Published prices only.** Where a provider does not publish a price
 *    (Phorest, Treatwell software), the figure is an input the visitor sets
 *    themselves and the provider is flagged `estimated`. We never invent a
 *    precise number and present it as fact.
 * 2. **Round down, never up.** Where a source gives a range, the competitor
 *    gets the cheapest end. The point survives without help.
 * 3. **Card processing is excluded from every provider**, including ResNeo.
 *    Those fees go to a payment processor rather than the booking platform, and
 *    the published rates differ by platform, card type and country, so folding
 *    a single guessed rate into each total would add noise rather than signal.
 * 4. **Everything is treated as ex-VAT.** Booksy and Treatwell both state that
 *    their prices and fees have VAT added; the others do not say either way, so
 *    they are taken at face value.
 */

import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import {
  SMS_INCLUDED_APPOINTMENTS,
  SMS_INCLUDED_LIGHT,
  SMS_INCLUDED_PLUS,
} from '@/lib/billing/sms-allowance';

/** When the competitor figures below were last checked against public sources. */
export const PRICING_CHECKED_ON = 'August 2026';

export interface CalculatorInputs {
  /** Bookable calendars, which is what most providers actually charge per. */
  calendars: number;
  bookingsPerMonth: number;
  /** Average value of one booking, in pounds. Drives every commission. */
  averageBookingValue: number;
  /** New clients per month arriving through the provider's own marketplace. */
  marketplaceNewClientsPerMonth: number;
  smsPerMonth: number;
  /** Whether the business switches the provider's marketplace or Boost on. */
  useMarketplace: boolean;
  /** Whether to add each provider's published marketing and loyalty add-ons. */
  includeAddOns: boolean;
  /** Visitor's own figure for Phorest, which publishes no prices. */
  phorestMonthlyEstimate: number;
  /** Visitor's own figure for Treatwell software, which publishes no price. */
  treatwellMonthlyEstimate: number;
}

export const DEFAULT_INPUTS: CalculatorInputs = {
  calendars: 1,
  bookingsPerMonth: 160,
  averageBookingValue: 35,
  marketplaceNewClientsPerMonth: 6,
  smsPerMonth: 100,
  useMarketplace: true,
  includeAddOns: false,
  phorestMonthlyEstimate: 129,
  /**
   * Treatwell's own pricing page offers both its plans as "Start for free" with
   * no monthly fee, so the default is zero. An earlier version defaulted this to
   * £35 on the strength of a third-party blog, which simply overstated them.
   * The input stays so anyone on a paid tier can enter what they actually pay.
   */
  treatwellMonthlyEstimate: 0,
};

export interface CostLine {
  label: string;
  amount: number;
  /** Shown as small print under the line. */
  detail?: string;
}

export interface ProviderResult {
  id: string;
  name: string;
  /** The plan or basis the total was worked out on. */
  planLabel: string;
  lines: CostLine[];
  total: number;
  /** True when the provider publishes no price, so the total rests on an estimate. */
  estimated: boolean;
  /** One-line caveat rendered on the card. */
  note?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampMin = (n: number, min: number) => (Number.isFinite(n) ? Math.max(min, n) : min);

/**
 * New marketplace clients, floored at zero and capped at total bookings.
 * Without the cap a visitor can ask for 60 new clients against 20 bookings a
 * month, which quietly invents commission that could never be charged.
 */
export function effectiveNewClients(input: CalculatorInputs): number {
  return Math.min(
    clampMin(input.marketplaceNewClientsPerMonth, 0),
    clampMin(input.bookingsPerMonth, 0),
  );
}

/** Drops zero-value lines so a card never shows "SMS: £0.00". */
function summarise(
  provider: Omit<ProviderResult, 'total' | 'lines'> & { lines: CostLine[] },
): ProviderResult {
  const lines = provider.lines.filter((l) => l.amount > 0);
  return {
    ...provider,
    lines,
    total: round2(lines.reduce((sum, l) => sum + l.amount, 0)),
  };
}

// ---------------------------------------------------------------------------
// ResNeo
// ---------------------------------------------------------------------------

/** The cheapest ResNeo plan that carries the calendars asked for. */
export function resneoPlanFor(calendars: number): {
  name: string;
  price: number;
  smsIncluded: number;
} {
  if (calendars <= 1) {
    return { name: 'Appointments Light', price: APPOINTMENTS_LIGHT_PRICE, smsIncluded: SMS_INCLUDED_LIGHT };
  }
  if (calendars <= 5) {
    return { name: 'Appointments Plus', price: APPOINTMENTS_PLUS_PRICE, smsIncluded: SMS_INCLUDED_PLUS };
  }
  return { name: 'Appointments Pro', price: APPOINTMENTS_PRO_PRICE, smsIncluded: SMS_INCLUDED_APPOINTMENTS };
}

export function computeResneo(input: CalculatorInputs): ProviderResult {
  const calendars = clampMin(input.calendars, 1);
  const plan = resneoPlanFor(calendars);
  const smsOverage = Math.max(0, clampMin(input.smsPerMonth, 0) - plan.smsIncluded);

  return summarise({
    id: 'resneo',
    name: 'ResNeo',
    planLabel: plan.name,
    estimated: false,
    note: 'Flat monthly fee. No commission on any booking, whoever the client is.',
    lines: [
      {
        label: 'Subscription',
        amount: plan.price,
        detail:
          calendars <= 1 ? '1 calendar'
          : calendars <= 5 ? 'Up to 5 calendars and 5 team members'
          : 'Unlimited calendars and team members',
      },
      {
        label: 'Extra SMS',
        amount: round2(smsOverage * SMS_OVERAGE_GBP_PER_MESSAGE),
        detail: `${plan.smsIncluded} included each month, then ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Fresha
// ---------------------------------------------------------------------------

export const FRESHA = {
  independentMonthly: 14.95,
  perTeamMemberMonthly: 9.95,
  newClientCommission: 0.2,
  newClientMinimumFee: 4,
  smsIncluded: 20,
  smsPerMessage: 0.06,
  insightsPerMemberMonthly: 7.95,
  loyaltyPerLocationMonthly: 49.95,
} as const;

export function computeFresha(input: CalculatorInputs): ProviderResult {
  const calendars = clampMin(input.calendars, 1);
  // The Independent plan covers a single-person business; teams are billed per member.
  const subscription =
    calendars <= 1 ? FRESHA.independentMonthly : FRESHA.perTeamMemberMonthly * calendars;

  const perNewClient = Math.max(
    FRESHA.newClientMinimumFee,
    FRESHA.newClientCommission * clampMin(input.averageBookingValue, 0),
  );
  const commission = input.useMarketplace ? perNewClient * effectiveNewClients(input) : 0;

  const smsOverage = Math.max(0, clampMin(input.smsPerMonth, 0) - FRESHA.smsIncluded);
  const addOns =
    input.includeAddOns ?
      FRESHA.insightsPerMemberMonthly * calendars + FRESHA.loyaltyPerLocationMonthly
    : 0;

  return summarise({
    id: 'fresha',
    name: 'Fresha',
    planLabel: calendars <= 1 ? 'Independent' : `Team, ${calendars} members`,
    estimated: false,
    note: 'Subscription is per team member, so the bill grows with every chair you add.',
    lines: [
      {
        label: 'Subscription',
        amount: round2(subscription),
        detail:
          calendars <= 1 ?
            `Independent plan at £${FRESHA.independentMonthly.toFixed(2)}`
          : `£${FRESHA.perTeamMemberMonthly.toFixed(2)} per team member`,
      },
      {
        label: 'New client commission',
        amount: round2(commission),
        detail: `20% of the first booking, minimum £${FRESHA.newClientMinimumFee} per client`,
      },
      {
        label: 'Text messages',
        amount: round2(smsOverage * FRESHA.smsPerMessage),
        detail: `${FRESHA.smsIncluded} included each month, then ${Math.round(FRESHA.smsPerMessage * 100)}p each`,
      },
      {
        label: 'Add-ons',
        amount: round2(addOns),
        detail: 'Insights per team member, plus Client Loyalty per location',
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Booksy
// ---------------------------------------------------------------------------

export const BOOKSY = {
  baseMonthly: 40,
  perExtraStaffMonthly: 5,
  boostCommission: 0.3,
  boostMinimumFee: 5,
} as const;

/**
 * Deliberately carries no SMS line.
 *
 * Booksy's 500 free messages are SMS *marketing* blasts, and its 5p overage
 * applies to those. Appointment confirmations and reminders are stated to be
 * always free, so the reminder volume this calculator asks about costs a Booksy
 * user nothing. An earlier version charged it and overstated Booksy by up to
 * £35 a month.
 */
export function computeBooksy(input: CalculatorInputs): ProviderResult {
  const calendars = clampMin(input.calendars, 1);
  const subscription = BOOKSY.baseMonthly + BOOKSY.perExtraStaffMonthly * (calendars - 1);

  const perNewClient = Math.max(
    BOOKSY.boostMinimumFee,
    BOOKSY.boostCommission * clampMin(input.averageBookingValue, 0),
  );
  const commission = input.useMarketplace ? perNewClient * effectiveNewClients(input) : 0;

  return summarise({
    id: 'booksy',
    name: 'Booksy',
    planLabel: `Base plan, ${calendars} ${calendars === 1 ? 'calendar' : 'calendars'}`,
    estimated: false,
    note: 'Every feature is included in the base fee, and reminder texts are free. The cost that bites is Boost, at 30% of a new client’s first visit.',
    lines: [
      {
        label: 'Subscription',
        amount: round2(subscription),
        detail: `£${BOOKSY.baseMonthly} base, then £${BOOKSY.perExtraStaffMonthly} per extra team member`,
      },
      {
        label: 'Boost commission',
        amount: round2(commission),
        detail: `30% of the first visit, minimum £${BOOKSY.boostMinimumFee} per client`,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Vagaro
// ---------------------------------------------------------------------------

export const VAGARO = {
  firstCalendarMonthly: 20,
  perExtraCalendarMonthly: 10,
  /** The ladder stops climbing at 7 calendars. */
  capCalendars: 7,
  capMonthly: 80,
  /**
   * "A one-time 20% fee applies to the first appointment" for a client who finds
   * you through the Vagaro Marketplace, per Vagaro's own UK pricing page.
   *
   * Its UK product page separately claims "no booking fees eating into your
   * revenue". Both are Vagaro's own words. Read together with the support
   * documentation, which describes the fee and when it is refunded, the product
   * page line is about repeat bookings: the fee lands once, on the first
   * appointment, and never again for that client. We follow the pricing page.
   *
   * No minimum fee is published, so unlike Fresha and Booksy there is no floor
   * applied here. That is the reading most favourable to Vagaro.
   */
  newClientCommission: 0.2,
} as const;

export function vagaroSubscription(calendars: number): number {
  const n = clampMin(calendars, 1);
  if (n >= VAGARO.capCalendars) return VAGARO.capMonthly;
  return VAGARO.firstCalendarMonthly + VAGARO.perExtraCalendarMonthly * (n - 1);
}

export function computeVagaro(input: CalculatorInputs): ProviderResult {
  const calendars = clampMin(input.calendars, 1);
  const commission =
    input.useMarketplace ?
      VAGARO.newClientCommission * clampMin(input.averageBookingValue, 0) * effectiveNewClients(input)
    : 0;

  return summarise({
    id: 'vagaro',
    name: 'Vagaro',
    planLabel: `${calendars} bookable ${calendars === 1 ? 'calendar' : 'calendars'}`,
    estimated: false,
    note: 'The subscription climbs £10 with every calendar, and the Marketplace takes 20% of a new client’s first appointment. In the UK, text messaging is a paid plan on top: those prices are not published, so they are not counted here.',
    lines: [
      {
        label: 'Subscription',
        amount: round2(vagaroSubscription(calendars)),
        detail: `£${VAGARO.firstCalendarMonthly} for the first calendar, then £${VAGARO.perExtraCalendarMonthly} each to a £${VAGARO.capMonthly} cap`,
      },
      {
        label: 'Marketplace commission',
        amount: round2(commission),
        detail: '20% of a new client’s first appointment, one time',
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Phorest (no published prices)
// ---------------------------------------------------------------------------

/**
 * Phorest is subscription only here, on purpose.
 *
 * An earlier version of this model charged the salon a per online booking fee,
 * on the strength of a range quoted in a rival vendor's blog. Phorest's own
 * support material describes that fee as one the *client* pays to secure the
 * slot, which is then deducted from the treatment price at checkout. That makes
 * it a client-side deposit rather than a cost to the business, so charging it
 * here would have overstated Phorest by more than the whole subscription. If it
 * cannot be sourced from Phorest, it does not go in the total.
 */
export function computePhorest(input: CalculatorInputs): ProviderResult {
  const subscription = clampMin(input.phorestMonthlyEstimate, 0);

  return summarise({
    id: 'phorest',
    name: 'Phorest',
    planLabel: 'Quote only',
    estimated: true,
    note: 'Phorest publishes no prices at all, so this is entirely your own figure. Nothing here is our estimate of what Phorest would charge you.',
    lines: [
      { label: 'Subscription', amount: round2(subscription), detail: 'The monthly fee you entered' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Treatwell (marketplace-led, no published software price)
// ---------------------------------------------------------------------------

export const TREATWELL = {
  newClientCommission: 0.35,
} as const;

export function computeTreatwell(input: CalculatorInputs): ProviderResult {
  const subscription = clampMin(input.treatwellMonthlyEstimate, 0);
  const commission =
    input.useMarketplace ?
      TREATWELL.newClientCommission * clampMin(input.averageBookingValue, 0) * effectiveNewClients(input)
    : 0;

  return summarise({
    id: 'treatwell',
    name: 'Treatwell',
    planLabel: 'Connect, commission led',
    // Both of Treatwell's published plans start free and the commission is
    // published, so nothing is estimated until someone enters a paid tier fee.
    estimated: subscription > 0,
    note:
      subscription > 0 ?
        'Treatwell publishes its commission but not the price of any paid tier, so the software fee here is your own figure.'
      : 'Treatwell’s published plans start free and charge on commission instead: 35% of a new marketplace client’s first booking, then 0% on every repeat.',
    lines: [
      { label: 'Software fee', amount: round2(subscription), detail: 'The monthly fee you entered' },
      {
        label: 'New client commission',
        amount: round2(commission),
        detail: '35% of a new marketplace client’s first booking',
      },
    ],
  });
}

// ---------------------------------------------------------------------------

/** ResNeo first, then every competitor cheapest to dearest. */
export function computeAll(input: CalculatorInputs): {
  resneo: ProviderResult;
  competitors: ProviderResult[];
  /** Monthly saving against the cheapest competitor. Negative when ResNeo costs more. */
  savingVsCheapest: number;
  /** Monthly saving against the dearest competitor. */
  savingVsDearest: number;
  costPerBooking: Record<string, number> | null;
  monthlyRevenue: number;
} {
  const resneo = computeResneo(input);
  const competitors = [
    computeFresha(input),
    computeBooksy(input),
    computeVagaro(input),
    computePhorest(input),
    computeTreatwell(input),
  ].sort((a, b) => a.total - b.total);

  const totals = competitors.map((c) => c.total);
  const bookings = clampMin(input.bookingsPerMonth, 0);

  return {
    resneo,
    competitors,
    savingVsCheapest: round2(Math.min(...totals) - resneo.total),
    savingVsDearest: round2(Math.max(...totals) - resneo.total),
    /** What each platform works out at per booking taken. Null when no bookings. */
    costPerBooking:
      bookings > 0 ?
        Object.fromEntries(
          [resneo, ...competitors].map((p) => [p.id, round2(p.total / bookings)]),
        )
      : null,
    /** Monthly takings the bookings represent, for showing cost as a share of revenue. */
    monthlyRevenue: round2(bookings * clampMin(input.averageBookingValue, 0)),
  };
}

/** Every claim on the page traces back to one of these. */
export const PRICING_SOURCES: { provider: string; what: string; url: string }[] = [
  {
    provider: 'Fresha',
    what: 'Subscription, 20% new client commission (£4 minimum), text and add-on prices',
    url: 'https://www.fresha.com/pricing',
  },
  {
    provider: 'Booksy',
    what: 'Base fee, per team member fee, 30% Boost commission (£5 minimum), text prices',
    url: 'https://biz.booksy.com/en-gb/pricing',
  },
  {
    provider: 'Vagaro',
    what: 'The calendar ladder: "£20/mo. to start, with an additional £10 per calendar up to 7 calendars. The cost for 7 or more calendars is £80/mo."',
    url: 'https://www.vagaro.com/en-gb/pro',
  },
  {
    provider: 'Vagaro',
    what: 'The Marketplace fee: "a one-time 20% fee applies to the first appointment" when a new client books you through it',
    url: 'https://www.vagaro.com/en-gb/pro/pricing',
  },
  {
    provider: 'Phorest',
    what: 'Confirmation that pricing is quote only, which is why the Phorest figure is yours rather than ours',
    url: 'https://www.phorest.com/pricing/',
  },
  {
    provider: 'Treatwell',
    what: 'Plans that "start for free", 35% commission on a new client’s first booking, and 0% on repeat bookings',
    url: 'https://www.treatwell.co.uk/partners/pricing/',
  },
  {
    provider: 'ResNeo',
    what: 'Our own plan prices and SMS allowances',
    url: '/#pricing',
  },
];

/**
 * The judgement calls behind the totals. Published on the page because a
 * comparison that hides its assumptions is marketing, not a calculator. Where an
 * assumption could go either way, it is made in the competitor's favour.
 */
export const PRICING_ASSUMPTIONS: string[] = [
  'The one calendars slider maps to each platform’s own billing unit: bookable calendars on ResNeo and Vagaro, team members on Fresha and Booksy. Vagaro is explicit that a bookable calendar does not include front desk staff, so a business with a receptionist who takes no bookings may need an extra paid seat on some platforms and not others.',
  'Fresha’s Independent plan is used for a one-person business at £14.95, because that is the plan Fresha designates for one-person businesses. Its Team plan would work out cheaper at £9.95 for a single member. This is the one figure on the page where we have not taken the cheaper reading, and it costs Fresha £5 a month against a sole trader.',
  'Booksy states that appointment confirmations and reminders are always free, so reminder texts cost Booksy users nothing here. Its 500 message allowance and 5p overage apply to marketing blasts, which this calculator does not model.',
  'Booksy publishes a £40 base plus £5 per extra team member but does not spell out whether the base includes one person. We assume it does, which is the cheaper reading for Booksy.',
  'Fresha’s 20 free monthly messages are for automated reminders, so reminders beyond that are charged at 6p. Fresha’s separate marketing texts at 8p are not modelled.',
  'Vagaro charges a one-time 20% fee on a new Marketplace client’s first appointment, stated on its UK pricing page. Its UK product page separately says there are no booking fees. We follow the pricing page, and read the product page line as being about repeat bookings, which genuinely carry no fee. No minimum fee is published, so unlike Fresha and Booksy no floor is applied, which is the reading most favourable to Vagaro.',
  'Vagaro includes 1,000 email marketing messages a month, but text messaging in the UK is a paid plan rather than a free service as it is in the US and Canada. Those UK plan prices are not published, so no text cost is counted against Vagaro here and its total should be read as a floor. Its branded app, website builder and forms are extra too, and are also unpriced in pounds.',
  'Phorest publishes nothing, so its total is only the figure you type in. A per online booking fee exists in the UK and Ireland, but Phorest describes it as a fee the client pays to secure the slot which is then deducted from their treatment price, so it is not charged to the business here.',
  'Treatwell’s own pricing page offers both its plans as "start for free" with no monthly fee, so the software fee defaults to zero and Treatwell is costed on commission alone. If you are on a paid tier, put the figure in and the row follows it. Its 2.5% fee on online prepayments is not modelled, in line with leaving card processing out for everyone.',
  'Marketplace commissions are one-off charges on a new client’s first booking. The calculator applies them to the number of new marketplace clients you expect each month, which is the steady monthly run rate.',
  'New marketplace clients are capped at your total monthly bookings, so the commission can never exceed what you could actually take.',
  'Card processing fees are excluded for every platform, ResNeo included.',
  'All figures are ex-VAT, and promotional or introductory rates are ignored.',
];
