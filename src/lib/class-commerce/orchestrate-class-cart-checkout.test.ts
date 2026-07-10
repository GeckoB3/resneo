import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { orchestrateClassCartCheckout } from '@/lib/class-commerce/orchestrate-class-cart-checkout';
import { quoteClassCart } from '@/lib/class-commerce/quote-class-cart';
import { insertFreeClassSessionBooking } from '@/lib/booking/insert-free-class-session-booking';
import { insertPendingPaidClassSessionBooking } from '@/lib/booking/insert-pending-paid-class-session-booking';
import { persistClassCartCheckoutTransaction } from '@/lib/class-commerce/persist-class-checkout';
import { membershipCoversClassType } from '@/lib/class-commerce/membership-allowance-coverage';
import { findOrCreateGuest } from '@/lib/guests';
import { stripe } from '@/lib/stripe';
import type { ClassCartQuoteLine, ClassCartQuoteResult } from '@/types/class-commerce';

vi.mock('@/lib/stripe', () => ({
  stripe: {
    paymentIntents: { create: vi.fn() },
    setupIntents: { create: vi.fn() },
    customers: { create: vi.fn(), del: vi.fn() },
  },
}));
vi.mock('@/lib/guests', () => ({ findOrCreateGuest: vi.fn() }));
vi.mock('@/lib/class-commerce/quote-class-cart', () => ({ quoteClassCart: vi.fn() }));
vi.mock('@/lib/booking/insert-free-class-session-booking', () => ({
  insertFreeClassSessionBooking: vi.fn(),
}));
vi.mock('@/lib/booking/insert-pending-paid-class-session-booking', () => ({
  insertPendingPaidClassSessionBooking: vi.fn(),
}));
vi.mock('@/lib/class-commerce/persist-class-checkout', () => ({
  persistClassCartCheckoutTransaction: vi.fn(),
}));
vi.mock('@/lib/class-commerce/consume-class-credits', () => ({
  consumeClassCreditsForBooking: vi.fn(),
}));
vi.mock('@/lib/class-commerce/restore-class-credits', () => ({
  restoreClassCreditsForBooking: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/class-commerce/restore-membership-allowance', () => ({
  restoreMembershipAllowanceForBooking: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/class-commerce/available-class-credits', () => ({
  sumAvailableClassCreditsForClassType: vi.fn(async () => 0),
}));
vi.mock('@/lib/class-commerce/course-instance-coverage', () => ({
  userCourseCoversClassInstance: vi.fn(async () => false),
}));
vi.mock('@/lib/class-commerce/membership-class-access', () => ({
  membershipUnlimitedCoversClassType: vi.fn(async () => false),
}));
vi.mock('@/lib/class-commerce/membership-allowance-coverage', () => ({
  membershipCoversClassType: vi.fn(),
}));
vi.mock('@/lib/class-commerce/consume-membership-allowance', () => ({
  consumeMembershipAllowanceForBooking: vi.fn(),
}));
// Spy wrapper keeping the REAL decision logic: card-hold lines must bypass the
// entitlement engine entirely (D8), which the spy makes assertable.
vi.mock('@/lib/class-commerce/entitlement-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/class-commerce/entitlement-engine')>();
  return { ...actual, decideClassLineEntitlement: vi.fn(actual.decideClassLineEntitlement) };
});
import { decideClassLineEntitlement } from '@/lib/class-commerce/entitlement-engine';
import { sumAvailableClassCreditsForClassType } from '@/lib/class-commerce/available-class-credits';

const quoteMock = quoteClassCart as unknown as Mock;
const insertFreeMock = insertFreeClassSessionBooking as unknown as Mock;
const insertPendingMock = insertPendingPaidClassSessionBooking as unknown as Mock;
const persistTxnMock = persistClassCartCheckoutTransaction as unknown as Mock;
const membershipCoversMock = membershipCoversClassType as unknown as Mock;
const findOrCreateGuestMock = findOrCreateGuest as unknown as Mock;
const decideEntitlementMock = decideClassLineEntitlement as unknown as Mock;
const sumCreditsMock = sumAvailableClassCreditsForClassType as unknown as Mock;
const piCreateMock = stripe.paymentIntents.create as unknown as Mock;
const siCreateMock = stripe.setupIntents.create as unknown as Mock;
const customerCreateMock = stripe.customers.create as unknown as Mock;
const customerDelMock = stripe.customers.del as unknown as Mock;

