/**
 * Which bookings still have a deposit worth acting on.
 *
 * `deposit_status` is set to 'Pending' at creation when a deposit or a card-hold
 * fee is required, and to 'Not Required' otherwise. It then moves to 'Paid',
 * 'Waived', 'Refunded', 'Charged' and so on as the deposit is settled.
 *
 * Only 'Pending' and 'Failed' leave anything to collect, waive or record. The
 * `send_payment_link` action has always enforced exactly that ("This booking has
 * no deposit to collect"), but `waive` and `record_cash` did not, so a booking
 * that never required a deposit could be marked Paid for £0.00. The row then
 * claimed to be settled while its real balance sat untouched, and the interface
 * showed "£0.00 - Paid" beside "Outstanding £35.00" on the same screen.
 *
 * Shared by the deposit route and by both booking-detail surfaces so a button is
 * never offered for an action the route will refuse.
 */
export const DEPOSIT_SETTLEABLE_STATUSES = ['Pending', 'Failed'] as const;

export function hasSettleableDeposit(depositStatus: string | null | undefined): boolean {
  if (!depositStatus) return false;
  return (DEPOSIT_SETTLEABLE_STATUSES as readonly string[]).includes(depositStatus);
}
