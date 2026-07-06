/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render, screen } from '@testing-library/react';
import {
  VenueFeatureFlagsProvider,
  useAppointmentsFeatureFlag,
  useUpdateVenueFeatureFlags,
} from './VenueFeatureFlagsProvider';
import {
  DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
  type ResolvedAppointmentsFeatureFlags,
} from '@/lib/feature-flags';

const flagsWith = (
  overrides: Partial<ResolvedAppointmentsFeatureFlags>,
): ResolvedAppointmentsFeatureFlags => ({
  ...DEFAULT_RESOLVED_APPOINTMENTS_FEATURE_FLAGS,
  ...overrides,
});

function CardHoldFlagProbe() {
  const enabled = useAppointmentsFeatureFlag('card_hold_deposits');
  return <p>card holds: {enabled ? 'on' : 'off'}</p>;
}

function UpdaterProbe({ next }: { next: ResolvedAppointmentsFeatureFlags }) {
  const update = useUpdateVenueFeatureFlags();
  return (
    <button type="button" onClick={() => update?.(next)}>
      save flags
    </button>
  );
}

describe('VenueFeatureFlagsProvider', () => {
  it('serves the server-supplied flags', () => {
    render(
      <VenueFeatureFlagsProvider flags={flagsWith({ card_hold_deposits: true })}>
        <CardHoldFlagProbe />
      </VenueFeatureFlagsProvider>,
    );
    expect(screen.getByText('card holds: on')).toBeInTheDocument();
  });

  it('reflects an in-session update immediately (settings toggle, no refresh)', () => {
    render(
      <VenueFeatureFlagsProvider flags={flagsWith({ card_hold_deposits: false })}>
        <CardHoldFlagProbe />
        <UpdaterProbe next={flagsWith({ card_hold_deposits: true })} />
      </VenueFeatureFlagsProvider>,
    );
    expect(screen.getByText('card holds: off')).toBeInTheDocument();

    act(() => {
      screen.getByRole('button', { name: 'save flags' }).click();
    });

    expect(screen.getByText('card holds: on')).toBeInTheDocument();
  });

  it('adopts fresh server flags on a re-render (router.refresh)', () => {
    const { rerender } = render(
      <VenueFeatureFlagsProvider flags={flagsWith({ card_hold_deposits: false })}>
        <CardHoldFlagProbe />
      </VenueFeatureFlagsProvider>,
    );
    expect(screen.getByText('card holds: off')).toBeInTheDocument();

    rerender(
      <VenueFeatureFlagsProvider flags={flagsWith({ card_hold_deposits: true })}>
        <CardHoldFlagProbe />
      </VenueFeatureFlagsProvider>,
    );
    expect(screen.getByText('card holds: on')).toBeInTheDocument();
  });

  it('returns null from the updater hook outside the provider', () => {
    function OutsideProbe() {
      const update = useUpdateVenueFeatureFlags();
      return <p>{update === null ? 'no updater' : 'has updater'}</p>;
    }
    render(<OutsideProbe />);
    expect(screen.getByText('no updater')).toBeInTheDocument();
  });
});
