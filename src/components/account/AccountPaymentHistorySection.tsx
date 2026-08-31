import Link from 'next/link';
import { formatPence } from '@/lib/booking/payment-display';
import type { AccountPaymentRow } from '@/lib/account/account-payments';
import type { AccountVenueRow } from '@/lib/account/account-bookings';

/**
 * What the customer has paid (P4-2).
 *
 * Server-rendered from the same projection the API returns, rather than
 * fetched by the browser: this is a financial record, and there is no reason
 * for it to arrive a second later than the rest of the page.
 *
 * **Deliberately not called a receipt.** These rows are the in-person
 * settlement ledger plus deposits taken online; a venue's own VAT receipt is a
 * different document that ResNeo does not issue, and labelling this one as a
 * receipt would invite a customer to file it as one.
 */
export function AccountPaymentHistorySection({
  payments,
  venues,
  failed,
}: {
  payments: AccountPaymentRow[];
  venues: Map<string, AccountVenueRow>;
  /** True when the lookup failed, so an empty list means nothing (P4-1's rule). */
  failed?: boolean;
}) {
  return (
    <section id="payments" aria-labelledby="payments-heading" className="scroll-mt-24">
      <h2 id="payments-heading" className="text-lg font-semibold text-slate-900">
        Payment history
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Deposits and payments recorded against your bookings.
      </p>

      {failed ? (
        // Same rule as P4-1: an empty list would read as "you have paid
        // nothing", which is a claim, and this one would be about money.
        <p role="alert" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          We could not load your payment history. Please refresh, or contact the venue if you need a
          record of what you paid.
        </p>
      ) : payments.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No payments recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-900/5">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">
                  {formatPence(p.amount_pence)}
                  {p.status !== 'succeeded' ? (
                    /*
                      Said plainly next to the amount. A refunded or failed row
                      shown as a bare figure reads as money the customer paid
                      and kept paying.
                    */
                    <span className="ml-2 text-sm font-normal text-slate-600">
                      {paymentStatusLabel(p.status)}
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-slate-600">
                  {venues.get(p.venue_id)?.name ?? 'Venue'} · {paymentMethodLabel(p.method)} ·{' '}
                  {formatPaymentDate(p.created_at)}
                </p>
              </div>
              <Link
                href={`/account/bookings/${p.booking_id}`}
                className="inline-flex min-h-6 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
              >
                View booking
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Plain words for the enum, since `card_present` is not English (P1-4). */
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case 'card_present':
      return 'Card in person';
    case 'cash':
      return 'Cash';
    case 'online':
      return 'Card online';
    case 'external':
      return 'Paid another way';
    default:
      return 'Payment';
  }
}

/** Only ever shown for rows that are NOT a plain success. */
export function paymentStatusLabel(status: string): string {
  switch (status) {
    case 'refunded':
      return 'Refunded';
    case 'failed':
      return 'Failed';
    case 'pending':
      return 'Pending';
    default:
      return status;
  }
}

function formatPaymentDate(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return 'date unavailable';
  return new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
