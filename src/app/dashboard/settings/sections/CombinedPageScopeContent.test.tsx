/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock('@/components/booking-page-editor/BookingPageEditor', () => ({
  BookingPageEditor: () => <div data-testid="page-editor-stub" />,
}));
vi.mock('@/components/dashboard/appointment-services/ServiceCategoriesManager', () => ({
  ServiceCategoriesManager: () => null,
}));

import { CombinedPageScopeContent } from './CombinedPageScopeContent';
import { catalogueView, collectiveView } from '@/components/linked-accounts/collective-test-fixtures';
import type { CollectiveView } from '@/lib/linked-accounts/collectives';

function installFetch(collectives: CollectiveView[], failCollectives = false): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      if (url === '/api/venue/collectives') {
        return failCollectives
          ? ({ ok: false, status: 500, json: async () => ({ error: 'Boom' }) } as Response)
          : ({ ok: true, status: 200, json: async () => ({ collectives }) } as Response);
      }
      if (url === '/api/venue/account-links') {
        return { ok: true, status: 200, json: async () => ({ links: [] }) } as Response;
      }
      if (url.endsWith('/catalogue')) {
        return { ok: true, status: 200, json: async () => ({ catalogue: catalogueView(), importSources: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
}

const note = { id: 'col-1', name: 'Plus 1 Staging', isHost: true, hostVenueName: 'Plus 1', adoptedThisVenue: false };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CombinedPageScopeContent', () => {
  it('renders the host’s manager inline', async () => {
    installFetch([collectiveView()]);
    render(<CombinedPageScopeContent collective={note} />);
    expect(await screen.findByTestId('combined-page-panel')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Combined page settings' })).toBeInTheDocument();
    expect(screen.queryByTestId('combined-page-member-summary')).toBeNull();
  });

  it('renders a member’s read-only summary', async () => {
    installFetch([collectiveView({ isHost: false, myVenueId: 'v-member' })]);
    render(<CombinedPageScopeContent collective={{ ...note, isHost: false }} />);
    expect(await screen.findByTestId('combined-page-member-summary')).toBeInTheDocument();
    expect(screen.getByText('This combined page is managed by Plus 1.')).toBeInTheDocument();
    expect(screen.queryByTestId('combined-page-panel')).toBeNull();
  });

  it('shows the load error', async () => {
    installFetch([], true);
    render(<CombinedPageScopeContent collective={note} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom');
  });

  it('says when the collective is no longer live', async () => {
    installFetch([collectiveView({ status: 'dissolved' })]);
    render(<CombinedPageScopeContent collective={note} />);
    expect(await screen.findByText(/no longer live/)).toBeInTheDocument();
  });
});
