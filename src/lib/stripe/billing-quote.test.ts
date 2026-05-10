import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import {
  buildVenueBillingQuotePayload,
  collectCouponTitles,
  collectCouponTitlesFromInvoice,
  collectSubscriptionDiscountSummaries,
  deepCollectCouponNamesFromStripePayload,
  enrichVenueBillingQuoteCouponTitles,
} from '@/lib/stripe/billing-quote';

describe('collectSubscriptionDiscountSummaries', () => {
  it('reads legacy single discount.coupon', () => {
    const sub = {
      discount: {
        end: null,
        coupon: {
          id: 'cpn_1',
          object: 'coupon',
          deleted: false,
          name: 'Launch offer',
          percent_off: 50,
          duration: 'repeating',
          duration_in_months: 6,
        },
      },
    } as unknown as Stripe.Subscription;

    expect(collectSubscriptionDiscountSummaries(sub)).toEqual([
      'Launch offer: 50% off · 6 months',
    ]);
  });

  it('reads discounts array', () => {
    const sub = {
      discounts: [
        {
          end: null,
          source: {
            type: 'coupon',
            coupon: {
              id: 'cpn_2',
              object: 'coupon',
              deleted: false,
              name: 'Manual',
              percent_off: 25,
              duration: 'forever',
            },
          },
        },
      ],
    } as unknown as Stripe.Subscription;

    const lines = collectSubscriptionDiscountSummaries(sub);
    expect(lines).toEqual(['Manual: 25% off · ongoing']);
  });
});

describe('collectCouponTitles', () => {
  it('returns coupon names', () => {
    const sub = {
      discounts: [
        {
          end: null,
          source: {
            type: 'coupon',
            coupon: {
              id: 'cpn_x',
              object: 'coupon',
              deleted: false,
              name: 'Pilot 2026',
              percent_off: 10,
              duration: 'forever',
            },
          },
        },
      ],
    } as unknown as Stripe.Subscription;
    expect(collectCouponTitles(sub)).toEqual(['Pilot 2026']);
  });

  it('uses promotion code when customer redeemed a promo code', () => {
    const sub = {
      discounts: [
        {
          end: null,
          source: {
            type: 'coupon',
            coupon: {
              id: 'cpn_y',
              object: 'coupon',
              deleted: false,
              name: 'Internal',
              percent_off: 10,
              duration: 'forever',
            },
          },
          promotion_code: {
            id: 'promo_1',
            object: 'promotion_code',
            active: true,
            code: 'SAVE10',
          },
        },
      ],
    } as unknown as Stripe.Subscription;
    expect(collectCouponTitles(sub)).toEqual(['Internal']);
  });

  it('falls back to promo code label when coupon object has no display name', () => {
    const sub = {
      discounts: [
        {
          end: null,
          promotion_code: {
            id: 'promo_1',
            object: 'promotion_code',
            active: true,
            code: 'EARLYBIRD',
          },
        },
      ],
    } as unknown as Stripe.Subscription;
    expect(collectCouponTitles(sub)).toEqual(['EARLYBIRD']);
  });
});

describe('deepCollectCouponNamesFromStripePayload', () => {
  it('finds coupon.name anywhere in nested Stripe-like JSON', () => {
    const payload = {
      lines: {
        data: [
          {
            period: { foo: { nested: { object: 'coupon', name: '50% off for 6 months', percent_off: 50 } } },
          },
        ],
      },
    };
    const out = new Set<string>();
    deepCollectCouponNamesFromStripePayload(payload, out);
    expect([...out]).toEqual(['50% off for 6 months']);
  });
});

