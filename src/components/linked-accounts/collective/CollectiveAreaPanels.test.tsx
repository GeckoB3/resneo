/** @vitest-environment happy-dom */
/**
 * The Collective area's Venues and History tabs (UX spec §2 item 15).
 *
 * Venues: the host sees every venue and every open invitation, and can remove a member or cancel an
 * invitation only after saying yes. History: one sentence per change, filters that reach the query,
 * and a download of the same rows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectiveVenuesPanel, type CollectiveVenueRow } from './CollectiveVenuesPanel';
import { CollectiveHistoryPanel } from './CollectiveHistoryPanel';

const COLLECTIVE = 'collective-1';

const venues: CollectiveVenueRow[] = [
  { venue_id: 'member', venue_name: 'Zen Studio', status: 'active', is_host: false },
  { venue_id: 'host', venue_name: 'Host Venue', status: 'active', is_host: true },
  { venue_id: 'invitee', venue_name: 'Bloom', status: 'invited', is_host: false },
];

const fetchMock = (body: unknown = {}, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CollectiveVenuesPanel', () => {
  const show = (onChanged = vi.fn(), onShowHistory = vi.fn()) => {
    render(
      <CollectiveVenuesPanel
        collectiveId={COLLECTIVE}
        collectiveName="Northside"
        venues={venues}
        groups={[]}
        onChanged={onChanged}
        onShowHistory={onShowHistory}
      />,
    );
    return { onChanged, onShowHistory };
  };

  it('lists the host first, then members, then invitations', () => {
    show();
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows[0]).toContain('Host Venue');
    expect(rows[1]).toContain('Zen Studio');
    expect(rows[2]).toContain('Bloom (invited)');
  });

  it('offers no removal of the host itself', () => {
    show();
    const hostRow = screen.getAllByRole('listitem')[0]!;
    expect(within(hostRow).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('removes a member only after the host says yes', async () => {
    const fetch = fetchMock({ collective: null });
    vi.stubGlobal('fetch', fetch);
    const { onChanged } = show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText('Remove Zen Studio from Northside?')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(`/api/venue/collectives/${COLLECTIVE}/members`);
    expect(JSON.parse(init!.body as string)).toEqual({ action: 'remove', venueId: 'member' });
  });

  it('cancels an invitation the same way', async () => {
    const fetch = fetchMock({ collective: null });
    vi.stubGlobal('fetch', fetch);
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));
    const ask = await screen.findByRole('dialog');
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ action: 'remove', venueId: 'invitee' });
  });

  it('shows the refusal when the removal did not go through', async () => {
    vi.stubGlobal('fetch', fetchMock({ error: 'Only the host venue can remove members.' }, 403));
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the host venue can remove members.');
  });

  it("opens a venue's history from its row", async () => {
    const { onShowHistory } = show();
    await userEvent.click(screen.getAllByRole('button', { name: 'History' })[1]!);
    expect(onShowHistory).toHaveBeenCalledWith('member');
  });
});

describe('CollectiveHistoryPanel', () => {
  const page = (sentences: string[], nextCursor: string | null = null) => ({
    events: sentences.map((sentence, i) => ({
      id: `e${i}`,
      at: '2026-09-16T09:00:00.000Z',
      type: 'member_joined',
      sentence,
      actor: { venue_name: null, person: null },
      changes: null,
    })),
    next_cursor: nextCursor,
  });

  it('reads one sentence per change', async () => {
    vi.stubGlobal('fetch', fetchMock(page(['Zen Studio joined', 'Host Venue added Facial to the page'])));
    render(<CollectiveHistoryPanel collectiveId={COLLECTIVE} collectiveName="Northside" />);
    expect(await screen.findByText('Zen Studio joined')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Northside history' })).toBeInTheDocument();
  });

  it('says so when nothing has changed', async () => {
    vi.stubGlobal('fetch', fetchMock(page([])));
    render(<CollectiveHistoryPanel collectiveId={COLLECTIVE} collectiveName="Northside" />);
    expect(await screen.findByText('Nothing has changed yet.')).toBeInTheDocument();
  });

  it('sends the filter and the venue it was opened for', async () => {
    const fetch = fetchMock(page([]));
    vi.stubGlobal('fetch', fetch);
    render(
      <CollectiveHistoryPanel
        collectiveId={COLLECTIVE}
        collectiveName="Northside"
        venues={[{ venue_id: 'member', venue_name: 'Zen Studio' }]}
        initialVenueId="member"
      />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Calendars' }));
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(1));
    const url = new URL(fetch.mock.calls.at(-1)![0], 'http://localhost');
    expect(url.searchParams.get('filter')).toBe('calendars');
    expect(url.searchParams.get('venue_id')).toBe('member');
  });

  it('loads the next page with the cursor it was given', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page(['First'], 'cursor-1'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(page(['Second']))));
    vi.stubGlobal('fetch', fetch);
    render(<CollectiveHistoryPanel collectiveId={COLLECTIVE} collectiveName="Northside" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Second')).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(new URL(fetch.mock.calls[1]![0] as string, 'http://localhost').searchParams.get('cursor')).toBe('cursor-1');
  });

  it('offers the same rows as a download', async () => {
    vi.stubGlobal('fetch', fetchMock(page([])));
    render(<CollectiveHistoryPanel collectiveId={COLLECTIVE} collectiveName="Northside" />);
    const link = await screen.findByRole('link', { name: 'Download this history' });
    expect(link.getAttribute('href')).toContain('format=csv');
  });
});
