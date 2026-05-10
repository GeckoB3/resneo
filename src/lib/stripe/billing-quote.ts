/**
 * Build dashboard-facing billing summaries from Stripe Subscription + upcoming Invoice.
 * Keeps formatting aligned with other Stripe money payloads (en-GB, minor units).
 */

import type Stripe from 'stripe';

export type StripeMoneyPayload = {
  amount_pence: number;
  currency: string;
  formatted: string;
};

export type VenueBillingQuotePayload = {
  next_charge: StripeMoneyPayload | null;
  invoice_subtotal: StripeMoneyPayload | null;
  invoice_discount_total: StripeMoneyPayload | null;
  discount_summaries: string[];
  /** Stripe coupon.name (or id fallback), deduped — shown beside published listing. */
  coupon_titles: string[];
};

function mergeDedupeTitles(...groups: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const t of g) {
      const s = t.trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function formatStripeMoney(amountMinor: number, currency: string): StripeMoneyPayload {
  const cur = currency.trim().toLowerCase() || 'gbp';
  return {
    amount_pence: amountMinor,
    currency: cur,
    formatted: new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: cur.toUpperCase(),
    }).format(amountMinor / 100),
  };
}

function formatCouponAmountOff(amountOff: number, currency: string): string {
  return formatStripeMoney(amountOff, currency).formatted;
}

function formatDiscountEnd(endUnix: number | null | undefined): string | null {
  if (typeof endUnix !== 'number') return null;
  const d = new Date(endUnix * 1000);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function describeCouponAndWindow(
  coupon: Stripe.Coupon | Stripe.DeletedCoupon,
  discountEndUnix: number | null | undefined,
): string | null {
  if (!coupon || coupon.deleted) return null;

  const title = couponDisplayTitle(coupon) ?? coupon.id;
  const bits: string[] = [];

  if (coupon.percent_off != null) {
    bits.push(`${coupon.percent_off}% off`);
  } else if (coupon.amount_off != null && coupon.currency) {
    bits.push(`${formatCouponAmountOff(coupon.amount_off, coupon.currency)} off`);
  }

  if (coupon.duration === 'repeating' && typeof coupon.duration_in_months === 'number') {
    bits.push(`${coupon.duration_in_months} months`);
  } else if (coupon.duration === 'once') {
    bits.push('first invoice only');
  } else if (coupon.duration === 'forever') {
    bits.push('ongoing');
  }

  const endLabel = formatDiscountEnd(discountEndUnix);
  if (endLabel) {
    bits.push(`until ${endLabel}`);
  }

  if (bits.length === 0) return title;
  return `${title}: ${bits.join(' · ')}`;
}

type ExpandedDiscount = {
  coupon?: Stripe.Coupon | Stripe.DeletedCoupon | string;
  promotion_code?: Stripe.PromotionCode | string;
  source?: { coupon?: Stripe.Coupon | Stripe.DeletedCoupon | string | null; type?: string };
  end?: number | null;
};

function couponFromDiscount(discount: ExpandedDiscount): Stripe.Coupon | Stripe.DeletedCoupon | string | null | undefined {
  return discount.coupon ?? discount.source?.coupon;
}

/**
 * Discount-shaped rows attached to an upcoming invoice (preview often has coupons here when subscription omits names).
 */
function iterateInvoiceDiscountObjects(invoice: Stripe.Invoice): ExpandedDiscount[] {
  const results: ExpandedDiscount[] = [];
  const pushIfDiscount = (d: unknown) => {
    if (typeof d === 'object' && d !== null && ('coupon' in d || 'promotion_code' in d || 'source' in d)) {
      results.push(d as ExpandedDiscount);
    }
  };

  const inv = invoice as unknown as {
    discounts?: unknown;
    discount?: unknown;
    total_discount_amounts?: unknown;
    lines?: { data?: unknown[] };
  };

  if (Array.isArray(inv.discounts)) {
    for (const d of inv.discounts) {
      if (typeof d === 'string') continue;
      pushIfDiscount(d);
    }
  }

  if (inv.discount && typeof inv.discount === 'object') {
    pushIfDiscount(inv.discount);
  }

  if (Array.isArray(inv.total_discount_amounts)) {
    for (const row of inv.total_discount_amounts) {
      if (row && typeof row === 'object' && 'discount' in row) {
        const inner = (row as { discount?: unknown }).discount;
        if (typeof inner === 'string') continue;
        pushIfDiscount(inner);
      }
    }
  }

  const lines = inv.lines?.data;
  if (Array.isArray(lines)) {
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      const lineDiscounts = (line as { discounts?: unknown }).discounts;
      if (Array.isArray(lineDiscounts)) {
        for (const d of lineDiscounts) {
          if (typeof d === 'string') continue;
          pushIfDiscount(d);
        }
      }
      const das = (line as { discount_amounts?: unknown }).discount_amounts;
      if (!Array.isArray(das)) continue;
      for (const da of das) {
        if (da && typeof da === 'object' && 'discount' in da) {
          const inner = (da as { discount?: unknown }).discount;
          if (typeof inner === 'string') continue;
          pushIfDiscount(inner);
        }
      }
    }
  }

  return results;
}

