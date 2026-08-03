import type { BookingModel } from '@/types/booking-models';
import { APPOINTMENTS_ACTIVE_MODEL_ORDER } from '@/lib/booking/active-models';

export type OnboardingStepDef = { key: string; label: string };

export type AppointmentPlanModel =
  | 'unified_scheduling'
  | 'event_ticket'
  | 'class_session'
  | 'resource_booking';

export function isAppointmentPlanModel(model: BookingModel): model is AppointmentPlanModel {
  return APPOINTMENTS_ACTIVE_MODEL_ORDER.includes(model as AppointmentPlanModel);
}

/**
 * Every Appointments-plan booking model uses team calendar columns (`unified_calendars`) for at least one flow
 * (appointments, classes, events, resources), so per-calendar working hours belong in onboarding whenever any
 * model is enabled, not only when `unified_scheduling` is selected.
 */
export function appointmentsPlanNeedsCalendarAvailabilityStep(
  activeModels: AppointmentPlanModel[],
): boolean {
  return activeModels.length > 0;
}

/**
 * Appointments plan: business details → opening hours → calendars → calendar hours →
 * optional staff invites → dashboard tour → review.
 *
 * Catalogue setup (services, classes, events, resources) and Stripe are deliberately
 * absent: they were the heaviest screens in the flow, every one of them was already
 * skippable, and the dashboard "What's next" checklist prompts for each of them with
 * completion driven by real catalogue counts. See Docs/Resneo_Lean_Onboarding_Plan.md.
 */
export function buildAppointmentsPlanModelSteps(
  activeModels: AppointmentPlanModel[],
  options?: { omitOtherUsersStep?: boolean },
): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'profile', label: 'Business Details' },
    { key: 'opening_hours', label: 'Opening Hours' },
    { key: 'team', label: 'Calendars' },
  ];
  if (appointmentsPlanNeedsCalendarAvailabilityStep(activeModels)) {
    steps.push({ key: 'hours', label: 'Calendar Availability' });
  }
  if (!options?.omitOtherUsersStep) {
    steps.push({ key: 'users', label: 'Invite Your Team' });
  }
  steps.push({ key: 'dashboard', label: 'Your Dashboard' });
  steps.push({ key: 'preview', label: 'Review & Go Live' });
  return steps;
}

/**
 * The layout the lean flow replaced: same spine, plus one setup screen per active
 * booking model and a Stripe step before review. Used only to remap a stored
 * `onboarding_step` for venues that were mid-flow when the lean layout shipped.
 */
export function buildCatalogueAppointmentsPlanSteps(
  activeModels: AppointmentPlanModel[],
  options?: { omitOtherUsersStep?: boolean },
): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'profile', label: 'Business Details' },
    { key: 'opening_hours', label: 'Opening Hours' },
    { key: 'team', label: 'Calendars' },
  ];
  if (appointmentsPlanNeedsCalendarAvailabilityStep(activeModels)) {
    steps.push({ key: 'hours', label: 'Calendar Availability' });
  }
  if (!options?.omitOtherUsersStep) {
    steps.push({ key: 'users', label: 'Invite Your Team' });
  }
  for (const model of APPOINTMENTS_ACTIVE_MODEL_ORDER.filter(isAppointmentPlanModel)) {
    if (!activeModels.includes(model)) continue;
    if (model === 'unified_scheduling') {
      steps.push({ key: 'services', label: 'Appointments Setup' });
    }
    if (model === 'class_session') {
      steps.push({ key: 'classes', label: 'Classes Setup' });
    }
    if (model === 'event_ticket') {
      steps.push({ key: 'first_event', label: 'Events Setup' });
    }
    if (model === 'resource_booking') {
      steps.push({ key: 'resources', label: 'Resources Setup' });
    }
  }
  steps.push({ key: 'dashboard', label: 'Your Dashboard' });
  steps.push({ key: 'stripe_onboarding', label: 'Payments (Stripe)' });
  steps.push({ key: 'preview', label: 'Review & Go Live' });
  return steps;
}

/**
 * Older appointments step order (Stripe before staff; appointments setup before calendar hours).
 * Used only to remap stored `onboarding_step` indices for users mid-flow when the flow order changes.
 */
export function buildLegacyAppointmentsPlanModelSteps(
  activeModels: AppointmentPlanModel[],
): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'welcome', label: 'Welcome' },
    { key: 'profile', label: 'Business Details' },
    { key: 'opening_hours', label: 'Opening Hours' },
    { key: 'team', label: 'Calendars' },
    { key: 'stripe_onboarding', label: 'Payments (Stripe)' },
    { key: 'users', label: 'Other Users' },
  ];
  for (const model of APPOINTMENTS_ACTIVE_MODEL_ORDER.filter(isAppointmentPlanModel)) {
    if (!activeModels.includes(model)) continue;
    if (model === 'unified_scheduling') {
      steps.push({ key: 'services', label: 'Appointments Setup' });
      steps.push({ key: 'hours', label: 'Calendar Availability' });
    }
    if (model === 'class_session') {
      steps.push({ key: 'classes', label: 'Classes Setup' });
    }
    if (model === 'event_ticket') {
      steps.push({ key: 'first_event', label: 'Events Setup' });
    }
    if (model === 'resource_booking') {
      steps.push({ key: 'resources', label: 'Resources Setup' });
    }
  }
  steps.push({ key: 'preview', label: 'Review & Go Live' });
  return steps;
}