/** Everything the fake admin records so tests can assert persistence side effects. */
type Recorded = {
  holdRows: Array<Record<string, unknown>>;
  bookingUpdates: Array<{ patch: Record<string, unknown>; ids: string[] }>;
  deletes: Array<{ table: string; col: string; val: unknown }>;
};

function makeAdmin(rec: Recorded, opts: { holdInsertError?: boolean } = {}): SupabaseClient {
  return {
    from(table: string) {
      if (table === 'venues') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'venue-1',
                  name: 'Studio One',
                  address: null,
                  email: null,
                  reply_to_email: null,
                  timezone: 'Europe/London',
                  stripe_connected_account_id: 'acct_1',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'class_booking_groups') {
        return {
          insert: async () => ({ error: null }),
          delete: () => ({
            eq: async (col: string, val: unknown) => {
              rec.deletes.push({ table, col, val });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'bookings') {
        return {
          update: (patch: Record<string, unknown>) => ({
            in: async (_col: string, ids: string[]) => {
              rec.bookingUpdates.push({ patch, ids });
              return { error: null };
            },
          }),
          delete: () => ({
            eq: async (col: string, val: unknown) => {
              rec.deletes.push({ table, col, val });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'booking_card_holds') {
        return {
          insert: async (rows: Array<Record<string, unknown>>) => {
            if (opts.holdInsertError) return { error: { message: 'boom' } };
            rec.holdRows.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

function qLine(over: Partial<ClassCartQuoteLine>): ClassCartQuoteLine {
  return {
    class_instance_id: 'inst-1',
    party_size: 1,
    booking_date: '2026-07-10',
    booking_time: '09:00',
    class_name: 'Yoga',
    class_type_id: 'ct-1',
    remaining_before: 10,
    online_charge_pence: 0,
    original_pence: 0,
    member_discount_pence: 0,
    member_discount_percent: 0,
    payment_requirement: 'none',
    card_hold_fee_pence: null,
    requires_stripe_checkout: false,
    ok: true,
    ...over,
  };
}

function mockQuote(lines: ClassCartQuoteLine[]): void {
  const holdTotal = lines.reduce((s, l) => s + (l.card_hold_fee_pence ?? 0), 0);
  const quote: ClassCartQuoteResult = {
    venue_id: 'venue-1',
    lines,
    all_ok: lines.every((l) => l.ok),
    requires_authentication: true,
    total_online_charge_pence: lines.reduce((s, l) => s + l.online_charge_pence, 0),
    card_hold_fee_pence: lines.some((l) => l.card_hold_fee_pence != null) ? holdTotal : null,
  };
  quoteMock.mockResolvedValue(quote);
}

function checkout(admin: SupabaseClient, lineCount: number) {
  return orchestrateClassCartCheckout(admin, {
    venueId: 'venue-1',
    lines: Array.from({ length: lineCount }, (_, i) => ({
      class_instance_id: `inst-${i + 1}`,
      party_size: 1,
    })),
    userId: 'user-1',
    userEmail: 'Guest@Example.com',
    displayName: 'Pat Guest',
  });
}

describe('orchestrateClassCartCheckout card-hold capture modes', () => {
  let seq: number;

  beforeEach(() => {
    vi.clearAllMocks();
    seq = 0;
    findOrCreateGuestMock.mockResolvedValue({ guest: { id: 'guest-1', user_id: 'user-1' } });
    membershipCoversMock.mockResolvedValue({ ok: false });
    insertPendingMock.mockImplementation(async (p: { cardHold?: boolean; overrideOnlineChargePence?: number }) => {
      seq += 1;
      return p.cardHold
        ? { ok: true, bookingId: `bk-hold-${seq}`, deposit_amount_pence: null }
        : { ok: true, bookingId: `bk-paid-${seq}`, deposit_amount_pence: p.overrideOnlineChargePence ?? 0 };
    });
    insertFreeMock.mockImplementation(async () => {
      seq += 1;
      return { ok: true, bookingId: `bk-free-${seq}` };
    });
    piCreateMock.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' });
    siCreateMock.mockResolvedValue({ id: 'seti_1', client_secret: 'seti_1_secret' });
    customerCreateMock.mockResolvedValue({ id: 'cus_1' });
    customerDelMock.mockResolvedValue({ deleted: true });
  });

  it('covered-only cart completes immediately with no Stripe objects (unchanged)', async () => {
    membershipCoversMock.mockResolvedValue({ ok: true, mode: 'unlimited', membershipId: 'm1' });
    mockQuote([qLine({ online_charge_pence: 1000, payment_requirement: 'full_payment' })]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.status).toBe('completed');
    expect(insertFreeMock).toHaveBeenCalledTimes(1);
    expect(piCreateMock).not.toHaveBeenCalled();
    expect(siCreateMock).not.toHaveBeenCalled();
    expect(customerCreateMock).not.toHaveBeenCalled();
  });

  it('hold-only cart returns setup mode with a SetupIntent secret and hold rows', async () => {
    mockQuote([qLine({ payment_requirement: 'card_hold', card_hold_fee_pence: 2500 })]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(insertPendingMock).toHaveBeenCalledTimes(1);
    expect(insertPendingMock.mock.calls[0]![0]).toMatchObject({ cardHold: true });
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
    expect(siCreateMock).toHaveBeenCalledTimes(1);
    expect(piCreateMock).not.toHaveBeenCalled();
    expect(persistTxnMock).not.toHaveBeenCalled();

    expect(rec.holdRows).toHaveLength(1);
    expect(rec.holdRows[0]).toMatchObject({
      booking_id: 'bk-hold-1',
      venue_id: 'venue-1',
      stripe_connected_account_id: 'acct_1',
      stripe_customer_id: 'cus_1',
      stripe_setup_intent_id: 'seti_1',
      fee_pence: 2500,
    });
    const snapshot = rec.holdRows[0]!.terms_snapshot as { fee_pence: number; text: string; accepted_at: string | null };
    expect(snapshot.fee_pence).toBe(2500);
    expect(snapshot.text).toContain('Studio One');
    expect(snapshot.accepted_at).toBeNull();

    expect(result.body).toMatchObject({
      status: 'payment_required',
      payment_mode: 'setup',
      client_secret: 'seti_1_secret',
      stripe_account_id: 'acct_1',
      total_amount_pence: 0,
      card_hold_fee_pence: 2500,
    });
    expect(result.body).not.toHaveProperty('payment_intent_id');
    expect(result.body).not.toHaveProperty('checkout_charge_kind');
  });

  it('two card-hold lines with different fees get their own hold rows and fee_pence', async () => {
    mockQuote([
      qLine({ class_instance_id: 'inst-1', payment_requirement: 'card_hold', card_hold_fee_pence: 1500 }),
      qLine({
        class_instance_id: 'inst-2',
        class_type_id: 'ct-2',
        party_size: 2,
        payment_requirement: 'card_hold',
        card_hold_fee_pence: 4000,
      }),
    ]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(insertPendingMock).toHaveBeenCalledTimes(2);
    // One shared customer + SetupIntent across the unit, one hold row per line.
    expect(customerCreateMock).toHaveBeenCalledTimes(1);
    expect(siCreateMock).toHaveBeenCalledTimes(1);
    expect(rec.holdRows).toHaveLength(2);

    const byBooking = new Map(rec.holdRows.map((r) => [r.booking_id, r]));
    expect(byBooking.get('bk-hold-1')).toMatchObject({
      stripe_customer_id: 'cus_1',
      stripe_setup_intent_id: 'seti_1',
      fee_pence: 1500,
    });
    expect(byBooking.get('bk-hold-2')).toMatchObject({
      stripe_customer_id: 'cus_1',
      stripe_setup_intent_id: 'seti_1',
      fee_pence: 4000,
    });
    // The terms snapshot is SHARED and carries the cart-total consent the guest
    // actually saw ("charge up to £55"), while fee_pence stays per line.
    expect((byBooking.get('bk-hold-1')!.terms_snapshot as { fee_pence: number }).fee_pence).toBe(5500);
    expect((byBooking.get('bk-hold-2')!.terms_snapshot as { fee_pence: number }).fee_pence).toBe(5500);

    // The response summarises the cart total.
    expect(result.body).toMatchObject({
      status: 'payment_required',
      payment_mode: 'setup',
      total_amount_pence: 0,
      card_hold_fee_pence: 5500,
    });
  });

  it('covered + hold cart books the covered line immediately and returns setup mode', async () => {
    membershipCoversMock.mockResolvedValue({ ok: true, mode: 'unlimited', membershipId: 'm1' });
    mockQuote([
      qLine({ class_instance_id: 'inst-1', online_charge_pence: 1200, payment_requirement: 'full_payment' }),
      qLine({ class_instance_id: 'inst-2', payment_requirement: 'card_hold', card_hold_fee_pence: 1500 }),
    ]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Covered line keeps today's behaviour: inserted Booked via the free helper.
    expect(insertFreeMock).toHaveBeenCalledTimes(1);
    expect(insertPendingMock).toHaveBeenCalledTimes(1);
    expect(insertPendingMock.mock.calls[0]![0]).toMatchObject({ cardHold: true, classInstanceId: 'inst-2' });
    expect(piCreateMock).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({
      status: 'payment_required',
      payment_mode: 'setup',
      client_secret: 'seti_1_secret',
      total_amount_pence: 0,
      card_hold_fee_pence: 1500,
    });
    if (result.body.status !== 'payment_required') return;
    expect(result.body.booking_ids).toHaveLength(2);
  });

  it('paid + hold cart returns payment_with_setup with the PI id linked to hold lines', async () => {
    mockQuote([
      qLine({
        class_instance_id: 'inst-1',
        online_charge_pence: 1500,
        payment_requirement: 'deposit',
        requires_stripe_checkout: true,
      }),
      qLine({ class_instance_id: 'inst-2', payment_requirement: 'card_hold', card_hold_fee_pence: 2500 }),
    ]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(customerCreateMock).toHaveBeenCalledTimes(1);
    expect(siCreateMock).not.toHaveBeenCalled();
    expect(piCreateMock).toHaveBeenCalledTimes(1);
    const piArgs = piCreateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(piArgs).toMatchObject({
      amount: 1500,
      customer: 'cus_1',
      setup_future_usage: 'off_session',
      payment_method_types: ['card'],
    });
    expect(piArgs).not.toHaveProperty('automatic_payment_methods');

    // The card-hold booking row also stores the unit PI id.
    expect(rec.bookingUpdates).toHaveLength(1);
    expect(rec.bookingUpdates[0]!.patch.stripe_payment_intent_id).toBe('pi_1');
    expect(rec.bookingUpdates[0]!.ids).toEqual(expect.arrayContaining(['bk-paid-1', 'bk-hold-2']));

    // Hold rows are inserted with no SetupIntent (the PI is the linkage).
    expect(rec.holdRows).toHaveLength(1);
    expect(rec.holdRows[0]).toMatchObject({
      booking_id: 'bk-hold-2',
      stripe_setup_intent_id: null,
      stripe_customer_id: 'cus_1',
      fee_pence: 2500,
    });

    // Money audit row covers only the charged lines.
    expect(persistTxnMock).toHaveBeenCalledTimes(1);
    expect(persistTxnMock.mock.calls[0]![1]).toMatchObject({
      amountPence: 1500,
      paidBookingIds: ['bk-paid-1'],
    });

    expect(result.body).toMatchObject({
      status: 'payment_required',
      payment_mode: 'payment_with_setup',
      payment_intent_id: 'pi_1',
      client_secret: 'pi_1_secret',
      total_amount_pence: 1500,
      checkout_charge_kind: 'deposit',
      card_hold_fee_pence: 2500,
    });
  });

  it('paid-only cart keeps the unchanged single-PI path', async () => {
    mockQuote([
      qLine({
        online_charge_pence: 2000,
        payment_requirement: 'full_payment',
        requires_stripe_checkout: true,
      }),
    ]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec), 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(customerCreateMock).not.toHaveBeenCalled();
    const piArgs = piCreateMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(piArgs).toMatchObject({ amount: 2000, automatic_payment_methods: { enabled: true } });
    expect(piArgs).not.toHaveProperty('setup_future_usage');
    expect(rec.holdRows).toHaveLength(0);
    expect(result.body).toMatchObject({
      status: 'payment_required',
      payment_mode: 'payment',
      payment_intent_id: 'pi_1',
      checkout_charge_kind: 'full_payment',
      card_hold_fee_pence: null,
    });
  });

  it('never runs the entitlement engine for a card-hold line, even when the payer opted into credits (D8)', async () => {
    // A hold-only cart with pay_with_class_credits: the card-hold line must be
    // inserted as a hold booking without ever consulting the entitlement
    // engine or the credit balance (credits cannot pay a card-hold line).
    mockQuote([qLine({ payment_requirement: 'card_hold', card_hold_fee_pence: 2500 })]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await orchestrateClassCartCheckout(makeAdmin(rec), {
      venueId: 'venue-1',
      lines: [{ class_instance_id: 'inst-1', party_size: 1 }],
      userId: 'user-1',
      userEmail: 'Guest@Example.com',
      displayName: 'Pat Guest',
      payWithClassCredits: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(decideEntitlementMock).not.toHaveBeenCalled();
    expect(sumCreditsMock).not.toHaveBeenCalled();
    expect(insertPendingMock).toHaveBeenCalledTimes(1);
    expect(insertPendingMock.mock.calls[0]![0]).toMatchObject({ cardHold: true });
    expect(rec.holdRows).toHaveLength(1);
    expect(result.body).toMatchObject({ status: 'payment_required', payment_mode: 'setup' });
  });

  it('runs the entitlement engine only for the money line in a mixed paid + hold cart with credits opted in', async () => {
    mockQuote([
      qLine({
        class_instance_id: 'inst-1',
        online_charge_pence: 1500,
        payment_requirement: 'deposit',
        requires_stripe_checkout: true,
      }),
      qLine({ class_instance_id: 'inst-2', payment_requirement: 'card_hold', card_hold_fee_pence: 2500 }),
    ]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await orchestrateClassCartCheckout(makeAdmin(rec), {
      venueId: 'venue-1',
      lines: [
        { class_instance_id: 'inst-1', party_size: 1 },
        { class_instance_id: 'inst-2', party_size: 1 },
      ],
      userId: 'user-1',
      userEmail: 'Guest@Example.com',
      displayName: 'Pat Guest',
      payWithClassCredits: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Exactly one decision: the money line. The card-hold line bypasses it.
    expect(decideEntitlementMock).toHaveBeenCalledTimes(1);
    expect(decideEntitlementMock.mock.calls[0]![0]).toMatchObject({
      paymentRequirement: 'deposit',
      payWithClassCredits: true,
    });
    // Credit balance was only consulted for the money line.
    expect(sumCreditsMock).toHaveBeenCalledTimes(1);
    expect(sumCreditsMock.mock.calls[0]![1]).toMatchObject({ classTypeId: 'ct-1' });
    // The hold line still lands as a hold booking in the payment_with_setup unit.
    expect(rec.holdRows).toHaveLength(1);
    expect(rec.holdRows[0]).toMatchObject({ booking_id: 'bk-hold-2', fee_pence: 2500 });
    expect(result.body).toMatchObject({ status: 'payment_required', payment_mode: 'payment_with_setup' });
  });

  it('rolls back the group AND deletes the card-hold customer when hold persistence fails', async () => {
    mockQuote([qLine({ payment_requirement: 'card_hold', card_hold_fee_pence: 2500 })]);
    const rec: Recorded = { holdRows: [], bookingUpdates: [], deletes: [] };

    const result = await checkout(makeAdmin(rec, { holdInsertError: true }), 1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(500);
    expect(customerDelMock).toHaveBeenCalledWith('cus_1', { stripeAccount: 'acct_1' });
    expect(rec.deletes).toEqual(
      expect.arrayContaining([
        { table: 'bookings', col: 'group_booking_id', val: expect.any(String) },
        { table: 'class_booking_groups', col: 'id', val: expect.any(String) },
      ]),
    );
  });
});
