/** @vitest-environment happy-dom */
/**
 * Link with a venue (Docs/link-and-collective-setup-wizard-plan.md §3.1): the collective step appears
 * only at full access both ways and only for a venue that can join; one call carries the link and the
 * collective; a refusal is shown with a way back; a plain link skips the collective steps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkSetupWizard } from './LinkSetupWizard';

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

function stub(opts: {
  standing?: { standing: string; reason: string | null; detail: string | null };
  setup?: () => Response;
}) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/venue/account-links/search')) return json({ results: [{ name: 'Bloom', slug: 'bloom', eligible: true }] });
    if (url.startsWith('/api/venue/account-links/lookup')) {
      return json({
        found: true,
        eligible: true,
        alreadyLinked: false,
        name: 'Bloom',
        slug: 'bloom',
        reason: null,
        collective: opts.standing ?? { standing: 'ok', reason: null, detail: null },
      });
    }
    if (url.startsWith('/api/venue/collectives/slug-available')) return json({ available: true });
    if (url === '/api/venue/account-links/setup' && init?.method === 'POST') {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return opts.setup ? opts.setup() : json({ link: { id: 'l-1' }, collective: null }, 201);
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const show = () => {
  const onSent = vi.fn();
  render(<LinkSetupWizard venueName="Zen Studio" venueSlug="zen" myCalendars={[]} onClose={vi.fn()} onSent={onSent} />);
  return onSent;
};

async function chooseBloom(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('combobox'), 'Blo');
  await user.click(within(await screen.findByRole('option', { name: /Bloom/ })).getByRole('button'));
  await screen.findByRole('button', { name: 'Change' });
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LinkSetupWizard', () => {
  it('offers the collective at full access, and sends the link and the collective in one call', async () => {
    const user = userEvent.setup();
    const calls = stub({ setup: () => json({ link: { id: 'l-1' }, collective: { id: 'c-1', name: 'Northside', slug: 'northside' } }, 201) });
    const onSent = show();

    await chooseBloom(user);
    // Full access is the default level, so the collective question follows.
    expect(screen.getByRole('radio', { name: /Work as one team/ })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Share one booking page?')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Also start a collective/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await user.type(screen.getByLabelText('Collective name'), 'Northside');
    await waitFor(() => expect(screen.getByText('This address is free.')).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('checkbox', { name: /I understand what changes for Zen Studio/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Check and send')).toBeInTheDocument();
    expect(screen.getByText('Northside, at /book/c/northside')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(calls[0]!.body).toEqual({
      targetSlug: 'bloom',
      grants: {
        mine: { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null },
        theirs: { calendar: 'full_details', pii: true, act: 'create_edit_cancel', calendarIds: null },
      },
      collective: { name: 'Northside', slug: 'northside' },
    });
    expect(screen.getByRole('heading', { name: 'Request sent to Bloom' })).toBeInTheDocument();
    expect(screen.getByText(/they join Northside and a banner on your dashboard/)).toBeInTheDocument();
  });

  it('skips the collective question below full access and sends a plain link', async () => {
    const user = userEvent.setup();
    const calls = stub({});
    show();
    await chooseBloom(user);
    await user.click(screen.getByRole('radio', { name: /See each other's diaries/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Check and send')).toBeInTheDocument();
    expect(screen.queryByText('Collective')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.collective).toBeUndefined();
    expect((calls[0]!.body as { grants: { mine: { act: string } } }).grants.mine.act).toBe('none');
  });

  it('does not offer a collective to a venue that cannot join, and says why on the check step', async () => {
    const user = userEvent.setup();
    stub({ standing: { standing: 'blocked', reason: 'Uses EUR, not GBP', detail: null } });
    show();
    await chooseBloom(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('Check and send')).toBeInTheDocument();
    expect(screen.queryByText('Share one booking page?')).not.toBeInTheDocument();
  });

  it('shows a refusal on the check step with a way back to the step it belongs to', async () => {
    const user = userEvent.setup();
    stub({ setup: () => json({ error: 'That booking-page address is already in use. Choose another.', field: 'slug' }, 409) });
    show();
    await chooseBloom(user);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('radio', { name: /Also start a collective/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Collective name'), 'Northside');
    await waitFor(() => expect(screen.getByText('This address is free.')).toBeInTheDocument(), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('checkbox', { name: /I understand what changes/ }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That booking-page address is already in use.');
    await user.click(screen.getByRole('button', { name: 'Go back and change it' }));
    expect(screen.getByLabelText('Collective name')).toBeInTheDocument();
  });
});
