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

const SUGGESTION_KEYS = ['customise_booking_page', 'review_comms', 'import_bookings_customers'];

describe('getSteps post-onboarding prompts', () => {
  it('adds the three prompts after onboarding is complete', () => {
    const steps = getSteps(makeStatus({ onboarding_completed: true }));
    const suggestions = steps.filter((s) => SUGGESTION_KEYS.includes(s.key));
    expect(suggestions.map((s) => s.label)).toEqual([
      'Customise your booking page',
      'Review communications settings',
      'Import your bookings and customers',
    ]);
    expect(suggestions.map((s) => s.href)).toEqual([
      '/dashboard/settings?tab=booking-page',
      '/dashboard/settings?tab=comms',
      '/dashboard/settings',
    ]);
  });

  it('omits the prompts before onboarding is complete', () => {
    const steps = getSteps(makeStatus({ onboarding_completed: false }));
    expect(steps.some((s) => SUGGESTION_KEYS.includes(s.key))).toBe(false);
  });

  it('lists the prompts after the required steps', () => {
    const steps = getSteps(makeStatus());
    const firstSuggestionIndex = steps.findIndex((s) => SUGGESTION_KEYS.includes(s.key));
    const lastRequiredIndex = steps.reduce(
      (acc, s, i) => (SUGGESTION_KEYS.includes(s.key) ? acc : i),
      -1,
    );
    expect(firstSuggestionIndex).toBeGreaterThan(lastRequiredIndex);
  });
});

describe('getGuestBookingStep wording', () => {
  it('titles the appointment booking step "Create services" with the new copy', () => {
    const steps = getSteps(makeStatus({ booking_model: 'unified_scheduling' }));
    const step = steps.find((s) => s.key === 'guest_booking_ready');
    expect(step?.label).toBe('Create services');
    expect(step?.description).toBe(
      'Create at least one service to offer on your public booking page.',
    );
  });
});

describe('isStepComplete', () => {
  it('reads the matching SetupStatus flag for a required step', () => {
    const step = { key: 'stripe_connected', label: '', description: '', href: '', actionLabel: '' };
    expect(isStepComplete(makeStatus({ stripe_connected: true }), step)).toBe(true);
    expect(isStepComplete(makeStatus({ stripe_connected: false }), step)).toBe(false);
  });

  it('leaves the post-onboarding prompts incomplete until they are clicked through', () => {
    const status = makeStatus();
    const suggestions = getSteps(status).filter((s) => SUGGESTION_KEYS.includes(s.key));
    // No clicks yet: all incomplete.
    for (const step of suggestions) {
      expect(isStepComplete(status, step)).toBe(false);
      expect(isStepComplete(status, step, new Set())).toBe(false);
    }
    // Once a prompt's key is recorded as clicked, it is complete.
    for (const step of suggestions) {
      expect(isStepComplete(status, step, new Set([step.key]))).toBe(true);
      // A different clicked key does not complete this prompt.
      expect(isStepComplete(status, step, new Set(['some_other_key']))).toBe(false);
    }
  });

  it('ignores click state for required steps (they come from SetupStatus)', () => {
    const step = { key: 'stripe_connected', label: '', description: '', href: '', actionLabel: '' };
    // Clicking is irrelevant to a required step; only the flag matters.
    expect(isStepComplete(makeStatus({ stripe_connected: false }), step, new Set(['stripe_connected']))).toBe(
      false,
    );
  });
});
