/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StaffServiceOverrideModal } from './StaffServiceOverrideModal';

/** CSA-08: a calendar's own values can be set from that calendar, for that calendar only. */

const service = {
  id: 'svc-1',
  name: 'Cut',
  description: null,
  duration_minutes: 30,
  buffer_minutes: 0,
  price_pence: 2500,
  deposit_pence: null,
  colour: '#3B82F6',
  staff_may_customize_price: true,
};

let bodies: Array<Record<string, unknown>>;

beforeEach(() => {
  bodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return { ok: true, json: async () => ({ success: true }) } as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('StaffServiceOverrideModal opened from a calendar', () => {
  it('names the service and calendar, and always sends that calendar', async () => {
    const onSaved = vi.fn();
    render(
      <StaffServiceOverrideModal
        open
        onClose={() => {}}
        onSaved={onSaved}
        service={service}
        link={null}
        calendar={{ id: 'cal-sam', name: 'Sam' }}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Cut on Sam' })).toBeInTheDocument();
    expect(screen.getByText(/These values apply to Sam only/)).toBeInTheDocument();
    // One calendar is fixed, so there is no calendar picker.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(bodies[0]).toMatchObject({ service_id: 'svc-1', calendar_id: 'cal-sam' });
  });
});