function titlesFromDiscountEntries(discounts: ExpandedDiscount[]): string[] {
  const titles: string[] = [];
  const seen = new Set<string>();
  for (const d of discounts) {
    let added = false;
    const coupon = couponFromDiscount(d);
    if (coupon && typeof coupon !== 'string') {
      const t = couponDisplayTitle(coupon);
      if (t && !seen.has(t)) {
        seen.add(t);
        titles.push(t);
        added = true;
      }
    }
    if (!added) {
      const pcLabel = promotionCodeLabel(d.promotion_code);
      if (pcLabel && !seen.has(pcLabel)) {
        seen.add(pcLabel);
        titles.push(pcLabel);
      }
    }
  }
  return titles;
}

export function collectCouponTitlesFromInvoice(invoice: Stripe.Invoice): string[] {
  return titlesFromDiscountEntries(iterateInvoiceDiscountObjects(invoice));
}

/**
 * Coupon IDs to resolve via Coupons API. Stripe allows custom IDs (e.g. `zUyJGiBs`), not only `cou_*`.
 */
function collectCouponIdsFromDiscountEntries(discounts: ExpandedDiscount[]): string[] {
  const ids: string[] = [];
  for (const d of discounts) {
    const sourceCoupon = couponFromDiscount(d);
    if (typeof sourceCoupon === 'string') {
      const trimmed = sourceCoupon.trim();
      if (trimmed.length > 0) ids.push(trimmed);
    }
  }
  return [...new Set(ids)];
}

function collectDiscountIdsFromUnknown(root: unknown): string[] {
  const ids: string[] = [];
  const seenObjects = new WeakSet<object>();
  const seenIds = new Set<string>();
  const stack: unknown[] = [root];
  let nodes = 0;
  const addId = (value: unknown) => {
    if (typeof value !== 'string') return;
    const id = value.trim();
    if (!id.startsWith('di_') || seenIds.has(id)) return;
    seenIds.add(id);
    ids.push(id);
  };

  while (stack.length > 0 && nodes < DEEP_WALK_MAX_NODES) {
    const cur = stack.pop();
    nodes += 1;
    addId(cur);
    if (!cur || typeof cur !== 'object') continue;
    if (seenObjects.has(cur as object)) continue;
    seenObjects.add(cur as object);

    if (Array.isArray(cur)) {
      for (const value of cur) stack.push(value);
      continue;
    }

    const o = cur as Record<string, unknown>;
    if (o.object === 'discount' && typeof o.id === 'string' && o.id.trim()) {
      addId(o.id);
    }
    for (const value of Object.values(o)) {
      addId(value);
      stack.push(value);
    }
  }

  return ids;
}

/**
 * Discount rows from Subscription or Customer (Stripe may attach coupons to the customer, not the subscription).
 */
function discountObjectsFromResource(resource: { discounts?: unknown; discount?: unknown } | null | undefined): ExpandedDiscount[] {
  if (!resource) return [];

  const fromList = resource.discounts;
  if (Array.isArray(fromList)) {
    const out: ExpandedDiscount[] = [];
    for (const d of fromList) {
      if (typeof d === 'object' && d !== null && ('coupon' in d || 'promotion_code' in d || 'source' in d)) {
        out.push(d as ExpandedDiscount);
      }
    }
    return out;
  }
  if (fromList && typeof fromList === 'object' && 'data' in fromList) {
    const data = (fromList as { data?: unknown }).data;
    if (Array.isArray(data)) {
      const out: ExpandedDiscount[] = [];
      for (const d of data) {
        if (typeof d === 'object' && d !== null && ('coupon' in d || 'promotion_code' in d || 'source' in d)) {
          out.push(d as ExpandedDiscount);
        }
      }
      return out;
    }
  }

  const legacy = resource.discount;
  if (legacy && typeof legacy === 'object' && legacy !== null && ('coupon' in legacy || 'promotion_code' in legacy || 'source' in legacy)) {
    return [legacy as ExpandedDiscount];
  }

  return [];
}

