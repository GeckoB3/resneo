'use client';

import { buildPriceSummary, formatPence, type PaymentDisplayBooking } from '@/lib/booking/payment-display';

/**
 * What the appointment costs, line by line, with the total.
 *
 * Split out of {@link BookingPaymentDetails} so it can sit in the open body of the booking detail
 * rather than inside the collapsed "Payments and confirmation" section. The breakdown answers "what
 * am I charging for this?", which staff want at a glance; the payment state, card warnings and
 * ledger stay behind the accordion because those are only needed when money is in question.
 *
 * Rows come from the shared builder, so a multi-service visit lists each service, a single service
 * lists its add-ons indented beneath it, and the total follows the same rules as the app.
 */
export function BookingPriceSummary({
  booking,
  serviceName,
}: {
  booking: PaymentDisplayBooking;
  /**
   * The booked service's name, used only when the shared builder produced no service row. It labels
   * a row from `service_variant_name`, so a booking without a variant listed its add-ons and a total
   * with the service itself missing, which is the one line staff most want.
   */
  serviceName?: string | null;
}) {
  const rows = buildPriceSummary(booking);
  const hasServiceRow = rows.some((r) => r.key === 'service' || r.key.startsWith('line-'));
  const label = serviceName?.trim();

  if (!hasServiceRow && label) {
    // Total minus add-ons is what the service itself came to. Both figures are snapshots on the
    // booking, so this stays consistent with the total below rather than recomputing from the
    // service's current price.
    const total = booking.booking_total_price_pence ?? null;
    const addons = booking.addons_total_price_pence ?? 0;
    const basePence = total != null ? total - addons : null;
    rows.unshift({
      key: 'service',
      label,
      pence: basePence,
      ...(basePence == null ? { note: 'Price not set' } : {}),
    });
  }

  if (rows.length === 0) return null;

  return (
    <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
      {rows.map((r) => (
        <li
          key={r.key}
          className={`flex items-start justify-between gap-3 ${r.indent ? 'pl-3' : ''} ${
            r.emphasis ? 'mt-1 border-t border-slate-100 pt-1' : ''
          }`}
        >
          <span className={`min-w-0 ${r.emphasis ? 'font-semibold text-slate-900' : ''}`}>
            {r.label}
          </span>
          <span
            className={`shrink-0 tabular-nums ${r.emphasis ? 'font-semibold text-slate-900' : ''}`}
          >
            {r.pence != null ? formatPence(r.pence) : (r.note ?? '—')}
          </span>
        </li>
      ))}
    </ul>
  );
}
