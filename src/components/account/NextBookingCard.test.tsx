/** @vitest-environment happy-dom */
/**
 * P4-1's acceptance, at the surface that makes the claim.
 *
 * The card renders outstanding forms, and rendering NOTHING is itself a
 * statement: it tells the customer there is nothing to sign. When the lookup
 * failed, that statement is unfounded, and the customer finds out at the door.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { NextBookingCard } from './NextBookingCard';
import type { AccountBookingRow } from '@/lib/account/account-bookings';

afterEach(cleanup);

const BOOKING = {
  id: 'b-1',
  booking_date: '2026-09-10',
  booking_time: '14:30:00',
  status: 'Booked',
  starts_at: '2026-09-10T14:30:00+01:00',
  time_zone: 'Europe/London',
  venue: { id: 'v-1', name: 'The Wharf', slug: 'the-wharf' },
} as unknown as AccountBookingRow;

const APPOINTMENT = { service: 'Consultation', practitioner: 'Ada' };

function renderCard(over: { formLinks?: Array<{ name: string; url: string }>; formsChecked?: boolean } = {}) {
  return render(
    <NextBookingCard
      booking={BOOKING}
      appointment={APPOINTMENT}
      formLinks={over.formLinks ?? []}
      formsChecked={over.formsChecked}
      profileTz="Europe/London"
    />,
  );
}

describe('outstanding forms on the next booking', () => {
  it('lists the forms when there are some', async () => {
    renderCard({ formLinks: [{ name: 'Consultation waiver', url: 'https://forms.test/1' }] });
    expect(screen.getByText('Consultation waiver')).toBeInTheDocument();
    expect(screen.getByText(/one form to complete/i)).toBeInTheDocument();
  });

  it('says NOTHING when the lookup succeeded and found none', () => {
    // Silence is correct here, and only here.
    renderCard({ formLinks: [], formsChecked: true });
    expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/form to complete/i)).not.toBeInTheDocument();
  });

  it('SAYS SO when the lookup failed, instead of implying nothing is due', () => {
    /*
      The acceptance. Before this, a failed query and a clean booking rendered
      identically, so the portal asserted "nothing to do" on no evidence.
    */
    renderCard({ formLinks: [], formsChecked: false });
    const alert = screen.getByText(/could not check for forms/i);
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/contact the venue/i)).toBeInTheDocument();
  });

  it('marks the failure as an alert, so it is announced not just drawn', () => {
    // A customer using a screen reader gets no benefit from a grey box they
    // are never told about.
    renderCard({ formLinks: [], formsChecked: false });
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => /could not check/i.test(el.textContent ?? ''))).toBe(true);
  });

  it('shows the forms rather than the warning when it has both', () => {
    // A partial failure that still returned rows should not bury the rows
    // under a caveat: the actionable thing wins.
    renderCard({
      formLinks: [{ name: 'Waiver', url: 'https://forms.test/2' }],
      formsChecked: false,
    });
    expect(screen.getByText('Waiver')).toBeInTheDocument();
    expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument();
  });

  it('defaults to trusting the caller, so existing callers are unchanged', () => {
    // `formsChecked` is optional: every surface that has not been updated
    // keeps rendering exactly as it did.
    renderCard({ formLinks: [] });
    expect(screen.queryByText(/could not check/i)).not.toBeInTheDocument();
  });
});
