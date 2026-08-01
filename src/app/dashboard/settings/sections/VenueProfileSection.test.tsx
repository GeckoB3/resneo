/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VenueProfileSection } from './VenueProfileSection';
import type { VenueSettings } from '../types';

/**
 * Regression cover for the silent-autosave bug: the card saves on a debounce
 * rather than on submit, so a failed `safeParse` used to `return` with no
 * `setError`, no toast and no change to the save indicator. One bad field froze
 * saving for the entire card while the user believed their edits were stored.
 */

const reportMock = vi.hoisted(() => vi.fn());

vi.mock('../SettingsSaveContext', () => ({
  useSettingsSave: () => ({ report: reportMock, clear: vi.fn(), banner: { status: 'idle', message: null } }),
}));

const venue = {
  id: 'venue-1',
  name: 'Sharps Barbers',
  slug: 'sharps-barbers',
  address: '12 Main Street, Belfast, BT1 1AA',
  phone: '+442890000000',
  email: 'hello@sharps.example',
  website_url: '',
  cover_photo_url: null,
  logo_url: null,
  cuisine_type: null,
  price_band: null,
  no_show_grace_minutes: 15,
  kitchen_email: null,
  communication_templates: null,
  opening_hours: null,
  booking_rules: null,
  deposit_config: null,
  availability_config: null,
  stripe_connected_account_id: null,
  timezone: 'Europe/London',
  pricing_tier: 'appointments',
} as unknown as VenueSettings;

function renderSection() {
  const onUpdate = vi.fn();
  const utils = render(<VenueProfileSection venue={venue} onUpdate={onUpdate} isAdmin />);
  return { onUpdate, ...utils };
}

describe('VenueProfileSection autosave validation', () => {
  beforeEach(() => {
    reportMock.mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ...venue, address: venue.address }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows an inline error and reports a not-saved status when a field is invalid', async () => {
    const user = userEvent.setup();
    renderSection();

    // Clearing the required Name makes the whole card fail to parse.
    const name = screen.getByLabelText('Name');
    await user.clear(name);

    await waitFor(
      () => expect(screen.getByText('Name is required')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    expect(reportMock).toHaveBeenCalledWith({
      status: 'error',
      message: 'Not saved. Check the highlighted fields.',
    });
  });

  it('does not PATCH while the form is invalid', async () => {
    const user = userEvent.setup();
    renderSection();

    const name = screen.getByLabelText('Name');
    await user.clear(name);

    await waitFor(
      () => expect(screen.getByText('Name is required')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const patches = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(0);
  });

  it('clears the error and saves once the field is fixed', async () => {
    const user = userEvent.setup();
    renderSection();

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await waitFor(
      () => expect(screen.getByText('Name is required')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    await user.type(name, 'Sharps Barbers Ltd');

    await waitFor(
      () => expect(screen.queryByText('Name is required')).not.toBeInTheDocument(),
      { timeout: 3000 },
    );

    await waitFor(
      () =>
        expect(
          (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
            (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
          ),
        ).toBe(true),
      { timeout: 3000 },
    );
  });

  it('does not flag pre-existing invalid data before the user edits anything', async () => {
    const badVenue = { ...venue, phone: 'not-a-phone' } as VenueSettings;
    render(<VenueProfileSection venue={badVenue} onUpdate={vi.fn()} isAdmin />);

    // Give the 850ms debounce room to fire.
    await new Promise((r) => setTimeout(r, 1200));

    expect(screen.queryByText('Enter a valid phone number')).not.toBeInTheDocument();
    expect(reportMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });
});
