/** @vitest-environment happy-dom */
/**
 * "Add from another venue" and the member's answer (UX spec `svc.addFrom.*`, `svc.member.adopt.*`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddFromVenueDialog, AdoptionRequests } from './Adoptions';
import type { AdoptionReview } from '@/lib/linked-accounts/replicas/adoptions';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AddFromVenueDialog', () => {
  const venues = [
    { venue_id: 'aaaaaaaa-0000-4000-8000-00000000000b', venue_name: 'Zen Studio' },
    { venue_id: 'aaaaaaaa-0000-4000-8000-00000000000c', venue_name: 'Bloom' },
  ];
  const show = (fetchMock: ReturnType<typeof vi.fn>, onAdded = vi.fn()) => {
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AddFromVenueDialog
        open
        onClose={vi.fn()}
        collectiveId="collective-1"
        collectiveName="Northside"
        venues={venues}
        formatPrice={(p) => `£${(p / 100).toFixed(2)}`}
        onAdded={onAdded}
      />,
    );
    return onAdded;
  };

  it("lists the chosen venue's own services and adds the one picked", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json({ item_id: 'item-1' }, 201);
      return url.includes('00000000000b')
        ? json({ services: [{ id: 'svc-1', name: 'Balayage', duration_minutes: 90, price_pence: 12000 }] })
        : json({ services: [] });
    });
    const onAdded = show(fetchMock);
    const user = userEvent.setup();
    const add = screen.getByRole('button', { name: 'Copy and add to the page' });
    expect(add).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: /Balayage/ }));
    expect(screen.getByText('90 min, £120.00')).toBeInTheDocument();
    expect(screen.getByText(/Zen Studio is asked whether to use its own Balayage for this/)).toBeInTheDocument();
    await user.click(add);
    await waitFor(() =>
      expect(onAdded).toHaveBeenCalledWith(
        'Balayage is on the Northside page. We have asked Zen Studio whether to use its own Balayage for it.',
      ),
    );
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      source_venue_id: 'aaaaaaaa-0000-4000-8000-00000000000b',
      source_service_id: 'svc-1',
    });
  });

  it("opens on a member's suggestion with that venue and service chosen", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('00000000000c')
          ? json({ services: [{ id: 'svc-bloom', name: 'Nails', duration_minutes: 30, price_pence: 2000 }] })
          : json({ services: [] }),
      ),
    );
    render(
      <AddFromVenueDialog
        open
        onClose={vi.fn()}
        collectiveId="collective-1"
        collectiveName="Northside"
        venues={venues}
        formatPrice={(p) => `£${(p / 100).toFixed(2)}`}
        onAdded={vi.fn()}
        initialVenueId="aaaaaaaa-0000-4000-8000-00000000000c"
        initialServiceId="svc-bloom"
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Venue' })).toHaveValue('aaaaaaaa-0000-4000-8000-00000000000c');
    expect(await screen.findByRole('radio', { name: /Nails/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Copy and add to the page' })).toBeEnabled();
  });

  it('says when a venue has nothing of its own to add', async () => {
    show(vi.fn(async () => json({ services: [] })));
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Venue' }), 'aaaaaaaa-0000-4000-8000-00000000000c');
    expect(await screen.findByText('Bloom has no services of its own to add.')).toBeInTheDocument();
  });
});

describe('AdoptionRequests', () => {
  const review: AdoptionReview = {
    item_id: 'item-1',
    collective_name: 'Northside',
    host_name: 'Host Venue',
    service: { id: 'svc-1', name: 'Balayage', options: [{ id: 'my-short', name: 'Short' }] },
    host_options: [{ id: 'host-short', name: 'Short' }],
    suggested_map: [{ my_variant_id: 'my-short', host_variant_id: 'host-short' }],
  };
  const fetchFor = (answer: Response = json({ ok: true })) =>
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return answer;
      if (url.endsWith('/adoptions')) {
        return json({
          host_name: 'Host Venue',
          collective_name: 'Northside',
          adoptions: [{ item_id: 'item-1', service_id: 'svc-1', service_name: 'Balayage', requested_at: '2026-10-01' }],
        });
      }
      return json(review);
    });

  it('lists the question and answers "Use mine" with the matched options', async () => {
    const fetchMock = fetchFor();
    vi.stubGlobal('fetch', fetchMock);
    const onAnswered = vi.fn();
    render(<AdoptionRequests collectiveId="collective-1" initialItemId={null} onAnswered={onAnswered} />);
    const user = userEvent.setup();
    expect(await screen.findByText('Host Venue wants to use your Balayage')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose' }));
    expect(await screen.findByRole('combobox', { name: "Host Venue's option for Short" })).toHaveValue('host-short');
    await user.click(screen.getByRole('button', { name: 'Use my Balayage' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/api/venue/collectives/collective-1/adoptions/item-1');
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      choice: 'use_mine',
      option_map: [{ my_variant_id: 'my-short', host_variant_id: 'host-short' }],
    });
  });

  it('opens straight away from the email link, and keeps separate on request', async () => {
    const fetchMock = fetchFor();
    vi.stubGlobal('fetch', fetchMock);
    render(<AdoptionRequests collectiveId="collective-1" initialItemId="item-1" onAnswered={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Keep mine separate' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(true));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ choice: 'keep_separate' });
  });

  it('says so when the question was already answered', async () => {
    vi.stubGlobal(
      'fetch',
      fetchFor(json({ error: 'This has already been answered. Reload to see where things stand.' }, 409)),
    );
    render(<AdoptionRequests collectiveId="collective-1" initialItemId="item-1" onAnswered={vi.fn()} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Keep mine separate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This has already been answered.');
  });
});
