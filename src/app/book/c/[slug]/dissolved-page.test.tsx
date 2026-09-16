/** @vitest-environment happy-dom */
/**
 * D25: the old address of an ended collective shows a neutral page, never the host's page.
 */
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { DissolvedCollectivePage } from './collective-page-view';

describe('DissolvedCollectivePage', () => {
  it('links each listed venue to its own page, and says when a venue has none', () => {
    render(
      <DissolvedCollectivePage
        page={{
          name: 'Northside',
          branding: { logo_url: null, primary_colour: '#003B6F' } as never,
          venues: [
            { name: 'Host Venue', slug: 'host-venue' },
            { name: 'Zen Studio', slug: null },
          ],
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Northside is no longer taking bookings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book with Host Venue' })).toHaveAttribute('href', '/book/host-venue');
    expect(screen.queryByRole('link', { name: 'Book with Zen Studio' })).not.toBeInTheDocument();
    expect(screen.getByText('Please contact the business directly.')).toBeInTheDocument();
    expect(screen.getByText(/the link in your confirmation email still lets you manage it/)).toBeInTheDocument();
  });

  it('still helps when no venue is listed', () => {
    render(<DissolvedCollectivePage page={{ name: 'Northside', branding: {} as never, venues: [] }} />);
    expect(screen.queryByText('You can still book with these businesses:')).not.toBeInTheDocument();
    expect(screen.getByText('Please contact the business directly.')).toBeInTheDocument();
  });
});
