/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NEW_BOOKINGS_REPORT_HREF, NewBookingsCard } from './NewBookingsCard';
import type { NewBookingCounts, NewBookingsSummary } from '@/lib/reports/new-bookings';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function counts(over: Omit<Partial<NewBookingCounts>, 'by_channel'> & { by_channel?: Partial<NewBookingCounts['by_channel']> } = {}): NewBookingCounts {
  const { by_channel, ...rest } = over;
  return {
    total: 0,
    cancelled: 0,
    awaiting_payment: 0,
    ...rest,
    by_channel: { online: 0, team: 0, walk_in: 0, linked_venue: 0, ...by_channel },
  };
}

const summary: NewBookingsSummary = {
  today: counts({ total: 7, by_channel: { online: 4, team: 2, walk_in: 1 }, cancelled: 1, awaiting_payment: 2 }),
  this_week: counts({ total: 23, by_channel: { online: 15, team: 8 } }),
  this_month: counts({ total: 1, by_channel: { linked_venue: 1 } }),
  week_start: '2026-09-14',
  month_start: '2026-09-01',
};

describe('NewBookingsCard', () => {
  it('says how many bookings were made today, how they came in, and what is outstanding', () => {
    render(<NewBookingsCard summary={summary} showReportLink={false} />);
    expect(screen.getByText(/You have had/)).toHaveTextContent('You have had 7 new bookings today.');
    const channels = screen.getByRole('list', { name: 'How they were booked' });
    expect(channels).toHaveTextContent('Online4');
    expect(channels).toHaveTextContent('By your team2');
    expect(channels).toHaveTextContent('Walk-ins1');
    expect(channels).not.toHaveTextContent('By a linked venue');
    expect(screen.getByText(/1 of these has since been cancelled/)).toBeInTheDocument();
    expect(screen.getByText(/2 more are waiting for a deposit or card/)).toBeInTheDocument();
  });

  it('switches to this week and this month', () => {
    render(<NewBookingsCard summary={summary} showReportLink={false} />);
    fireEvent.click(screen.getByRole('tab', { name: 'This week' }));
    expect(screen.getByText(/You have had/)).toHaveTextContent('You have had 23 new bookings this week.');
    expect(screen.queryByText(/since been cancelled/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'This month' }));
    expect(screen.getByText(/You have had/)).toHaveTextContent('You have had 1 new booking this month.');
    expect(screen.getByRole('list', { name: 'How they were booked' })).toHaveTextContent('By a linked venue1');
  });

  it('reads plainly when nothing has been booked yet', () => {
    render(<NewBookingsCard summary={{ ...summary, today: counts() }} showReportLink={false} />);
    expect(screen.getByText('No new bookings yet today.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'How they were booked' })).not.toBeInTheDocument();
  });

  it('links admins through to the report', () => {
    const { rerender } = render(<NewBookingsCard summary={summary} showReportLink />);
    expect(screen.getByRole('link', { name: /in Reports/ })).toHaveAttribute('href', NEW_BOOKINGS_REPORT_HREF);
    rerender(<NewBookingsCard summary={summary} showReportLink={false} />);
    expect(screen.queryByRole('link', { name: /in Reports/ })).not.toBeInTheDocument();
  });

  it('says so when the figure could not be loaded, and stays away for an older server', () => {
    const { rerender, container } = render(<NewBookingsCard summary={null} showReportLink={false} />);
    expect(screen.getByText(/could not count your new bookings/)).toBeInTheDocument();
    rerender(<NewBookingsCard summary={undefined} showReportLink={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
