/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { BookingPriceSummary } from './BookingPriceSummary';
import type { PaymentDisplayBooking } from '@/lib/booking/payment-display';

/**
 * The breakdown staff see without opening anything: what each service costs and what the
 * appointment comes to. Previously only visible inside the collapsed payments section.
 */

const booking = (over: Partial<PaymentDisplayBooking>): PaymentDisplayBooking => ({
  id: 'bk-1',
  ...over,
});

describe('BookingPriceSummary', () => {
  it('renders nothing when the booking has no price at all', () => {
    const { container } = render(<BookingPriceSummary booking={booking({})} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the service, its add-ons and the booking total', () => {
    render(
      <BookingPriceSummary
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

  it('lists every service of a multi-service visit', () => {
    render(
      <BookingPriceSummary
        booking={booking({
          service_variant_name: 'Cut',
          service_variant_price_pence: 2000,
          visit_payment: {
            booking_count: 2,
            booking_ids: ['bk-1', 'bk-2'],
            total_pence: 5000,
            amount_paid_pence: 0,
            balance_due_pence: 5000,
            lines: [
              { booking_id: 'bk-1', name: 'Cut', total_pence: 2000 },
              { booking_id: 'bk-2', name: 'Colour', total_pence: 3000 },
            ],
          },
        })}
      />,
    );
    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.getByText('Colour')).toBeInTheDocument();
    expect(screen.getByText('£20.00')).toBeInTheDocument();
    expect(screen.getByText('£30.00')).toBeInTheDocument();
  });

  it('names the service for a booking with no variant, deriving its price from the total', () => {
    render(
      <BookingPriceSummary
        serviceName="Standard Tuning"
        booking={booking({
          addons: [
            { addon_id: 'a1', addon_name_snapshot: "Key(s) Don't Play", price_pence_at_booking: 2000 },
          ],
          addons_total_price_pence: 2000,
          booking_total_price_pence: 10700,
        })}
      />,
    );
    expect(screen.getByText('Standard Tuning')).toBeInTheDocument();
    expect(screen.getByText('£87.00')).toBeInTheDocument();
    expect(screen.getByText('Booking total')).toBeInTheDocument();
    expect(screen.getByText('£107.00')).toBeInTheDocument();
  });

  it('does not duplicate the service row when a variant already named one', () => {
    render(
      <BookingPriceSummary
        serviceName="Cut & finish"
        booking={booking({
          service_variant_name: 'Cut & finish (long hair)',
          service_variant_price_pence: 3000,
        })}
      />,
    );
    expect(screen.getByText('Cut & finish (long hair)')).toBeInTheDocument();
    expect(screen.queryByText('Cut & finish')).not.toBeInTheDocument();
  });

  it('says so when a price was never set, rather than showing nothing', () => {
    render(
      <BookingPriceSummary
        booking={booking({ service_variant_name: 'Consultation', service_variant_price_pence: null })}
      />,
    );
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Price not set')).toBeInTheDocument();
  });
});
