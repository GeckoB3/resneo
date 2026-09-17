/** @vitest-environment happy-dom */
/**
 * PUB-05 and §6.9: on a venue's own page whose appointments are booked on its collective page, the
 * appointments tab is a card linking there while other tabs keep booking; and a calendar address
 * handed over as `?calendar=` preselects that calendar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

let query = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/book/zen',
  useSearchParams: () => query,
}));
const routerProps = vi.fn();
vi.mock('@/components/booking/BookingFlowRouter', () => ({
  BookingFlowRouter: (props: Record<string, unknown>) => {
    routerProps(props);
    return <div>flow for {String(props.activeBookingModel)}</div>;
  },
}));
vi.mock('@/components/booking/PublicBookingAccountGate', () => ({
  PublicBookingAccountGateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { BookPublicBookingFlow } from './BookPublicBookingFlow';
import type { VenuePublic } from './types';

const venue = (over: Partial<VenuePublic> = {}): VenuePublic =>
  ({
    id: 'member',
    name: 'Zen Studio',
    slug: 'zen',
    cover_photo_url: null,
    address: null,
    phone: null,
    deposit_config: null,
    booking_rules: null,
    opening_hours: null,
    timezone: 'Europe/London',
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling', 'class_session'],
    currency: 'GBP',
    ...over,
  }) as VenuePublic;

const handover = { collective_name: 'Northside', href: '/book/c/northside' };

beforeEach(() => {
  query = new URLSearchParams();
  routerProps.mockClear();
});
afterEach(cleanup);

describe('BookPublicBookingFlow handing appointments over', () => {
  it('shows a card linking to the collective page on the appointments tab', () => {
    query = new URLSearchParams('tab=appointments');
    render(<BookPublicBookingFlow venue={venue({ appointments_handover: handover })} />);
    expect(screen.getByText('Appointments are booked with Northside')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book an appointment' })).toHaveAttribute('href', '/book/c/northside');
    expect(screen.queryByText(/flow for unified_scheduling/)).not.toBeInTheDocument();
  });

  it('keeps booking on the other tabs', () => {
    const classesTab = venue({ appointments_handover: handover });
    query = new URLSearchParams('tab=classes');
    render(<BookPublicBookingFlow venue={classesTab} />);
    expect(screen.getByText('flow for class_session')).toBeInTheDocument();
    expect(screen.queryByText('Appointments are booked with Northside')).not.toBeInTheDocument();
  });

  it('books appointments as before without a handover', () => {
    query = new URLSearchParams('tab=appointments');
    render(<BookPublicBookingFlow venue={venue()} />);
    expect(screen.getByText('flow for unified_scheduling')).toBeInTheDocument();
  });

  it('preselects the calendar a handed-over address named', () => {
    query = new URLSearchParams('calendar=cal-1');
    render(<BookPublicBookingFlow venue={venue({ active_booking_models: ['unified_scheduling'], is_collective: true })} />);
    expect(routerProps).toHaveBeenLastCalledWith(expect.objectContaining({ preselectedPractitionerId: 'cal-1' }));
  });
});
