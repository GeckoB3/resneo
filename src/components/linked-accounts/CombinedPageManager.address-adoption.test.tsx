/** @vitest-environment happy-dom */
/**
 * SEO-02 and N38 on the Booking Page tab: the member is asked with Agree and Not now, and nothing
 * shows for a venue that was not asked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AddressAdoptionAsk } from './CombinedPageManager';
import { collectiveView } from './collective-test-fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asked = collectiveView({
  isHost: false,
  myVenueId: 'v-member',
  serviceModel: 'replicas',
  pendingAdoptedVenueId: 'v-member',
});

describe('AddressAdoptionAsk', () => {
  it("asks the member, naming its own address, and sends the answer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, status: 'adopted' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AddressAdoptionAsk collective={asked} host="Plus 1" />);
    expect(screen.getByTestId('address-adoption-ask')).toHaveTextContent(
      /Plus 1 would like the Plus 1 Staging page to use your page address, .*\/book\/light-3\. Nothing changes unless you agree/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Agree' }));
    expect(await screen.findByRole('status')).toHaveTextContent('The Plus 1 Staging page now uses your page address.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/venue/collectives/col-1/address-adoption',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ accept: true }) }),
    );
  });

  it('keeps the address on "Not now"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, status: 'declined' }), { status: 200 })));
    render(<AddressAdoptionAsk collective={asked} host="Plus 1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your page address stays as it is.');
  });

  it('shows nothing to a venue that was not asked', () => {
    render(<AddressAdoptionAsk collective={{ ...asked, pendingAdoptedVenueId: 'v-host' }} host="Plus 1" />);
    expect(screen.queryByTestId('address-adoption-ask')).not.toBeInTheDocument();
    cleanup();
    render(<AddressAdoptionAsk collective={{ ...asked, pendingAdoptedVenueId: null }} host="Plus 1" />);
    expect(screen.queryByTestId('address-adoption-ask')).not.toBeInTheDocument();
  });
});
