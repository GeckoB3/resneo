/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeatureFlagsSection } from './FeatureFlagsSection';
import {
  DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
  type ResolvedAppointmentsFeatureFlags,
  type VenueFeatureFlags,
} from '@/lib/feature-flags';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/app/dashboard/DashboardShell', () => ({
  useDashboardWaitlistNavSync: () => null,
}));

interface PatchCall {
  body: VenueFeatureFlags;
}

/**
 * Stands in for `/api/venue/feature-flags`, resolving a PATCH the way the real
 * route does: flags stored as `true`, absent when off.
 */
function installFlagsApi(initialRaw: VenueFeatureFlags) {
  const patches: PatchCall[] = [];
  let stored: VenueFeatureFlags = { ...initialRaw };

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    if (!url.includes('/api/venue/feature-flags')) {
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as VenueFeatureFlags;
      patches.push({ body });
      stored = Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== false),
      ) as VenueFeatureFlags;
    }
    const resolved: ResolvedAppointmentsFeatureFlags = {
      ...DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
      ...(Object.fromEntries(
        Object.entries(stored).filter(([, v]) => typeof v === 'boolean'),
      ) as Partial<ResolvedAppointmentsFeatureFlags>),
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({ raw: stored, resolved, calendars: [] }),
    } as unknown as Response;
  });

  return { patches };
}

function renderSection(initialRaw: VenueFeatureFlags = {}) {
  const resolved: ResolvedAppointmentsFeatureFlags = {
    ...DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
    ...(Object.fromEntries(
      Object.entries(initialRaw).filter(([, v]) => typeof v === 'boolean'),
    ) as Partial<ResolvedAppointmentsFeatureFlags>),
  };
  return render(
    <FeatureFlagsSection
      initialRaw={initialRaw}
      initialResolved={resolved}
      onSaved={vi.fn()}
    />,
  );
}

function staffFirstSwitch(): HTMLElement {
  // Each flag renders as a labelled row with its own switch.
  const row = screen.getByText('Staff-first booking').closest('li');
  if (!row) throw new Error('Staff-first booking row not found');
  const toggle = row.querySelector('button[role="switch"]');
  if (!toggle) throw new Error('Staff-first booking switch not found');
  return toggle as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FeatureFlagsSection: staff-first booking', () => {
  it('offers the toggle, off, to a venue that has never set it', () => {
    installFlagsApi({});
    renderSection();

    expect(screen.getByText('Staff-first booking')).toBeInTheDocument();
    expect(staffFirstSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('explains what it does without naming a step id', () => {
    installFlagsApi({});
    renderSection();

    expect(
      screen.getByText(/Guests pick who they want to see first/i),
    ).toBeInTheDocument();
  });

  it('turns it on for this venue and shows it on', async () => {
    const { patches } = installFlagsApi({});
    renderSection();

    fireEvent.click(staffFirstSwitch());

    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0].body.staff_first_booking_flow).toBe(true);
    await waitFor(() => {
      expect(staffFirstSwitch()).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('turns it back off again, which is what stops it being one-way', async () => {
    const { patches } = installFlagsApi({ staff_first_booking_flow: true });
    renderSection({ staff_first_booking_flow: true });

    expect(staffFirstSwitch()).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(staffFirstSwitch());

    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0].body.staff_first_booking_flow).toBe(false);
    await waitFor(() => {
      expect(staffFirstSwitch()).toHaveAttribute('aria-checked', 'false');
    });
  });

  it('leaves the other settings alone when toggling', async () => {
    const { patches } = installFlagsApi({ waitlist_v2: true });
    renderSection({ waitlist_v2: true });

    fireEvent.click(staffFirstSwitch());

    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0].body.waitlist_v2).toBe(true);
  });
});
