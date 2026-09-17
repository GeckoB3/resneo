/** @vitest-environment happy-dom */
/**
 * PUB-03 (RT2-14, PB-15): on a collective page the guest is told who they are booking with, and the
 * marketing consent names that business and starts unticked. A venue's own page is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DetailsStep } from './DetailsStep';

afterEach(cleanup);

const base = {
  slot: { key: '10:00', label: '10:00', start_time: '10:00', end_time: '', available_covers: 1 },
  date: '2026-10-12',
  partySize: 1,
  onSubmit: vi.fn(),
  onBack: vi.fn(),
  variant: 'appointment' as const,
};

const marketingBox = () =>
  screen
    .getAllByRole('checkbox')
    .find((box) => box.getAttribute('name') === 'marketingConsent') as HTMLInputElement;

describe('DetailsStep on a collective page', () => {
  it('names the business above the consents, and asks before signing the guest up', () => {
    render(
      <DetailsStep
        {...base}
        traderLine="You are booking with Zen Studio, 1 High Street, Belfast."
        marketingBusiness="Zen Studio"
      />,
    );
    expect(screen.getByTestId('trader-line')).toHaveTextContent('You are booking with Zen Studio, 1 High Street, Belfast.');
    expect(screen.getByText('Send me offers and news from Zen Studio by email.')).toBeInTheDocument();
    expect(marketingBox().checked).toBe(false);
  });
});

describe('DetailsStep on a venue page', () => {
  it('keeps its own wording and default', () => {
    render(<DetailsStep {...base} />);
    expect(screen.queryByTestId('trader-line')).not.toBeInTheDocument();
    expect(screen.getByText('Sign me up to receive offers and news from this business by email.')).toBeInTheDocument();
    expect(marketingBox().checked).toBe(true);
  });
});
