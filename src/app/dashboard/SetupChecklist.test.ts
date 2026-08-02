import { describe, expect, it } from 'vitest';
import { getSteps, isSetupComplete, isStepComplete } from './SetupChecklist';
import type { SetupStatus } from '@/lib/venue/compute-setup-status';

function makeStatus(overrides: Partial<SetupStatus> = {}): SetupStatus {
  return {
    setup_checklist_dismissed: false,
    setup_checklist_snoozed_keys: [],
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

describe('optional steps', () => {
  const OPTIONAL_KEYS = ['stripe_connected', 'first_booking_made'];

  it('marks payments and the test booking optional, and nothing else', () => {
    const steps = getSteps(makeStatus());
    expect(steps.filter((s) => s.optional).map((s) => s.key)).toEqual(OPTIONAL_KEYS);
  });

  it('treats a snoozed optional step as complete', () => {
    const status = makeStatus({ stripe_connected: false });
    const step = getSteps(status).find((s) => s.key === 'stripe_connected')!;
    expect(isStepComplete(status, step, undefined, new Set())).toBe(false);
    expect(isStepComplete(status, step, undefined, new Set(['stripe_connected']))).toBe(true);
  });

  it('does not let a snooze complete a required step', () => {
    const status = makeStatus({ guest_booking_ready: false });
    const step = getSteps(status).find((s) => s.key === 'guest_booking_ready')!;
    expect(step.optional).toBeUndefined();
    expect(isStepComplete(status, step, undefined, new Set(['guest_booking_ready']))).toBe(false);
  });
});

describe('isSetupComplete', () => {
  /** Required flags all true; the two optional ones left undone. */
  const readyExceptOptional = () =>
    makeStatus({ stripe_connected: false, first_booking_made: false });

  it('stays incomplete while an optional step is neither done nor snoozed', () => {
    expect(isSetupComplete(readyExceptOptional(), new Set())).toBe(false);
    expect(isSetupComplete(readyExceptOptional(), new Set(['stripe_connected']))).toBe(false);
  });

  it('completes once every optional step is snoozed', () => {
    expect(
      isSetupComplete(readyExceptOptional(), new Set(['stripe_connected', 'first_booking_made'])),
    ).toBe(true);
  });

  it('completes when the optional steps are genuinely done', () => {
    const status = makeStatus({ stripe_connected: true, first_booking_made: true });
    expect(isSetupComplete(status, new Set())).toBe(true);
  });

  it('never completes on a snooze alone while a required step is outstanding', () => {
    const status = makeStatus({
      guest_booking_ready: false,
      stripe_connected: false,
      first_booking_made: false,
    });
    expect(
      isSetupComplete(status, new Set(['stripe_connected', 'first_booking_made', 'guest_booking_ready'])),
    ).toBe(false);
  });
});
