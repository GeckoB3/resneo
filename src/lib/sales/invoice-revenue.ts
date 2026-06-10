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
    updates.first_paid_at = now;
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
