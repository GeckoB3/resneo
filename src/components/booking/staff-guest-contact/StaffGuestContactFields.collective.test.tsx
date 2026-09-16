/** @vitest-environment happy-dom */
/**
 * The staff form's contact picker inside a live collective (D41; UX spec `staff.contact.ownerLine`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StaffGuestContactFields } from './StaffGuestContactFields';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const row = (id: string, first: string, owner: string, self: boolean) => ({
  id,
  first_name: first,
  last_name: 'Byron',
  email: `${id}@x.test`,
  phone: null,
  tags: [],
  visit_count: 0,
  no_show_count: 0,
  last_visit_date: null,
  created_at: '2026-01-01',
  total_bookings: 0,
  owner_venue_id: owner,
  owner_venue_name: owner === 'bloom' ? 'Bloom' : 'Zen Studio',
  owner_is_self: self,
});

const show = (scope: 'venue' | 'collective') =>
  render(
    <StaffGuestContactFields
      values={{ firstName: '', lastName: '', email: '', phone: '' }}
      onFieldChange={vi.fn()}
      phoneDefaultCountry="GB"
      searchScope={scope}
    />,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StaffGuestContactFields in a collective', () => {
  it("searches the collective and names another venue's client", async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ guests: [row('g-1', 'Ada', 'bloom', false), row('g-2', 'Adam', 'zen', true)] }));
    vi.stubGlobal('fetch', fetchMock);
    show('collective');
    const user = userEvent.setup();
    const box = document.getElementById('staff-guest-search') as HTMLInputElement;
    await user.click(box);
    await user.type(box, 'ada');
    expect(await screen.findByText("Bloom's client")).toBeInTheDocument();
    expect(screen.queryByText("Zen Studio's client")).not.toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain('scope=collective');
  });

  it('falls back to its own clients when the collective scope is refused', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('scope=collective') ? json({ error: 'no' }, 403) : json({ guests: [row('g-2', 'Adam', 'zen', true)] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    show('collective');
    const user = userEvent.setup();
    const box = document.getElementById('staff-guest-search') as HTMLInputElement;
    await user.click(box);
    await user.type(box, 'ada');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).not.toContain('scope=');
    expect(await screen.findByText(/Adam/)).toBeInTheDocument();
  });

  it('searches only this venue otherwise', async () => {
    const fetchMock = vi.fn(async (_url: string) => json({ guests: [] }));
    vi.stubGlobal('fetch', fetchMock);
    show('venue');
    const user = userEvent.setup();
    const box = document.getElementById('staff-guest-search') as HTMLInputElement;
    await user.click(box);
    await user.type(box, 'ada');
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('scope=');
  });
});
