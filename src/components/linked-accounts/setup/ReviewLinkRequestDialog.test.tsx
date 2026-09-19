/** @vitest-environment happy-dom */
/**
 * Reviewing a link request with the collective it proposes (Docs/link-and-collective-setup-wizard-plan.md
 * §3.2): one dialog, one consent, three ways out; lowering the grant below full access withdraws the
 * collective part; a plain request is two short steps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewLinkRequestDialog } from './ReviewLinkRequestDialog';
import type { AccountLinkView } from '@/lib/linked-accounts/types';

const addToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast }) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const full = { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null } as const;
const link: AccountLinkView = {
  id: 'l-1',
  status: 'pending',
  otherVenue: { id: 'bloom', name: 'Bloom', slug: 'bloom' },
  initiatedByMe: false,
  iCan: full,
  theyCan: full,
  requestMessage: 'Shall we?',
  pendingChange: null,
  createdAt: '2026-09-19T10:00:00Z',
  respondedAt: null,
  terminatedAt: null,
  terminationReason: null,
};
const collective = { id: 'c-1', name: 'Northside', slug: 'northside', serviceModel: 'replicas' };

const preview = {
  consent_version: 'join-2026-09',
  collective_name: 'Northside',
  host_name: 'Bloom',
  blocked: null,
  services_to_set_up: 0,
  same_name: [],
  own_services: [{ id: 's-1', name: 'Cut and finish' }],
  forms: [],
  warnings: { no_stripe_paid_services: 0, form_services: 0, forms_off: false },
  other_models: null,
  pending_link: true,
};

function stub(respond: () => Response = () => json({ link: {}, collective: { id: 'c-1', name: 'Northside', joined: true } })) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/venue/collectives/c-1/join')) {
        expect(url).toContain('with_pending_link=1');
        return json(preview);
      }
      if (url === '/api/venue/account-links/l-1' && init?.method === 'PATCH') {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return respond();
      }
      return json({});
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ReviewLinkRequestDialog', () => {
  it('walks through the request and the collective, and accepts both in one call', async () => {
    const user = userEvent.setup();
    const calls = stub();
    const onDone = vi.fn();
    render(<ReviewLinkRequestDialog link={link} venueName="Zen Studio" myCalendars={[]} collective={collective} onClose={vi.fn()} onDone={onDone} />);

    expect(screen.getByText('Bloom wants to link with you and start Northside')).toBeInTheDocument();
    expect(screen.getByText(/Shall we\?/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('What joining means')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Your services')).toBeInTheDocument();
    expect(screen.getByText('Cut and finish')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check and accept')).toBeInTheDocument();

    const accept = screen.getByRole('button', { name: 'Accept and join Northside' });
    expect(accept).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /I understand what Bloom will be able to see and do, and that Zen Studio joins Northside/ }));
    await user.click(accept);

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ declined: false, joined: true, collectiveName: 'Northside', joinError: undefined }));
    // The receipt stays open and says what happens next: the host sets the page up, nothing is needed yet.
    expect(screen.getByRole('heading', { name: 'You are linked with Bloom and part of Northside' })).toBeInTheDocument();
    expect(screen.getByText(/Bloom is now setting up the services and the shared booking page/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({
      action: 'accept',
      collective: {
        collective_id: 'c-1',
        consent_version: 'join-2026-09',
        same_name_choices: [],
        own_service_choices: [{ service_id: 's-1', choice: 'park' }],
        form_choices: [],
      },
    });
  });

  it('can accept the link only, leaving the invitation open', async () => {
    const user = userEvent.setup();
    const calls = stub(() => json({ link: {}, collective: null }));
    const onDone = vi.fn();
    render(<ReviewLinkRequestDialog link={link} venueName="Zen Studio" myCalendars={[]} collective={collective} onClose={vi.fn()} onDone={onDone} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Accept the link only' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({ action: 'accept' });
  });

  it('withdraws the collective part when the venue lowers what it grants', async () => {
    const user = userEvent.setup();
    const calls = stub(() => json({ link: {}, collective: null }));
    render(<ReviewLinkRequestDialog link={link} venueName="Zen Studio" myCalendars={[]} collective={collective} onClose={vi.fn()} onDone={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Adjust permissions' }));
    const actions = screen.getAllByLabelText('Booking actions');
    await user.selectOptions(actions[0]!, 'edit_existing');
    expect(screen.getByText(/Joining Northside needs full access both ways/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check and accept')).toBeInTheDocument();
    expect(screen.queryByText('What joining means')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.action).toBe('accept_with_changes');
    expect(calls[0]!.body.collective).toBeUndefined();
  });

  it('a plain request is two steps and accepts without a collective', async () => {
    const user = userEvent.setup();
    const calls = stub(() => json({ link: {}, collective: null }));
    const onDone = vi.fn();
    render(<ReviewLinkRequestDialog link={link} venueName="Zen Studio" myCalendars={[]} collective={null} onClose={vi.fn()} onDone={onDone} />);
    expect(screen.getByText('Bloom wants to link with you')).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ declined: false, joined: false, collectiveName: null, joinError: undefined }));
    expect(calls[0]!.body).toEqual({ action: 'accept' });
  });

  it('declining asks first, then rejects the request', async () => {
    const user = userEvent.setup();
    const calls = stub(() => json({ link: {} }));
    const onDone = vi.fn();
    render(<ReviewLinkRequestDialog link={link} venueName="Zen Studio" myCalendars={[]} collective={collective} onClose={vi.fn()} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByText(/No link is made and the invitation to Northside closes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Decline request' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ declined: true, joined: false, collectiveName: 'Northside' }));
    expect(calls[0]!.body).toEqual({ action: 'reject' });
  });
});