describe('enrichVenueBillingQuoteCouponTitles', () => {
  it('extracts coupon title from deeply nested invoice JSON (portal-visible shape)', async () => {
    const mockStripe = { coupons: { retrieve: vi.fn() } } as unknown as Stripe;
    const sub = {} as Stripe.Subscription;
    const invoice = {
      currency: 'gbp',
      amount_due: 3950,
      subtotal: 7900,
      total_discount_amounts: [{ amount: 3950 }],
      lines: {
        data: [{ parent: { details: { object: 'coupon', name: '50% off for 6 months' } } }],
      },
    } as unknown as Stripe.Invoice;
    let quote = buildVenueBillingQuotePayload(sub, invoice);
    quote = await enrichVenueBillingQuoteCouponTitles(mockStripe, sub, quote, invoice);
    expect(quote.coupon_titles).toContain('50% off for 6 months');
  });

  it('hydrates coupon name when Stripe uses a custom coupon id (not cou_*)', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: 'zUyJGiBs',
      object: 'coupon',
      name: '50% off for 6 months',
      percent_off: 50,
      duration: 'repeating',
      duration_in_months: 6,
    });
    const mockStripe = { coupons: { retrieve } } as unknown as Stripe;

    const sub = {} as Stripe.Subscription;
    const invoice = {
      currency: 'gbp',
      amount_due: 3950,
      total_discount_amounts: [
        {
          amount: 3950,
          discount: {
            object: 'discount',
            id: 'di_test',
            coupon: 'zUyJGiBs',
          },
        },
      ],
    } as unknown as Stripe.Invoice;

    let quote = buildVenueBillingQuotePayload(sub, invoice);
    quote = await enrichVenueBillingQuoteCouponTitles(mockStripe, sub, quote, invoice);

    expect(retrieve).toHaveBeenCalledWith('zUyJGiBs');
    expect(quote.coupon_titles).toContain('50% off for 6 months');
  });

  it('hydrates coupon name by retrieving raw discount ids from invoice previews', async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      id: 'di_test',
      object: 'discount',
      coupon: {
        id: 'zUyJGiBs',
        object: 'coupon',
        name: '50% off for 6 months',
        percent_off: 50,
        duration: 'repeating',
        duration_in_months: 6,
      },
    });
    const mockStripe = { coupons: { retrieve: vi.fn() }, rawRequest } as unknown as Stripe;
    const sub = {} as Stripe.Subscription;
    const invoice = {
      currency: 'gbp',
      amount_due: 3950,
      total_discount_amounts: [{ amount: 3950, discount: 'di_test' }],
    } as unknown as Stripe.Invoice;

    let quote = buildVenueBillingQuotePayload(sub, invoice);
    quote = await enrichVenueBillingQuoteCouponTitles(mockStripe, sub, quote, invoice);

    expect(rawRequest).toHaveBeenCalledWith('GET', '/v1/discounts/di_test', {
      expand: ['coupon', 'promotion_code'],
    });
    expect(quote.coupon_titles).toContain('50% off for 6 months');
  });

  it('hydrates coupon name from subscription item discounts', async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: 'si_test',
      object: 'subscription_item',
      discounts: [
        {
          id: 'di_item',
          object: 'discount',
          source: {
            type: 'coupon',
            coupon: {
              id: 'zUyJGiBs',
              object: 'coupon',
              name: '50% off for 6 months',
              percent_off: 50,
              duration: 'repeating',
              duration_in_months: 6,
            },
          },
        },
      ],
    });
    const mockStripe = {
      coupons: { retrieve: vi.fn() },
      subscriptionItems: { retrieve },
    } as unknown as Stripe;
    const sub = {
      items: { data: [{ id: 'si_test' }] },
    } as unknown as Stripe.Subscription;
    const invoice = {
      currency: 'gbp',
      amount_due: 3950,
      total_discount_amounts: [{ amount: 3950 }],
    } as unknown as Stripe.Invoice;

    let quote = buildVenueBillingQuotePayload(sub, invoice);
    quote = await enrichVenueBillingQuoteCouponTitles(mockStripe, sub, quote, invoice);

    expect(retrieve).toHaveBeenCalledWith('si_test', {
      expand: ['discounts', 'discounts.source.coupon', 'discounts.promotion_code'],
    });
    expect(quote.coupon_titles).toContain('50% off for 6 months');
  });
});

describe('collectCouponTitlesFromInvoice', () => {
  it('reads coupon name from invoice total_discount_amounts.discount', () => {
    const invoice = {
      total_discount_amounts: [
        {
          amount: 3950,
          discount: {
            object: 'discount',
            id: 'di_xxx',
            source: {
              type: 'coupon',
              coupon: {
                id: 'cou_xxx',
                object: 'coupon',
                name: '50% off for 6 months',
                percent_off: 50,
                duration: 'repeating',
                duration_in_months: 6,
              },
            },
          },
        },
      ],
    } as unknown as Stripe.Invoice;

    expect(collectCouponTitlesFromInvoice(invoice)).toEqual(['50% off for 6 months']);
  });
});

describe('buildVenueBillingQuotePayload', () => {
  it('maps upcoming invoice totals', () => {
    const sub = {} as Stripe.Subscription;
    const upcoming = {
      currency: 'gbp',
      amount_due: 2500,
      subtotal: 5000,
      total_discount_amounts: [{ amount: 2500, discount: 'di_1' }],
    } as unknown as Stripe.Invoice;

    const q = buildVenueBillingQuotePayload(sub, upcoming);
    expect(q.next_charge?.amount_pence).toBe(2500);
    expect(q.next_charge?.formatted).toMatch(/£25/);
    expect(q.invoice_subtotal?.amount_pence).toBe(5000);
    expect(q.invoice_discount_total?.amount_pence).toBe(2500);
    expect(q.coupon_titles).toEqual([]);
  });

  it('includes coupon titles from invoice preview when subscription has none', () => {
    const sub = {} as Stripe.Subscription;
    const upcoming = {
      currency: 'gbp',
      amount_due: 3950,
      subtotal: 7900,
      total_discount_amounts: [
        {
          amount: 3950,
          discount: {
            object: 'discount',
            source: {
              type: 'coupon',
              coupon: {
                id: 'cou_1',
                object: 'coupon',
                name: '50% off for 6 months',
                percent_off: 50,
                duration: 'repeating',
                duration_in_months: 6,
              },
            },
          },
        },
      ],
    } as unknown as Stripe.Invoice;

    const q = buildVenueBillingQuotePayload(sub, upcoming);
    expect(q.coupon_titles).toEqual(['50% off for 6 months']);
  });

  it('returns null monetary fields when no invoice', () => {
    const sub = {} as Stripe.Subscription;
    const q = buildVenueBillingQuotePayload(sub, null);
    expect(q.next_charge).toBeNull();
    expect(q.invoice_subtotal).toBeNull();
    expect(q.invoice_discount_total).toBeNull();
    expect(q.coupon_titles).toEqual([]);
  });
});
