/** @vitest-environment happy-dom */
/**
 * Joining a shared-services collective (UX spec `join.*`; plan contract 6).
 *
 * The venue reads what joining means, answers for its services and forms, and cannot join until it
 * has ticked the consent; the answers it gave are the ones sent.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JoinCollectiveDialog } from './JoinCollectiveDialog';
import type { JoinPreview } from '@/lib/linked-accounts/replicas/join';

const preview: JoinPreview = {
  consent_version: 'join-2026-09',
  collective_name: 'Northside',
  host_name: 'Host Venue',
  blocked: null,
  services_to_set_up: 3,
  same_name: [
    {
      item_id: 'item-cut',
      host_service_id: 'master-cut',
      name: 'Haircut',
      my_service_id: 'mine-cut',
      my_options: [
        { id: 'my-short', name: 'Short' },
        { id: 'my-long', name: 'Extra long' },
      ],
      host_options: [
        { id: 'host-short', name: 'short' },
        { id: 'host-long', name: 'Long' },
      ],
    },
  ],
  own_services: [{ id: 'mine-nails', name: 'Nails' }],
  forms: [{ host_type_id: 'host-patch', name: 'Patch test', my_type_id: 'my-patch' }],
  warnings: { no_stripe_paid_services: 2, form_services: 1, forms_off: true },
  other_models: null,
};

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PATCH'
      ? new Response('{}', { status: 200 })
      : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const show = (onJoined = vi.fn()) => {
  render(
    <JoinCollectiveDialog open collectiveId="collective-1" venueName="Zen Studio" onClose={vi.fn()} onJoined={onJoined} />,
  );
  return onJoined;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JoinCollectiveDialog', () => {
  it('explains what joining means, with the warnings that apply', async () => {
    stubFetch(preview);
    show();
    expect(await screen.findByText('What joining means')).toBeInTheDocument();
    expect(screen.getByText(/Clients pay you, through your own Stripe account/)).toBeInTheDocument();
    expect(screen.getByText(/You have not connected Stripe. 2 services/)).toBeInTheDocument();
    expect(screen.getByText(/Some services ask for forms/)).toBeInTheDocument();
  });

  it('says before accepting that other booking types stay on the own page (BM-03)', async () => {
    stubFetch({ ...preview, other_models: 'classes and bookable rooms' });
    show();
    expect(
      await screen.findByText(
        'You also run classes and bookable rooms. Those stay on your own booking page and are not shown on the Northside page.',
      ),
    ).toBeInTheDocument();
  });

  it('says nothing of other booking types for an appointments-only venue', async () => {
    stubFetch(preview);
    show();
    await screen.findByText('What joining means');
    expect(screen.queryByText(/You also run/)).not.toBeInTheDocument();
  });

  it('shows why the venue cannot join, with no way to go on', async () => {
    stubFetch({ ...preview, blocked: 'You cannot join because your venue uses EUR and Northside uses GBP.' });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('your venue uses EUR');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('cannot join until the consent is ticked, then sends the answers given', async () => {
    const fetchMock = stubFetch(preview);
    const onJoined = show();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Next' }));
    // Options match by name by default; an unmatched one keeps its bookings only.
    expect(screen.getByRole('combobox', { name: "Host Venue's option for Short" })).toHaveValue('host-short');
    expect(screen.getByRole('combobox', { name: "Host Venue's option for Extra long" })).toHaveValue('');
    await user.selectOptions(screen.getByRole('combobox', { name: "Host Venue's option for Extra long" }), 'host-long');
    await user.selectOptions(screen.getByRole('combobox', { name: 'What happens to Nails' }), 'ask');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: "Use Host Venue's version as a separate form" }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('3 services from Host Venue will be set up in your account.')).toBeInTheDocument();
    expect(screen.getByText('Host Venue will be asked to add 1 of your services.')).toBeInTheDocument();
    const join = screen.getByRole('button', { name: 'Join Northside' });
    expect(join).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(join);

    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    const patch = fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/venue/collectives/collective-1/members');
    expect(JSON.parse(patch[1]!.body as string)).toEqual({
      action: 'accept',
      consent_version: 'join-2026-09',
      same_name_choices: [
        {
          item_id: 'item-cut',
          choice: 'use_mine',
          my_service_id: 'mine-cut',
          option_map: [
            { my_variant_id: 'my-short', host_variant_id: 'host-short' },
            { my_variant_id: 'my-long', host_variant_id: 'host-long' },
          ],
        },
      ],
      own_service_choices: [{ service_id: 'mine-nails', choice: 'ask' }],
      form_choices: [{ host_type_id: 'host-patch', choice: 'use_theirs' }],
    });
  });

  it("adds the host's service as new when asked, and skips the forms step when none match", async () => {
    const fetchMock = stubFetch({ ...preview, forms: [] });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: "Add Host Venue's as a new service" }));
    expect(screen.queryByRole('combobox', { name: /option for Short/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Join Northside' }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'PATCH')).toBe(true));
    const body = JSON.parse(fetchMock.mock.calls.find((c) => c[1]?.method === 'PATCH')![1]!.body as string);
    expect(body.same_name_choices).toEqual([{ item_id: 'item-cut', choice: 'add_new' }]);
    expect(body.own_service_choices).toEqual([{ service_id: 'mine-nails', choice: 'park' }]);
  });

  it('keeps the dialog open and says so when the join is refused', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Response(JSON.stringify({ error: 'This invitation is no longer open.' }), { status: 409 })
        : new Response(JSON.stringify({ ...preview, forms: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onJoined = show();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Join Northside' }));
    expect(await screen.findByText('This invitation is no longer open.')).toBeInTheDocument();
    expect(onJoined).not.toHaveBeenCalled();
  });
});
