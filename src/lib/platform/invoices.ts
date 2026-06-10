import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';

function monthStartUtcFromUnix(unixSeconds: number | null | undefined): string {
  const d = unixSeconds ? new Date(unixSeconds * 1000) : new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Record a paid Stripe subscription invoice in the platform revenue ledger.
 * Idempotent via the UNIQUE constraint on stripe_invoice_id; safe on webhook retries.
 */
export async function recordPlatformInvoice(
  admin: SupabaseClient,
  invoice: Stripe.Invoice,
): Promise<void> {
  const invoiceId = invoice.id;
  if (!invoiceId) return;

  const amountPaid = typeof invoice.amount_paid === 'number' ? invoice.amount_paid : 0;
  if (amountPaid <= 0) return;

  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;

  let venueId: string | null = null;
  if (customerId) {
    const { data: venue, error } = await admin
      .from('venues')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();
    if (error) {
      console.error('[platform-invoices] venue lookup failed:', error.message, { invoiceId });
    }
    venueId = (venue as { id?: string } | null)?.id ?? null;
  }

  const paidAtUnix =
    invoice.status_transitions?.paid_at ?? invoice.created ?? Math.floor(Date.now() / 1000);

  const { error: insertErr } = await admin.from('platform_invoices').insert({
    stripe_invoice_id: invoiceId,
    venue_id: venueId,
    amount_paid_pence: amountPaid,
    currency: invoice.currency ?? 'gbp',
    period_month: monthStartUtcFromUnix(paidAtUnix),
    paid_at: new Date(paidAtUnix * 1000).toISOString(),
  });

  // 23505 = already recorded (webhook retry) — expected, not an error.
  if (insertErr && insertErr.code !== '23505') {
    console.error('[platform-invoices] insert failed:', insertErr.message, { invoiceId });
  }
}