/** Plan §8.2 Step 2: heading adapts to terminology (team / calendars). */
export function unifiedTeamStepLabel(terms: { staff: string }): string {
  const s = terms.staff.trim();
  if (/^staff$/i.test(s)) {
    return 'Your team & calendars';
  }
  return `Your ${s}s`;
}

/**
 * Restaurant plan onboarding (`table_reservation`).
 *
 * Services, capacity, dining duration, and booking rules were four separate screens until
 * 2026-05-08; they are one `r_services` step now. There is deliberately no remap from that
 * older layout: it ran unguarded for three months, so every venue that has opened the
 * wizard since has already been converted, and re-running it on an already-current index
 * reads it against the wrong layout and walks the venue backwards.
 */
export function buildRestaurantOnboardingSteps(tableManagementEnabled: boolean): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'profile', label: 'Business Profile' },
    { key: 'r_welcome', label: 'Welcome' },
    { key: 'r_opening_hours', label: 'Opening Hours' },
    { key: 'r_table_mode', label: 'Table Management' },
    { key: 'r_services', label: 'Services & booking rules' },
  ];
  if (tableManagementEnabled) {
    steps.push({ key: 'r_table_setup', label: 'Table Setup' });
  }
  steps.push(
    { key: 'r_dashboard', label: 'Your Dashboard' },
    { key: 'stripe_onboarding', label: 'Payments (Stripe)' },
    { key: 'preview', label: 'Preview & Go Live' },
  );
  return steps;
}

/**
 * Onboarding for venues that are neither on an appointments plan nor running table
 * reservations: a restaurant or founding tier whose booking model is not
 * `table_reservation`. Reachable because signup takes the booking model from the
 * business type rather than the plan.
 *
 * Catalogue setup is dropped here for the same reason as the appointments plan: the
 * dashboard checklist covers every model. Stripe stays, unlike the appointments plan,
 * because this flow has no dashboard tour step to hand over from.
 */
export function buildGenericNonRestaurantOnboardingSteps(
  bookingModel: BookingModel,
  terms: { staff: string },
): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'profile', label: 'Business Profile' },
    { key: 'stripe_onboarding', label: 'Payments (Stripe)' },
  ];
  if (bookingModel === 'practitioner_appointment' || bookingModel === 'unified_scheduling') {
    steps.push({ key: 'team', label: unifiedTeamStepLabel(terms) });
    steps.push({ key: 'hours', label: 'Opening hours & schedules' });
  }
  steps.push({ key: 'preview', label: 'Preview & Go Live' });
  return steps;
}

/**
 * The layout `buildGenericNonRestaurantOnboardingSteps` replaced, and also the layout
 * Appointments Plus used before the unified flow. Remap source only.
 */
export function buildLegacyGenericNonRestaurantOnboardingSteps(
  bookingModel: BookingModel,
  terms: { staff: string },
): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'profile', label: 'Business Profile' },
    { key: 'stripe_onboarding', label: 'Payments (Stripe)' },
  ];
  switch (bookingModel) {
    case 'practitioner_appointment':
    case 'unified_scheduling':
      steps.push({ key: 'team', label: unifiedTeamStepLabel(terms) });
      steps.push({ key: 'services', label: 'Services' });
      steps.push({ key: 'hours', label: 'Opening hours & schedules' });
      break;
    case 'event_ticket':
      steps.push({ key: 'first_event', label: 'First Event' });
      break;
    case 'class_session':
      steps.push({ key: 'classes', label: 'Classes & Timetable' });
      break;
    case 'resource_booking':
      steps.push({ key: 'resources', label: 'Your Resources' });
      break;
    default:
      break;
  }
  steps.push({ key: 'preview', label: 'Preview & Go Live' });
  return steps;
}

/**
 * Remap a stored `onboarding_step` index from an older layout onto the current one.
 *
 * When the stored step still exists, follow it by key. When it has been dropped, resume
 * at the next step of the OLD flow that still exists, so nothing already finished is
 * repeated and nothing still pending is skipped.
 *
 * Walking the old flow matters rather than consulting a fixed running order: steps have
 * moved between layouts (Stripe used to sit fifth, then second from last), so "what came
 * after this" only has one correct answer relative to the layout the index was written
 * against. Note the result may be a LOWER index than the stored one, which is expected:
 * dropping steps shortens the flow. The invariant is on order of steps, not on the number.
 */
export function migrateOnboardingStepToCurrentLayout(
  storedIndex: number,
  legacySteps: OnboardingStepDef[],
  currentSteps: OnboardingStepDef[],
): number {
  const clamp = (n: number) => Math.min(Math.max(0, n), Math.max(0, currentSteps.length - 1));
  const legacyKey = legacySteps[storedIndex]?.key;
  if (!legacyKey) return clamp(storedIndex);

  const idx = currentSteps.findIndex((s) => s.key === legacyKey);
  if (idx >= 0) return idx;

  for (let i = storedIndex + 1; i < legacySteps.length; i++) {
    const j = currentSteps.findIndex((s) => s.key === legacySteps[i]!.key);
    if (j >= 0) return j;
  }
  return clamp(storedIndex);
}
