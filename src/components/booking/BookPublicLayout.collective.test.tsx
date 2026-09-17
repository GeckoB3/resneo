/** @vitest-environment happy-dom */
/**
 * UX spec `public.header.venues`: the collective page's header says how many venues it books for.
 * A venue's own page says nothing of the kind.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/booking/BookPublicPageContent', () => ({ BookPublicPageContent: () => null }));

import { BookPublicLayout } from './BookPublicLayout';
import type { VenuePublic } from './types';

afterEach(cleanup);

const venue = (over: Partial<VenuePublic> = {}): VenuePublic =>
  ({
    id: 'col-1',
    name: 'Northside',
    slug: 'northside',
    cover_photo_url: null,
    address: null,
    phone: null,
    deposit_config: null,
    booking_rules: null,
    opening_hours: null,
    timezone: 'Europe/London',
    booking_model: 'unified_scheduling',
    currency: 'GBP',
    ...over,
  }) as VenuePublic;

describe('BookPublicLayout header', () => {
  it('says how many venues the collective page books for', () => {
    render(<BookPublicLayout venue={venue({ is_collective: true, collective_venue_count: 3 })} />);
    expect(screen.getAllByTestId('collective-venue-count')[0]).toHaveTextContent('3 venues');
  });

  it('says nothing on a venue page', () => {
    render(<BookPublicLayout venue={venue({ collective_venue_count: 3 })} />);
    expect(screen.queryByTestId('collective-venue-count')).not.toBeInTheDocument();
  });
});
