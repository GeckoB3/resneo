/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VenueSlugField } from './VenueSlugField';
import type { VenueSettings } from '../types';

/**
 * Regression cover for the silent-non-save bug: an address with spaces or
 * capitals fails the schema, but the hint effect only reset `slugHint` to
 * 'idle' and the autosave `return`ed without calling `setError`, so the field
 * said nothing at all while quietly never saving.
 */

const venue = {
  id: 'venue-1',
  name: 'Sharps Barbers',
  slug: 'sharps-barbers',
  address: null,
  phone: null,
  email: null,
  website_url: null,
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

function renderField() {
  const report = vi.fn();
  const onUpdate = vi.fn();
  render(
    <VenueSlugField
      venue={venue}
      onUpdate={onUpdate}
      isAdmin
      reporter={{ report, clear: vi.fn() } as never}
    />,
  );
  return { report, onUpdate };
}

describe('VenueSlugField autosave validation', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('slug-available')) {
          return new Response(JSON.stringify({ available: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ slug: 'sharps-barbers' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('surfaces the format rule when the address has capitals or spaces', async () => {
    const user = userEvent.setup();
    const { report } = renderField();

    const input = screen.getByLabelText('Booking page address');
    await user.clear(input);
    await user.type(input, 'Sharps Barbers');

    await waitFor(
      () =>
        expect(screen.getByText('Lowercase letters, numbers and hyphens only')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('does not PATCH while the address is invalid', async () => {
    const user = userEvent.setup();
    renderField();

    const input = screen.getByLabelText('Booking page address');
    await user.clear(input);
    await user.type(input, 'Sharps Barbers');

    await waitFor(
      () =>
        expect(screen.getByText('Lowercase letters, numbers and hyphens only')).toBeInTheDocument(),
      { timeout: 3000 },
    );

    const patches = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patches).toHaveLength(0);
  });

  it('reports the required rule when the address is cleared', async () => {
    const user = userEvent.setup();
    renderField();

    const input = screen.getByLabelText('Booking page address');
    await user.clear(input);

    await waitFor(
      () => expect(screen.getByText('Booking page address is required')).toBeInTheDocument(),
      { timeout: 3000 },
    );
  });

  it('saves once a valid address is typed', async () => {
    const user = userEvent.setup();
    renderField();

    const input = screen.getByLabelText('Booking page address');
    await user.clear(input);
    await user.type(input, 'sharps-barbers-belfast');

    await waitFor(
      () =>
        expect(
          (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(
            (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
          ),
        ).toBe(true),
      { timeout: 3000 },
    );

    expect(
      screen.queryByText('Lowercase letters, numbers and hyphens only'),
    ).not.toBeInTheDocument();
  });
});
