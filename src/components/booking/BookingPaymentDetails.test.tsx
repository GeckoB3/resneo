/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { BookingPaymentDetails } from './BookingPaymentDetails';
import type { PaymentDisplayBooking } from '@/lib/booking/payment-display';

/**
 * The web cannot take an in-person payment, so this panel exists purely to show
 * what the ResNeo app collected. Without it a booking settled in the chair still
 * reads as unpaid on desktop.
 */

const booking = (over: Partial<PaymentDisplayBooking>): PaymentDisplayBooking => ({
  id: 'bk-1',
  ...over,
});

const ONE_MIN_AGO = () => new Date(Date.now() - 60_000).toISOString();
const TEN_MIN_AGO = () => new Date(Date.now() - 10 * 60_000).toISOString();

describe('BookingPaymentDetails', () => {
  it('renders nothing when there is no money to report', () => {
    const { container } = render(<BookingPaymentDetails booking={booking({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the price breakdown and the outstanding balance', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut & finish',
          service_variant_price_pence: 3000,
          addons: [{ addon_id: 'a1', addon_name_snapshot: 'Gloss', price_pence_at_booking: 800 }],
          addons_total_price_pence: 800,
          balance_due_pence: 3800,
        })}
      />,
    );
    expect(screen.getByText('Cut & finish')).toBeInTheDocument();
    expect(screen.getByText('Gloss')).toBeInTheDocument();
    expect(screen.getByText('Booking total')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getAllByText('£38.00').length).toBeGreaterThan(0);
  });

  it('shows a payment taken in person on the app, so it is not missed on desktop', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Facial',
          service_variant_price_pence: 5000,
          amount_paid_pence: 5000,
          payment_state: 'paid',
          balance_due_pence: 0,
          payments: [
            {
              id: 'p1',
              booking_id: 'bk-1',
              method: 'card_present',
              status: 'succeeded',
              amount_pence: 5000,
              note: null,
              created_at: '2026-07-23T10:00:00Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(screen.getByText('Payment history')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
  });

  it('keeps a failed card attempt visible rather than looking simply unpaid', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          balance_due_pence: 2000,
          payments: [
            {
              id: 'p1',
              booking_id: 'bk-1',
              method: 'card_present',
              status: 'failed',
              amount_pence: 2000,
              note: null,
              created_at: '2026-07-23T10:00:00Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('warns while a card payment is still in flight', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          balance_due_pence: 2000,
          payments: [
            {
              id: 'p1',
              booking_id: 'bk-1',
              method: 'card_present',
              status: 'pending',
              amount_pence: 2000,
              note: null,
              created_at: ONE_MIN_AGO(),
            },
          ],
        })}
      />,
    );
    expect(screen.getByText(/Card payment processing/)).toBeInTheDocument();
  });

  it('softens the warning once the webhook is clearly not coming', async () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          balance_due_pence: 2000,
          payments: [
            {
              id: 'p1',
              booking_id: 'bk-1',
              method: 'card_present',
              status: 'pending',
              amount_pence: 2000,
              note: null,
              created_at: TEN_MIN_AGO(),
            },
          ],
        })}
      />,
    );
    // The clock is read from a timer callback, so the stale verdict lands on the
    // next tick rather than the first paint.
    expect(await screen.findByText(/Card payment unconfirmed/)).toBeInTheDocument();
  });

  it('flags a payment collected on another service of the same visit', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          balance_due_pence: 0,
          amount_paid_pence: 9000,
          payment_state: 'paid',
          payments: [
            {
              id: 'p1',
              booking_id: 'bk-2',
              method: 'card_present',
              status: 'succeeded',
              amount_pence: 9000,
              note: null,
              created_at: '2026-07-23T10:00:00Z',
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('Collected on another service in this visit')).toBeInTheDocument();
  });

  it('does not label an ordinary unpaid booking as a payment state', () => {
    render(
      <BookingPaymentDetails
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          payment_state: 'unpaid',
          balance_due_pence: 2000,
        })}
      />,
    );
    expect(screen.queryByText(/^Payment:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Unpaid')).not.toBeInTheDocument();
  });
});
