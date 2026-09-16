/** @vitest-environment happy-dom */
/**
 * UI-C-01: creating a collective. Every refusal from the create route renders inside the wizard,
 * with a way back to the step it belongs to; blocked venues are listed with their reason; nothing
 * is created until the host has read what changes; and success is a receipt, not a closed dialog.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCollectiveDialog } from './CreateCollectiveDialog';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const addToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast }) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const candidates = [
  { venue_id: 'v-ok', venue_name: 'Bloom', venue_slug: 'bloom', link_id: 'l1', standing: 'ok', reason: null, detail: null },
  {
    venue_id: 'v-pay',
    venue_name: 'Cedar',
    venue_slug: 'cedar',
    link_id: 'l2',
    standing: 'no_payments',
    reason: 'Cedar has not connected Stripe. It can join, but guests cannot book its calendars online for services that take a payment.',
    detail: null,
  },
  {
    venue_id: 'v-eur',
    venue_name: 'Dublin Spa',
    venue_slug: 'dublin',
    link_id: 'l3',
    standing: 'blocked',
    reason: 'Uses EUR, not GBP',
    detail: 'Dublin Spa takes payment in EUR and the collective uses GBP. Every venue in a collective has to use the same currency.',
  },
  {
    venue_id: 'v-perm',
    venue_name: 'Elm',
    venue_slug: 'elm',
    link_id: 'l4',
    standing: 'permissions',
    reason: 'Your link with Elm does not share full calendar details yet.',
    detail: null,
  },
];

function stub(create: () => Response, slugAvailable = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue/collectives/slug-available')) return json({ available: slugAvailable });
    if (url === '/api/venue/collectives/candidates') return json({ candidates, host_slug: 'zen' });
    if (url === '/api/venue/collectives' && init?.method === 'POST') return create();
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const show = (onCreated = vi.fn(), onClose = vi.fn()) => {
  render(<CreateCollectiveDialog venueName="Zen Studio" onClose={onClose} onCreated={onCreated} />);
  return { onCreated, onClose };
};

/** Name it, pick Bloom, acknowledge, and arrive at step 4. */
async function reachCheck(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Collective name'), 'Northside');
  await waitFor(() => expect(screen.getByText('This address is free.')).toBeInTheDocument(), { timeout: 2000 });
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Bloom' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('checkbox', { name: /I understand what changes for Zen Studio/ }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  addToast.mockClear();
});

describe('CreateCollectiveDialog', () => {
  it('explains the host role and waits for a free address before going on', async () => {
    stub(() => json({}), false);
    show();
    const user = userEvent.setup();
    expect(screen.getByText('Zen Studio will be the host.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await user.type(screen.getByLabelText('Collective name'), 'Northside');
    expect(await screen.findByText('That address is taken. Try another.', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('Choose a free address to continue.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('lists every linked venue, with why it cannot join', async () => {
    stub(() => json({}));
    show();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Collective name'), 'Northside');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('checkbox', { name: 'Bloom' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Cedar' })).toBeEnabled();
    expect(screen.getByText('No card payments')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Dublin Spa' })).toBeDisabled();
    expect(screen.getByText('Uses EUR, not GBP')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Elm' })).toBeDisabled();
    expect(screen.getByRole('link', { name: "Change the link's permissions" })).toBeInTheDocument();
    expect(screen.getAllByText('Cannot join yet')).toHaveLength(2);
  });

  it('shows every address that will lead to the page, and needs the acknowledgement', async () => {
    stub(() => json({}));
    show();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Collective name'), 'Northside');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Bloom' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('/book/zen')).toBeInTheDocument();
    expect(screen.getByText('/book/bloom')).toBeInTheDocument();
    expect(screen.getAllByText('/book/c/northside')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  const refusals: [string, string, string | null][] = [
    ['plan', 'New links cannot be created while your subscription is inactive.', null],
    ['name', 'Please check the name and address.', 'Change the name or address'],
    ['collective', 'Your venue is already in a collective.', null],
    ['venues', 'Invite at least one other linked venue.', 'Change the venues'],
    ['venues', 'Bloom is already part of another collective, so it cannot be invited until it leaves.', 'Change the venues'],
    ['slug', 'That booking-page address is already in use. Choose another.', 'Change the name or address'],
    ['name', 'A collective with that name already exists. Choose another.', 'Change the name or address'],
    ['name', 'That name isn’t available yet. Please choose another.', 'Change the name or address'],
    ['venues', 'All members must share the same timezone to run a combined page.', 'Change the venues'],
  ];

  it.each(refusals)('shows the %s refusal "%s" in the wizard', async (field, message, back) => {
    stub(() => json({ error: message, field }, field === 'plan' ? 403 : 409));
    const { onCreated } = show();
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Create and send invitations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onCreated).not.toHaveBeenCalled();
    if (back) {
      await user.click(screen.getByRole('button', { name: back }));
      expect(screen.getByText('Step ' + (field === 'venues' ? '2' : '1') + ' of 4')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    } else {
      expect(screen.queryByRole('button', { name: /Change the/ })).not.toBeInTheDocument();
    }
  });

  it('shows a server failure in the wizard too', async () => {
    stub(() => json({ error: 'Failed to create collective.' }, 500));
    show();
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Create and send invitations' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to create collective.');
  });

  it('ends on a receipt with the address and what to do next', async () => {
    const fetchMock = stub(() => json({ collective: { id: 'c-1' } }, 201));
    const { onCreated, onClose } = show();
    const user = userEvent.setup();
    await reachCheck(user);
    await user.click(screen.getByRole('button', { name: 'Create and send invitations' }));
    expect((await screen.findAllByText('Northside is created')).length).toBeGreaterThan(0);
    expect(onCreated).toHaveBeenCalledWith({ collective: { id: 'c-1' } });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/\/book\/c\/northside$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Put services on the page' })).toHaveAttribute('href', '/dashboard/appointment-services');
    expect(addToast).toHaveBeenCalledWith('Northside created. Invitations sent to Bloom.', 'success');
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'Northside', slug: 'northside', inviteVenueIds: ['v-ok'] });
  });
});
