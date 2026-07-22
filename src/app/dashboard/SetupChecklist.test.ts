import { describe, expect, it } from 'vitest';
import { getSteps, isStepComplete } from './SetupChecklist';
import type { SetupStatus } from '@/lib/venue/compute-setup-status';

function makeStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    setup_checklist_dismissed: false,
    onboarding_completed: true,
    pricing_tier: 'appointments',
    profile_complete: true,
    availability_set: true,
    guest_booking_ready: true,
    stripe_connected: false,
    first_booking_made: false,
    is_admin: true,
    booking_model: 'unified_scheduling',
    active_booking_models: ['unified_scheduling'],
    enabled_models: [],
    secondary_event_catalog_ready: true,
    secondary_class_catalog_ready: true,
    secondary_resource_catalog_ready: true,
    ...overrides,
  };
}

const SUGGESTION_HREFS = [
  '/dashboard/settings?tab=booking-page',
  '/dashboard/settings?tab=comms',
  '/dashboard/settings',
];

describe('getSteps optional suggestions', () => {
  it('adds the three optional suggestions after onboarding is complete', () => {
    const steps = getSteps(makeStatus({ onboarding_completed: true }));
    const optional = steps.filter((s) => s.optional);
    expect(optional.map((s) => s.href)).toEqual(SUGGESTION_HREFS);
    expect(optional.map((s) => s.label)).toEqual([
      'Customise your booking page',
      'Review communications settings',
      'Import your bookings and customers',
    ]);
  });

  it('omits the suggestions before onboarding is complete', () => {
    const steps = getSteps(makeStatus({ onboarding_completed: false }));
    expect(steps.some((s) => s.optional)).toBe(false);
  });

  it('lists the suggestions after the required steps', () => {
    const steps = getSteps(makeStatus());
    const firstOptionalIndex = steps.findIndex((s) => s.optional);
    const lastRequiredIndex = steps.reduce((acc, s, i) => (s.optional ? acc : i), -1);
    expect(firstOptionalIndex).toBeGreaterThan(lastRequiredIndex);
  });
});

describe('isStepComplete', () => {
  it('never treats an optional suggestion as complete', () => {
    const status = makeStatus();
    const optional = getSteps(status).filter((s) => s.optional);
    for (const step of optional) {
      expect(isStepComplete(status, step)).toBe(false);
    }
  });

  it('reads the matching SetupStatus flag for a trackable step', () => {
    const step = { key: 'stripe_connected', label: '', description: '', href: '', actionLabel: '' };
    expect(isStepComplete(makeStatus({ stripe_connected: true }), step)).toBe(true);
    expect(isStepComplete(makeStatus({ stripe_connected: false }), step)).toBe(false);
  });
});
