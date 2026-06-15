import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

function periodMonthFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Record paid subscription revenue for a salesperson-attributed venue.
 * Marks attribution active on first paid invoice. Idempotent on stripe_invoice_id.
 */
export async function recordSalesInvoiceRevenue(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  if (!invoice.customer) return;
  const amountPaid = invoice.amount_paid ?? 0;
  if (amountPaid <= 0) return;

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer.id;

  const { data: venue, error: venueErr } = await admin
    .from('venues')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (venueErr || !venue?.id) return;

  const { data: attribution, error: attrErr } = await admin
    .from('sales_attributions')
    .select('id, salesperson_id, first_paid_at, status')
    .eq('venue_id', venue.id)
    .maybeSingle();
  if (attrErr || !attribution?.id) return;

  const periodStart = invoice.period_start ?? invoice.created;
  const periodMonth = periodMonthFromUnix(periodStart);
  if (!periodMonth) return;

  const stripeInvoiceId = invoice.id;
  if (!stripeInvoiceId) return;

  const { error: revErr } = await admin.from('sales_invoice_revenue').upsert(
    {
      attribution_id: attribution.id,
      venue_id: venue.id,
      period_month: periodMonth,
      amount_paid_pence: amountPaid,
      stripe_invoice_id: stripeInvoiceId,
    },
    { onConflict: 'stripe_invoice_id', ignoreDuplicates: true },
  );
  if (revErr) {
    console.error('[sales/invoice-revenue] upsert failed', {
      venueId: venue.id,
      invoiceId: stripeInvoiceId,
      error: revErr.message,
    });
    return;
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    status: 'active',
    updated_at: now,
  };
  if (!attribution.first_paid_at) {
    // Stamp the actual invoice-paid time (not processing time) so the lump-sum month and
    // revenue-share window are bucketed correctly even if the webhook is delayed/retried.
    const paidAtSeconds = invoice.status_transitions?.paid_at ?? invoice.created ?? null;
    updates.first_paid_at = paidAtSeconds ? new Date(paidAtSeconds * 1000).toISOString() : now;
  }

  const { error: updErr } = await admin
    .from('sales_attributions')
    .update(updates)
    .eq('id', attribution.id);
  if (updErr) {
    console.error('[sales/invoice-revenue] attribution update failed', {
      attributionId: attribution.id,
      error: updErr.message,
    });
  }
}

/**
 * Net a refund/credit out of a salesperson's revenue share. Writes a NEGATIVE adjustment row
 * against the ORIGINAL invoice's attribution + period_month, so the monthly statement's
 * revenue-share base reflects money returned to the customer (the cron reconciles the original
 * month). Idempotent: keyed on a stable `adjustmentKey`; an upsert refreshes the amount, so a
 * growing cumulative refund stays correct without double-counting. No-op when the invoice was
 * never recorded as salesperson revenue.
 */
export async function recordSalesRevenueAdjustment(
  admin: SupabaseClient,
  params: { stripeInvoiceId: string; adjustmentKey: string; netNegativePence: number },
): Promise<void> {
  const { stripeInvoiceId, adjustmentKey, netNegativePence } = params;
  if (!stripeInvoiceId || !adjustmentKey || !(netNegativePence > 0)) return;

  const { data: original, error } = await admin
    .from('sales_invoice_revenue')
    .select('attribution_id, venue_id, period_month')
    .eq('stripe_invoice_id', stripeInvoiceId)
    .maybeSingle();
  if (error || !original) return;

  const row = original as { attribution_id: string; venue_id: string; period_month: string };
  const { error: upErr } = await admin.from('sales_invoice_revenue').upsert(
    {
      attribution_id: row.attribution_id,
      venue_id: row.venue_id,
      period_month: row.period_month,
      amount_paid_pence: -Math.round(netNegativePence),
      stripe_invoice_id: adjustmentKey,
    },
    { onConflict: 'stripe_invoice_id' },
  );
  if (upErr) {
    console.error('[sales/invoice-revenue] adjustment upsert failed', {
      stripeInvoiceId,
      adjustmentKey,
      error: upErr.message,
    });
  }
}

/**
 * On `charge.refunded`, net the charge's CUMULATIVE refunded amount out of the salesperson's
 * revenue share for the refunded invoice's original month. One adjustment row per charge (keyed
 * on the charge id), so partial/repeated refunds stay correct and idempotent. Refunds issued via
 * credit notes also increment `amount_refunded`, so they are covered here without double-counting.
 */
export async function recordSalesRevenueRefund(admin: SupabaseClient, charge: Stripe.Charge): Promise<void> {
  // `Charge.invoice` is present on the API payload but absent from the pinned Stripe types.
  const rawInvoice = (charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null;
  const invoiceId = typeof rawInvoice === 'string' ? rawInvoice : rawInvoice?.id ?? null;
  const refunded = charge.amount_refunded ?? 0;
  if (!invoiceId || refunded <= 0) return;
  await recordSalesRevenueAdjustment(admin, {
    stripeInvoiceId: invoiceId,
    adjustmentKey: `refund:${charge.id}`,
    netNegativePence: refunded,
  });
}
