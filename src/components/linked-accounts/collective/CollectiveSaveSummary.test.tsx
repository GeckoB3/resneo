/** @vitest-environment happy-dom */
/**
 * What a host reads after saving a shared service (UX spec §2 item 1 step 6; D50).
 *
 * The save succeeded: this says how far it reached, and offers to put it back for 60 seconds. The
 * things worth guarding are that a pending venue is never reported as done, that the undo posts the
 * save's own audit row, and that an undo which came too late says so instead of failing silently.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectiveSaveSummary } from './CollectiveSaveSummary';
import type { CollectiveSync } from '@/lib/linked-accounts/replicas/inline-apply';

const COLLECTIVE = 'collective-1';

const sync = (overrides: Partial<CollectiveSync> = {}): CollectiveSync => ({
  venues: 2,
  applied: 2,
  pending: [],
  failed: [],
  audit_event_id: 'audit-1',
  ...overrides,
});

function show(overrides: Partial<CollectiveSync> = {}, props: Record<string, unknown> = {}) {
  return render(
    <CollectiveSaveSummary
      sync={sync(overrides)}
      serviceName="Facial"
      collectiveId={COLLECTIVE}
      venueNames={['Aura', 'Zen']}
      {...props}
    />,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CollectiveSaveSummary', () => {
  it('names the venues a save reached', () => {
    show();
    expect(screen.getByText('Saved. Facial is up to date at Aura and Zen.')).toBeInTheDocument();
  });

  it('says a venue is still updating instead of claiming it is done', () => {
    show({ applied: 1, pending: [{ venue_id: 'v2', venue_name: 'Zen' }] });
    expect(screen.queryByText(/up to date/)).not.toBeInTheDocument();
    expect(screen.getByText(/Zen is updating/)).toBeInTheDocument();
  });

  it('names a venue that could not be updated, with a Retry that goes to the one Retry', async () => {
    const onRetry = vi.fn();
    show(
      {
        applied: 1,
        failed: [{ venue_id: 'v2', venue_name: 'Zen', message: 'nope', code: 'lock_timeout' }],
      },
      { onRetry },
    );
    expect(screen.getByText(/Zen was busy/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry now' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('reports a calendar the engine refused without hiding the save', () => {
    show({
      calendar_failures: [
        { venue_id: 'v2', calendar_id: 'cal-9', message: 'Chair 2 at Zen could not be changed: it is not at that venue.' },
      ],
    });
    expect(screen.getByText(/Chair 2 at Zen could not be changed/)).toBeInTheDocument();
    expect(screen.getByText(/up to date at Aura and Zen/)).toBeInTheDocument();
  });

  it('puts the change back by sending the save its own audit row', async () => {
    const onUndone = vi.fn();
    show({}, { onUndone });
    await userEvent.click(screen.getByRole('button', { name: /Put it back/ }));
    await waitFor(() => expect(onUndone).toHaveBeenCalled());
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/venue/collectives/${COLLECTIVE}/undo`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ audit_event_id: 'audit-1' });
    expect(screen.getByText('We put Facial back to how it was, at every venue.')).toBeInTheDocument();
  });

  it('says a change is history when the undo came too late', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 410 })));
    show();
    await userEvent.click(screen.getByRole('button', { name: /Put it back/ }));
    await waitFor(() =>
      expect(screen.getByText(/now part of your history/)).toBeInTheDocument(),
    );
  });

  it('offers no undo for a save the collective did not copy', () => {
    show({ audit_event_id: null });
    expect(screen.queryByRole('button', { name: /Put it back/ })).not.toBeInTheDocument();
  });

  it('renders nothing at all when there is nothing to say', () => {
    const { container } = render(
      <CollectiveSaveSummary
        sync={{ venues: 0, applied: 0, pending: [], failed: [], audit_event_id: null }}
        serviceName="Facial"
        collectiveId={COLLECTIVE}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
