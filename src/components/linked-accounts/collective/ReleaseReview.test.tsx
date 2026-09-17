/** @vitest-environment happy-dom */
/**
 * Leaving a shared-services collective, and the review after (UX spec J7 to J9; contract 7).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EndedCollectivesList, LeaveCollectiveDialog, ReleaseReviewCard, ReleaseReviewPanel } from './ReleaseReview';
import type { ReleaseReview } from '@/lib/linked-accounts/replicas/release-review';

const review: ReleaseReview = {
  collective_id: 'collective-1',
  collective_name: 'Northside',
  host_name: 'Host Venue',
  reason: 'left',
  released_at: '2026-10-01T08:00:00Z',
  prices: 1,
  link: 2,
  stripe: true,
  library: true,
  photos: 'failed',
  sameName: ['Haircut'],
  unparked: 3,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LeaveCollectiveDialog', () => {
  const preview = {
    collective_name: 'Northside',
    host_name: 'Host Venue',
    services: 4,
    no_stripe: 2,
    other_venues: ['Bloom', 'Host Venue'],
    last_member: false,
  };

  it('says what leaving changes, including the account links that stay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(preview)));
    render(<LeaveCollectiveDialog open collectiveId="collective-1" onClose={vi.fn()} onLeft={vi.fn()} />);
    expect(await screen.findByText('4 services from Host Venue become your own services, with the settings they have now.')).toBeInTheDocument();
    expect(screen.getByText(/2 of them take a payment online/)).toBeInTheDocument();
    expect(screen.getByText(/Your account links with Bloom and Host Venue stay exactly as they are/)).toBeInTheDocument();
    expect(screen.queryByText(/so it ends when you leave/)).not.toBeInTheDocument();
  });

  it('warns when leaving ends the collective', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ ...preview, other_venues: ['Host Venue'], last_member: true })));
    render(<LeaveCollectiveDialog open collectiveId="collective-1" onClose={vi.fn()} onLeft={vi.fn()} />);
    expect(await screen.findByText('Northside needs at least two venues, so it ends when you leave.')).toBeInTheDocument();
  });

  it('leaves and hands back the review', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ collective: null, review }) : json(preview),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onLeft = vi.fn();
    render(<LeaveCollectiveDialog open collectiveId="collective-1" onClose={vi.fn()} onLeft={onLeft} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Leave Northside' }));
    await waitFor(() => expect(onLeft).toHaveBeenCalledWith(review));
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ action: 'leave' });
  });

  it('stays open and says why when leaving fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? json({ error: 'Could not leave. Please try again.' }, 409) : json(preview),
      ),
    );
    const onLeft = vi.fn();
    render(<LeaveCollectiveDialog open collectiveId="collective-1" onClose={vi.fn()} onLeft={onLeft} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Leave Northside' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not leave. Please try again.');
    expect(onLeft).not.toHaveBeenCalled();
  });
});

describe('ReleaseReviewPanel', () => {
  it('lists what to check, with singular and plural counts', () => {
    render(<ReleaseReviewPanel review={review} onDismiss={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'You left Northside. Review your services' })).toBeInTheDocument();
    expect(screen.getByText('Check prices and deposits on 1 service that came from Host Venue')).toBeInTheDocument();
    expect(screen.getByText('Add your own online meeting link to 2 services')).toBeInTheDocument();
    expect(screen.getByText('Connect Stripe to take payments online again')).toBeInTheDocument();
    expect(screen.getByText('Some photos could not be copied.')).toBeInTheDocument();
    expect(screen.getByText(/You now have two services called Haircut/)).toBeInTheDocument();
    expect(screen.getByText('3 services that were parked while you were part of Northside are bookable again.')).toBeInTheDocument();
  });

  it('has its own title after a removal', () => {
    render(<ReleaseReviewPanel review={{ ...review, reason: 'removed' }} onDismiss={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'You are no longer part of Northside. Review your services' })).toBeInTheDocument();
  });
});

describe('ReleaseReviewCard', () => {
  it('loads the review, and dismissing it hides it and tells the server', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({ ok: true }) : json({ review }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<ReleaseReviewCard />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ collective_id: 'collective-1' });
  });

  it('shows nothing when there is nothing to review', async () => {
    const fetchMock = vi.fn(async () => json({ review: null }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<ReleaseReviewCard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EndedCollectivesList', () => {
  const ended = [
    { collective_id: 'collective-1', name: 'Northside', dissolved_at: '2026-10-01T09:00:00Z', list_on_old_page: true },
  ];

  it('shows when it ended and saves the listing choice', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH' ? json({ ok: true }) : json({ ended }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<EndedCollectivesList venueName="Zen Studio" />);
    expect(await screen.findByText('Ended on 1 October 2026')).toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'List Zen Studio on the old Northside page' });
    expect(box).toBeChecked();
    await userEvent.setup().click(box);
    expect(box).not.toBeChecked();
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/venue/collectives/collective-1/members');
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ action: 'configure', list_on_old_page: false });
  });

  it('puts the choice back when the save fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'PATCH' ? json({ error: 'no' }, 500) : json({ ended }),
      ),
    );
    render(<EndedCollectivesList venueName="Zen Studio" />);
    const box = await screen.findByRole('checkbox');
    await userEvent.setup().click(box);
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not save.');
    expect(box).toBeChecked();
  });

  it('shows nothing when no collective has ended', async () => {
    const fetchMock = vi.fn(async () => json({ ended: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<EndedCollectivesList venueName="Zen Studio" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