function discountObjectsFromSubscription(subscription: Stripe.Subscription): ExpandedDiscount[] {
  const discounts = discountObjectsFromResource(subscription as { discounts?: unknown; discount?: unknown });
  const items = (subscription as unknown as { items?: { data?: unknown[] } }).items?.data;
  if (!Array.isArray(items)) return discounts;

  for (const item of items) {
    discounts.push(...discountObjectsFromResource(item as { discounts?: unknown; discount?: unknown }));
  }

  return discounts;
}

function discountObjectsFromCustomer(customer: Stripe.Customer): ExpandedDiscount[] {
  return discountObjectsFromResource(customer as { discounts?: unknown; discount?: unknown });
}

function couponDisplayTitle(coupon: Stripe.Coupon | Stripe.DeletedCoupon): string | null {
  if (!coupon || coupon.deleted) return null;
  return (coupon.name?.trim() || coupon.id).trim();
}

/**
 * Short titles from attached coupons (Stripe Dashboard name or coupon id).
 */
function promotionCodeLabel(pc: Stripe.PromotionCode | string | undefined): string | null {
  if (!pc || typeof pc === 'string') return null;
  const code = pc.code?.trim();
  if (code) return code;
  if (typeof pc.id === 'string' && pc.id.startsWith('promo_')) return pc.id;
  return null;
}

export function collectCouponTitles(subscription: Stripe.Subscription): string[] {
  return titlesFromDiscountEntries(discountObjectsFromSubscription(subscription));
}

function collectCouponIdsForHydration(subscription: Stripe.Subscription): string[] {
  return collectCouponIdsFromDiscountEntries(discountObjectsFromSubscription(subscription));
}

function subscriptionItemIds(subscription: Stripe.Subscription): string[] {
  const items = (subscription as unknown as { items?: { data?: unknown[] } }).items?.data;
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) ids.push(id.trim());
  }
  return [...new Set(ids)];
}

function collectCouponIdsForHydrationFromCustomer(customer: Stripe.Customer): string[] {
  return collectCouponIdsFromDiscountEntries(discountObjectsFromCustomer(customer));
}

export function collectCouponTitlesFromCustomer(customer: Stripe.Customer): string[] {
  return titlesFromDiscountEntries(discountObjectsFromCustomer(customer));
}

function subscriptionDiscountsLookLikeBareIds(subscription: Stripe.Subscription): boolean {
  const raw = subscription as unknown as { discounts?: unknown };
  if (!Array.isArray(raw.discounts) || raw.discounts.length === 0) return false;
  return raw.discounts.every((x) => typeof x === 'string');
}

/**
 * Resolve coupon names when Stripe returns only coupon IDs, re-expand bare discount IDs,
 * and hydrate coupon metadata via the Coupons API when needed.
 */
async function hydrateCouponIdsForStripe(
  stripe: Stripe,
  ids: Iterable<string>,
  addTitle: (t: string | null | undefined) => void,
): Promise<void> {
  for (const id of ids) {
    try {
      const c = await stripe.coupons.retrieve(id);
      addTitle(couponDisplayTitle(c) ?? c.id);
    } catch (e) {
      console.warn('[billing-quote] coupons.retrieve failed', { couponId: id, e });
    }
  }
}

async function hydrateDiscountIdsForStripe(
  stripe: Stripe,
  ids: Iterable<string>,
  addTitle: (t: string | null | undefined) => void,
): Promise<void> {
  const rawRequest = (stripe as Stripe & { rawRequest?: Stripe['rawRequest'] }).rawRequest;
  if (typeof rawRequest !== 'function') return;

  for (const id of ids) {
    try {
      const response = await rawRequest.call(stripe, 'GET', `/v1/discounts/${encodeURIComponent(id)}`, {
        expand: ['coupon', 'promotion_code'],
      });
      const discount = response as unknown as { coupon?: unknown; promotion_code?: unknown };
      const sourceCoupon = couponFromDiscount(discount as ExpandedDiscount);
      if (sourceCoupon && typeof sourceCoupon === 'object') {
        addTitle(couponDisplayTitle(sourceCoupon));
      }
      if (discount.promotion_code && typeof discount.promotion_code === 'object') {
        addTitle(promotionCodeLabel(discount.promotion_code as Stripe.PromotionCode));
      }
    } catch (e) {
      console.warn('[billing-quote] discounts.retrieve raw request failed', { discountId: id, e });
    }
  }
}

