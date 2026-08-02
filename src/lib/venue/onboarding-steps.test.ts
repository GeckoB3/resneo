import { describe, expect, it } from 'vitest';
import {
  type AppointmentPlanModel,
  buildAppointmentsPlanModelSteps,
  buildCatalogueAppointmentsPlanSteps,
  buildLegacyAppointmentsPlanModelSteps,
  migrateOnboardingStepToCurrentLayout,
} from './onboarding-steps';

const ALL_MODELS: AppointmentPlanModel[] = [
  'unified_scheduling',
  'class_session',
  'event_ticket',
  'resource_booking',
];

const REMOVED_KEYS = ['services', 'classes', 'first_event', 'resources', 'stripe_onboarding'];

const keys = (steps: { key: string }[]) => steps.map((s) => s.key);

describe('buildAppointmentsPlanModelSteps (lean layout)', () => {
  it('is the same eight steps whatever models are active', () => {
    const expected = [
      'welcome',
      'profile',
      'opening_hours',
      'team',
      'hours',
      'users',
      'dashboard',
      'preview',
    ];
    expect(keys(buildAppointmentsPlanModelSteps(['unified_scheduling']))).toEqual(expected);
    expect(keys(buildAppointmentsPlanModelSteps(ALL_MODELS))).toEqual(expected);
  });

  it('drops every catalogue step and Stripe', () => {
    for (const key of REMOVED_KEYS) {
      expect(keys(buildAppointmentsPlanModelSteps(ALL_MODELS))).not.toContain(key);
    }
  });

  it('still omits the invite step for the Light tier', () => {
    const steps = keys(
      buildAppointmentsPlanModelSteps(['unified_scheduling'], { omitOtherUsersStep: true }),
    );
    expect(steps).not.toContain('users');
    expect(steps).toHaveLength(7);
  });

  it('omits calendar availability when no model is active', () => {
    expect(keys(buildAppointmentsPlanModelSteps([]))).not.toContain('hours');
  });

  it('shortens the flow it replaced', () => {
    // The point of the change: 13 screens down to 8 for a venue running every model.
    expect(buildCatalogueAppointmentsPlanSteps(ALL_MODELS)).toHaveLength(13);
    expect(buildAppointmentsPlanModelSteps(ALL_MODELS)).toHaveLength(8);
  });
});

describe('migrateOnboardingStepToCurrentLayout to the lean layout', () => {
  /** Every venue shape whose stored index has to survive the remap. */
  const shapes: Array<{ name: string; models: AppointmentPlanModel[]; light?: boolean }> = [
    { name: 'appointments only', models: ['unified_scheduling'] },
    { name: 'classes only', models: ['class_session'] },
    { name: 'all four models', models: ALL_MODELS },
    { name: 'Light tier', models: ['unified_scheduling'], light: true },
  ];

  for (const shape of shapes) {
    const options = { omitOtherUsersStep: Boolean(shape.light) };
    const legacy = buildCatalogueAppointmentsPlanSteps(shape.models, options);
    const current = buildAppointmentsPlanModelSteps(shape.models, options);

    it(`keeps surviving steps in place (${shape.name})`, () => {
      legacy.forEach((step, storedIndex) => {
        if (REMOVED_KEYS.includes(step.key)) return;
        const landed = migrateOnboardingStepToCurrentLayout(storedIndex, legacy, current);
        expect(current[landed]?.key).toBe(step.key);
      });
    });

    it(`moves removed steps forward, never backward (${shape.name})`, () => {
      legacy.forEach((step, storedIndex) => {
        if (!REMOVED_KEYS.includes(step.key)) return;
        const landed = migrateOnboardingStepToCurrentLayout(storedIndex, legacy, current);
        const landedKey = current[landed]?.key;
        expect(landedKey).toBeDefined();
        // Landing on a smaller index is fine (the flow got shorter); landing on an
        // earlier step in flow order is not, since it would repeat finished work.
        const landedInLegacy = legacy.findIndex((s) => s.key === landedKey);
        expect(landedInLegacy).toBeGreaterThan(storedIndex);
      });
    });

    it(`always lands on a real step (${shape.name})`, () => {
      legacy.forEach((_step, storedIndex) => {
        const landed = migrateOnboardingStepToCurrentLayout(storedIndex, legacy, current);
        expect(landed).toBeGreaterThanOrEqual(0);
        expect(landed).toBeLessThan(current.length);
      });
    });
  }

  it('sends a venue parked on Appointments Setup to the dashboard tour', () => {
    const legacy = buildCatalogueAppointmentsPlanSteps(['unified_scheduling']);
    const current = buildAppointmentsPlanModelSteps(['unified_scheduling']);
    const stored = legacy.findIndex((s) => s.key === 'services');
    const landed = migrateOnboardingStepToCurrentLayout(stored, legacy, current);
    expect(current[landed]?.key).toBe('dashboard');
  });

  it('sends a venue parked on Stripe to review', () => {
    const legacy = buildCatalogueAppointmentsPlanSteps(['unified_scheduling']);
    const current = buildAppointmentsPlanModelSteps(['unified_scheduling']);
    const stored = legacy.findIndex((s) => s.key === 'stripe_onboarding');
    const landed = migrateOnboardingStepToCurrentLayout(stored, legacy, current);
    expect(current[landed]?.key).toBe('preview');
  });

  it('is idempotent once a venue is already on the lean layout', () => {
    // The remap is one-shot per venue (gated by appointments_onboarding_lean_flow), but
    // running it twice must not shuffle anyone if that guard is ever mishandled.
    const current = buildAppointmentsPlanModelSteps(ALL_MODELS);
    current.forEach((step, idx) => {
      expect(migrateOnboardingStepToCurrentLayout(idx, current, current)).toBe(idx);
    });
  });

  it('resumes at the next surviving step of the OLD flow, not a fixed running order', () => {
    // Stripe sat fifth in the pre-unified layout (before the invite step) and second
    // from last in the layout after it. A venue parked on the early Stripe step must
    // resume at the invite step, not be flung to the end of the flow.
    const legacy = buildLegacyAppointmentsPlanModelSteps(['unified_scheduling']);
    const current = buildAppointmentsPlanModelSteps(['unified_scheduling']);
    const stored = legacy.findIndex((s) => s.key === 'stripe_onboarding');
    expect(current[migrateOnboardingStepToCurrentLayout(stored, legacy, current)]?.key).toBe(
      'users',
    );
  });

  it('does not skip calendar availability when the invite step is gone (Light tier)', () => {
    // Light has no invite step. In the old flow calendar hours came after it, so a
    // venue parked on the invite step still owes us calendar availability.
    const options = { omitOtherUsersStep: true };
    const legacy = buildLegacyAppointmentsPlanModelSteps(['unified_scheduling']);
    const current = buildAppointmentsPlanModelSteps(['unified_scheduling'], options);
    const stored = legacy.findIndex((s) => s.key === 'users');
    expect(current[migrateOnboardingStepToCurrentLayout(stored, legacy, current)]?.key).toBe(
      'hours',
    );
  });

  it('clamps an out-of-range stored index instead of throwing', () => {
    const current = buildAppointmentsPlanModelSteps(['unified_scheduling']);
    const legacy = buildCatalogueAppointmentsPlanSteps(['unified_scheduling']);
    expect(migrateOnboardingStepToCurrentLayout(99, legacy, current)).toBe(current.length - 1);
    expect(migrateOnboardingStepToCurrentLayout(-1, legacy, current)).toBe(0);
  });
});
