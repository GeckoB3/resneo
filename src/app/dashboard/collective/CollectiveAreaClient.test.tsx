/** @vitest-environment happy-dom */
/**
 * What the Collective area says before a collective is on shared services.
 *
 * Found on production, 2026-09-17: a venue hosting a collective on the earlier model was told
 * "your venue is not part of a collective yet", because the area reads the collective from the
 * services' `collective` blocks and the older model has none. The page now says where that
 * collective is managed instead.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CollectiveAreaClient } from './CollectiveAreaClient';

const services = { services: [{ id: 'svc-1', name: 'Cut', collective: null }] };

function answer(collectives: unknown[]) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/venue/collectives') ? { collectives } : services;
    return { ok: true, json: async () => body } as Response;
  });
}

describe('the Collective area before a collective moves to shared services', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', answer([]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says a venue in no collective has nothing here', async () => {
    render(<CollectiveAreaClient />);
    expect(
      await screen.findByText(/not part of a collective yet/),
    ).toBeInTheDocument();
  });

  it('points a collective on the earlier model at its combined page, and never denies it exists', async () => {
    vi.stubGlobal(
      'fetch',
      answer([
        {
          id: 'col-1',
          name: 'Aura Hair Studio',
          hostVenueId: 'v-1',
          myVenueId: 'v-1',
          members: [],
          serviceModel: 'legacy_copies',
        },
      ]),
    );
    render(<CollectiveAreaClient />);

    expect(await screen.findByText(/Aura Hair Studio runs on the earlier set-up/)).toBeInTheDocument();
    expect(screen.queryByText(/not part of a collective yet/)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Manage the combined page' })).toHaveAttribute(
        'href',
        '/dashboard/settings?tab=booking-page',
      ),
    );
  });
});