async function hydrateSubscriptionItemDiscountsForStripe(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  addTitle: (t: string | null | undefined) => void,
): Promise<void> {
  for (const itemId of subscriptionItemIds(subscription)) {
    try {
      const item = await stripe.subscriptionItems.retrieve(itemId, {
        expand: ['discounts', 'discounts.source.coupon', 'discounts.promotion_code'],
      });
      for (const t of titlesFromDiscountEntries(discountObjectsFromResource(item as { discounts?: unknown; discount?: unknown }))) {
        addTitle(t);
      }
      await hydrateCouponIdsForStripe(
        stripe,
        collectCouponIdsFromDiscountEntries(discountObjectsFromResource(item as { discounts?: unknown; discount?: unknown })),
        addTitle,
      );
    } catch (e) {
      console.warn('[billing-quote] subscription item discount expand failed', { itemId, e });
    }
  }
}

const DEEP_WALK_MAX_NODES = 8000;

/**
 * Stripe nests Coupon objects under varying keys (invoice lines, phases, API versions).
 * Customer Portal reads the same JSON — this matches any `{ object: 'coupon', name }` in payloads we already fetched.
 */
export function deepCollectCouponNamesFromStripePayload(root: unknown, out: Set<string>): void {
  const stack: unknown[] = [root];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (stack.length > 0 && nodes < DEEP_WALK_MAX_NODES) {
    const cur = stack.pop();
    nodes += 1;
    if (cur === null || cur === undefined) continue;
    if (typeof cur !== 'object') continue;

    if (seen.has(cur as object)) continue;
    seen.add(cur as object);

    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
      continue;
    }

    const o = cur as Record<string, unknown>;
    if (o.object === 'coupon') {
      const name = o.name;
      if (typeof name === 'string') {
        const t = name.trim();
        if (t.length > 0) out.add(t);
      }
    }

    for (const k of Object.keys(o)) {
      stack.push(o[k]);
    }
  }
}

