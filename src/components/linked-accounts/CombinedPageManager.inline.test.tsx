/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@/components/booking-page-editor/BookingPageEditor', () => ({
  BookingPageEditor: ({ adapter }: { adapter: { addressSlot?: React.ReactNode; publicUrl: string } }) => (
    <div data-testid="page-editor-stub">
      <span data-testid="page-editor-url">{adapter.publicUrl}</span>
      {adapter.addressSlot}
    </div>
  ),
}));
vi.mock('@/components/dashboard/appointment-services/ServiceCategoriesManager', () => ({
  ServiceCategoriesManager: () => null,
}));

import { CombinedPageManager, CombinedPageManagerPanel, CombinedPageMemberSummary } from './CombinedPageManager';
import { catalogueView, collectiveView } from './collective-test-fixtures';

/**
 * The combined page manager, shared by the Linked accounts modal and the
 * Booking Page tab's inline panel (Docs/settings-booking-page-collective-scope-plan.md).
 */
type Call = { url: string; method: string; body: Record<string, unknown> | null };
function installFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null });
      if (url.endsWith('/catalogue')) {
        return { ok: true, status: 200, json: async () => ({ catalogue: catalogueView(), importSources: [] }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('inline panel (host)', () => {
  it('renders the three tabs with no Done button, and stages then saves calendar changes from its own bar', async () => {
    const calls = installFetch();
    const onPendingChange = vi.fn();
    render(
      <CombinedPageManagerPanel
        inline
        collective={collectiveView()}
        eligibleLinks={[]}
        onChanged={vi.fn()}
        onPendingChange={onPendingChange}
      />,
    );
    const tabs = screen.getByRole('tablist', { name: 'Combined page settings' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Page', 'Services & calendars', 'Members']);
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByTestId('combined-page-save-bar')).toBeNull();
    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(0));

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Services & calendars' }));
    const ada = (await screen.findByLabelText('Ada')) as HTMLInputElement;
    expect(ada).not.toBeChecked();
    fireEvent.click(ada);
    expect(ada).toBeChecked();
    // Ada's venue already has the service, so the panel asks (in its own dialog, never
    // window.confirm) whether to link that copy to the original; say yes.
    const prompt = await screen.findByRole('dialog', { name: 'Link it' });
    expect(prompt).toHaveTextContent(/already has a service called/);
    fireEvent.click(within(prompt).getByRole('button', { name: 'Link it' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Link it' })).toBeNull());
    const bar = await screen.findByTestId('combined-page-save-bar');
    expect(within(bar).getByText('1 unsaved calendar change')).toBeInTheDocument();
    expect(onPendingChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(within(bar).getByRole('button', { name: /Save calendar changes/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/venue/collectives/col-1/catalogue');
    expect(patch.body).toEqual({
      action: 'set_providers',
      ops: [{ op: 'add', itemId: 'item-1', venueId: 'v-host', practitionerId: 'cal-h1', sync: true }],
    });
    await waitFor(() => expect(screen.queryByTestId('combined-page-save-bar')).toBeNull());
    expect(onPendingChange).toHaveBeenLastCalledWith(0);
  });

  it('shows the combined page address with a copy button on the Page tab', async () => {
    installFetch();
    render(<CombinedPageManagerPanel inline collective={collectiveView()} eligibleLinks={[]} onChanged={vi.fn()} />);
    const row = await screen.findByTestId('combined-page-address');
    const input = within(row).getByLabelText('Combined page address') as HTMLInputElement;
    await waitFor(() => expect(input.value).toMatch(/\/book\/c\/plus-1$/));
    fireEvent.click(within(row).getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(input.value));
    expect(within(row).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/book/c/plus-1');
  });

  it('shows the adopted member’s address when the page lives there', async () => {
    installFetch();
    render(
      <CombinedPageManagerPanel
        inline
        collective={collectiveView({ slugStrategy: 'adopt_member', adoptedVenueId: 'v-member' })}
        eligibleLinks={[]}
        onChanged={vi.fn()}
      />,
    );
    const row = await screen.findByTestId('combined-page-address');
    await waitFor(() =>
      expect((within(row).getByLabelText('Combined page address') as HTMLInputElement).value).toMatch(/\/book\/light-3$/),
    );
  });
});

describe('modal wrapper', () => {
  it('still opens as a dialog with a Done button', async () => {
    installFetch();
    render(<CombinedPageManager collective={collectiveView()} eligibleLinks={[]} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByText('Combined booking page: Plus 1 Staging')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});

describe('member summary', () => {
  const member = collectiveView({ isHost: false, myVenueId: 'v-member', myMembershipStatus: 'active' });

  it('names the host, shows the address, and lists only this venue’s calendars on the page', async () => {
    installFetch();
    render(<CombinedPageMemberSummary collective={member} />);
    expect(screen.getByText(/Plus 1 hosts Plus 1 Staging/)).toBeInTheDocument();
    expect(await screen.findByText('John')).toBeInTheDocument();
    expect(screen.getByText('Cut')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).toBeNull();
    const row = screen.getByTestId('combined-page-address');
    await waitFor(() =>
      expect((within(row).getByLabelText('Combined page address') as HTMLInputElement).value).toMatch(/\/book\/c\/plus-1$/),
    );
    expect(screen.getByRole('link', { name: 'Linked accounts' })).toHaveAttribute('href', '/dashboard/settings?tab=linked-accounts');
    // No host controls anywhere.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('says so when none of this venue’s calendars is offered', async () => {
    installFetch();
    render(<CombinedPageMemberSummary collective={collectiveView({ isHost: false, myVenueId: 'v-other' })} />);
    expect(await screen.findByText(/None of your calendars is offered/)).toBeInTheDocument();
  });
});