export async function enrichVenueBillingQuoteCouponTitles(
  stripe: Stripe,
  subscription: Stripe.Subscription,
  quote: VenueBillingQuotePayload,
  upcomingInvoice?: Stripe.Invoice | null,
  stripeCustomerId?: string | null,
): Promise<VenueBillingQuotePayload> {
  let sub = subscription;
  let working = quote;
  let customerExpandedForDeep: Stripe.Customer | null = null;

  if (subscriptionDiscountsLookLikeBareIds(sub) && sub.id) {
    try {
      sub = await stripe.subscriptions.retrieve(sub.id, {
        expand: ['discounts', 'discounts.source.coupon', 'discounts.promotion_code'],
      });
      working = {
        ...working,
        discount_summaries: collectSubscriptionDiscountSummaries(sub),
        coupon_titles: collectCouponTitles(sub),
      };
    } catch (e) {
      console.warn('[billing-quote] subscription discount re-expand failed', { subId: sub.id, e });
    }
  }

  const titles = [...(working.coupon_titles ?? [])];
  const seen = new Set(titles);

  const addTitle = (t: string | null | undefined) => {
    const s = t?.trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    titles.push(s);
  };

  if (upcomingInvoice) {
    for (const t of collectCouponTitlesFromInvoice(upcomingInvoice)) {
      addTitle(t);
    }
  }

  const couponIdsToHydrate = new Set<string>([
    ...collectCouponIdsForHydration(sub),
    ...(upcomingInvoice
      ? collectCouponIdsFromDiscountEntries(iterateInvoiceDiscountObjects(upcomingInvoice))
      : []),
  ]);

  await hydrateCouponIdsForStripe(stripe, couponIdsToHydrate, addTitle);
  await hydrateSubscriptionItemDiscountsForStripe(stripe, sub, addTitle);
  await hydrateDiscountIdsForStripe(
    stripe,
    [
      ...collectDiscountIdsFromUnknown(sub),
      ...(upcomingInvoice ? collectDiscountIdsFromUnknown(upcomingInvoice) : []),
    ],
    addTitle,
  );

  /** Subscription payload sometimes omits expanded discounts; always try a full expand when names are still missing. */
  if (titles.length === 0 && sub.id) {
    try {
      const expandedSub = await stripe.subscriptions.retrieve(sub.id, {
        expand: ['discounts', 'discounts.source.coupon', 'discounts.promotion_code'],
      });
      for (const t of collectCouponTitles(expandedSub)) {
        addTitle(t);
      }
      await hydrateCouponIdsForStripe(
        stripe,
        collectCouponIdsForHydration(expandedSub),
        addTitle,
      );
      await hydrateSubscriptionItemDiscountsForStripe(stripe, expandedSub, addTitle);
      await hydrateDiscountIdsForStripe(stripe, collectDiscountIdsFromUnknown(expandedSub), addTitle);
      const summaries = collectSubscriptionDiscountSummaries(expandedSub);
      if (summaries.length > 0) {
        working = { ...working, discount_summaries: summaries };
      }
    } catch (e) {
      console.warn('[billing-quote] subscription catch-all discount expand failed', { subId: sub.id, e });
    }
  }

  /** Coupons may be attached to the Customer instead of (or as well as) the Subscription. */
  const cid = stripeCustomerId?.trim() ?? '';
  if (titles.length === 0 && cid) {
    try {
      const customer = await stripe.customers.retrieve(cid, {
        expand: ['discounts', 'discounts.source.coupon', 'discounts.promotion_code'],
      });
      if (!customer.deleted && typeof customer !== 'string') {
        customerExpandedForDeep = customer as Stripe.Customer;
        for (const t of collectCouponTitlesFromCustomer(customer)) {
          addTitle(t);
        }
        await hydrateCouponIdsForStripe(
          stripe,
          collectCouponIdsForHydrationFromCustomer(customer),
          addTitle,
        );
        await hydrateDiscountIdsForStripe(stripe, collectDiscountIdsFromUnknown(customer), addTitle);
      }
    } catch (e) {
      console.warn('[billing-quote] customer discount expand failed', { customerId: cid, e });
    }
  }

  /** Last resort: walk full Stripe JSON (same objects Portal uses) for embedded coupon.name */
  const deepNames = new Set<string>();
  deepCollectCouponNamesFromStripePayload(sub, deepNames);
  if (upcomingInvoice) deepCollectCouponNamesFromStripePayload(upcomingInvoice, deepNames);
  if (customerExpandedForDeep) deepCollectCouponNamesFromStripePayload(customerExpandedForDeep, deepNames);
  for (const n of deepNames) {
    addTitle(n);
  }

  if (titles.length > 0) {
    return { ...working, coupon_titles: titles };
  }

  return working;
}

/**
 * Human-readable discount lines from subscription discounts (checkout or Dashboard-applied).
 */
export function collectSubscriptionDiscountSummaries(subscription: Stripe.Subscription): string[] {
  const discounts = discountObjectsFromSubscription(subscription);
  const lines: string[] = [];

  for (const d of discounts) {
    const coupon = couponFromDiscount(d);
    if (!coupon || typeof coupon === 'string') continue;
    const line = describeCouponAndWindow(coupon, d.end ?? null);
    if (line) lines.push(line);
  }

  return lines;
}

export function buildVenueBillingQuotePayload(
  subscription: Stripe.Subscription,
  upcomingInvoice: Stripe.Invoice | null,
): VenueBillingQuotePayload {
  const discount_summaries = collectSubscriptionDiscountSummaries(subscription);
  const coupon_titles = mergeDedupeTitles(
    collectCouponTitles(subscription),
    upcomingInvoice ? collectCouponTitlesFromInvoice(upcomingInvoice) : [],
  );

  if (!upcomingInvoice) {
    return {
      next_charge: null,
      invoice_subtotal: null,
      invoice_discount_total: null,
      discount_summaries,
      coupon_titles,
    };
  }

  const currency = upcomingInvoice.currency ?? 'gbp';
  const amountDue = upcomingInvoice.amount_due ?? 0;
  const subtotal = upcomingInvoice.subtotal ?? 0;
  const discountParts = upcomingInvoice.total_discount_amounts ?? [];
  const discountSum = discountParts.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  return {
    next_charge: formatStripeMoney(amountDue, currency),
    invoice_subtotal: subtotal > 0 ? formatStripeMoney(subtotal, currency) : null,
    invoice_discount_total: discountSum > 0 ? formatStripeMoney(discountSum, currency) : null,
    discount_summaries,
    coupon_titles,
  };
}
