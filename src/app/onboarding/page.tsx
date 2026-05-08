'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { BookingModel } from '@/types/booking-models';
import { getBusinessConfig } from '@/lib/business-config';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';
import { APPOINTMENTS_ACTIVE_MODEL_ORDER } from '@/lib/booking/active-models';
import { buildAddress, parseAddress } from '@/lib/venue/address-format';
import { defaultCalendarWorkingHoursFromOpeningHours } from '@/lib/availability/opening-hours-to-working-hours';
import {
  defaultPractitionerWorkingHours,
  isDefaultNewUnifiedCalendarWorkingHours,
} from '@/lib/availability/practitioner-defaults';
import { DEFAULT_ENTITY_BOOKING_WINDOW } from '@/lib/booking/entity-booking-window';
import type { WorkingHours } from '@/types/booking-models';
import type { OpeningHours } from '@/types/availability';
import type { OpeningHoursSettings } from '@/app/dashboard/settings/types';
import { OpeningHoursControl, defaultOpeningHoursSettings } from '@/components/scheduling/OpeningHoursControl';
import { NumericInput } from '@/components/ui/NumericInput';
import { WorkingHoursControl } from '@/components/scheduling/WorkingHoursControl';
import { OnboardingStaffInviteStep, type StaffInviteDraft } from '@/components/onboarding/OnboardingStaffInviteStep';
import { OnboardingInlineAddCalendarControls } from '@/components/onboarding/OnboardingInlineAddCalendarControls';
import {
  OnboardingAppointmentServiceList,
  appointmentServiceDraftFromBusinessDefault,
  appointmentServiceDraftsFromApiResponse,
  createEmptyAppointmentServiceDraft,
  serviceDraftToApiPayload,
  validateAppointmentServiceDraftForSave,
  type AppointmentServiceFormDraft,
} from '@/components/onboarding/OnboardingAppointmentServiceList';
import { normalizeTimeToHhMm, validateStartEndTimes } from '@/lib/experience-events/experience-event-validation';
import { formatZodFlattenedError } from '@/lib/experience-events/experience-event-zod';
import { StripeConnectSection } from '@/app/dashboard/settings/sections/StripeConnectSection';
import { RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';
import { StripePaymentWarning } from '@/components/dashboard/StripePaymentWarning';
import { AppointmentsWelcomeStep } from '@/components/onboarding/AppointmentsWelcomeStep';
import { AppointmentsDashboardStep } from '@/components/onboarding/AppointmentsDashboardStep';
import { WelcomeStep as RestaurantWelcomeStep } from './steps/restaurant/WelcomeStep';
import { OpeningHoursStep } from './steps/restaurant/OpeningHoursStep';
import { ServicesStep } from './steps/restaurant/ServicesStep';
import { TableModeStep } from './steps/restaurant/TableModeStep';
import { TableSetupStep } from './steps/restaurant/TableSetupStep';
import { DashboardOrientationStep } from './steps/restaurant/DashboardOrientationStep';
import { canAddCalendarColumn, useCalendarEntitlement } from '@/hooks/use-calendar-entitlement';
import { isAppointmentPlanTier, isPlusPlanTier } from '@/lib/tier-enforcement';
import { planDisplayName } from '@/lib/pricing-constants';
import { isValidWebsiteUrlInput } from '@/lib/urls/website-url';
import { HelpTooltip } from '@/components/dashboard/HelpTooltip';
import {
  RESOURCE_MIN_BOOKING_HELP,
  RESOURCE_SLOT_INTERVAL_HELP,
} from '@/lib/help/resource-booking-tooltips';
import {
  DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
  DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
  syncedMinBookingMinutesFromSlot,
} from '@/lib/booking/resource-booking-defaults';
import { SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE } from '@/lib/subscription-cancellation-copy';

type Currency = 'GBP' | 'EUR';

const CURRENCY_OPTIONS: { code: Currency; symbol: string; label: string }[] = [
  { code: 'GBP', symbol: '£', label: 'GBP (£)' },
  { code: 'EUR', symbol: '€', label: 'EUR (€)' },
];

function currencySymbol(c: Currency): string {
  return c === 'EUR' ? '€' : '£';
}

function poundsToMinor(pounds: string): number {
  const parsed = parseFloat(pounds);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

interface VenueOnboarding {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  website_url: string | null;
  booking_model: BookingModel;
  active_booking_models?: BookingModel[] | null;
  /** Secondary C/D/E models; onboarding wizard stays primary-first - full setup for add-ons is on the dashboard checklist. */
  enabled_models?: BookingModel[] | null;
  business_type: string | null;
  terminology: { client: string; booking: string; staff: string };
  pricing_tier: string;
  calendar_count: number | null;
  onboarding_step: number;
  onboarding_completed: boolean;
  /** When true, `onboarding_step` uses the unified appointments wizard (Stripe near the end). */
  appointments_onboarding_unified_flow?: boolean;
  currency: Currency;
  stripe_connected_account_id: string | null;
  /** True when the signed-in user is a venue admin (only admins can run Stripe Connect). */
  is_admin: boolean;
}

interface PractitionerDraft {
  name: string;
  email: string;
}

/** Aligned with dashboard Event Manager create form (`EventManagerView` BLANK_EVENT + submit payload). */
interface EventTicketDraft {
  name: string;
  price_pence: string;
  capacity: string;
}

type EventScheduleMode = 'single' | 'weekly' | 'custom';

interface EventDraft {
  name: string;
  description: string;
  event_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  image_url: string;
  ticket_types: EventTicketDraft[];
  scheduleMode: EventScheduleMode;
  recurrenceUntil: string;
  customDatesText: string;
  calendar_id: string;
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  payment_requirement: 'none' | 'deposit' | 'full_payment';
  deposit_pounds: string;
}

function parseOptionalTicketCapacity(raw: string): number | undefined {
  const cap = raw.trim();
  if (cap === '') return undefined;
  const n = parseInt(cap, 10);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return n;
}

function parseCustomDatesFromText(text: string): string[] {
  const parts = text
    .split(/[\s,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set<string>();
  for (const p of parts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) set.add(p);
  }
  return [...set].sort();
}

function isEventSchedulingEmpty(d: EventDraft): boolean {
  if (d.scheduleMode === 'single') return !d.event_date.trim();
  if (d.scheduleMode === 'weekly') return !d.event_date.trim() && !d.recurrenceUntil.trim();
  return parseCustomDatesFromText(d.customDatesText).length === 0;
}

/** Mirrors `handleSaveEvent` in `EventManagerView` for POST /api/venue/experience-events. */
function buildOnboardingExperienceEventPostBody(
  d: EventDraft,
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  if (!d.name.trim()) {
    return { ok: false, error: 'Event name is required.' };
  }
  const validTickets = d.ticket_types.filter((tt) => tt.name.trim());
  if (validTickets.length === 0) {
    return { ok: false, error: 'At least one ticket type with a name is required.' };
  }

  let eventDateForPayload = d.event_date;
  if (d.scheduleMode === 'custom') {
    const customDates = parseCustomDatesFromText(d.customDatesText);
    if (customDates.length === 0) {
      return { ok: false, error: 'Add at least one date (YYYY-MM-DD), separated by commas or new lines.' };
    }
    eventDateForPayload = customDates[0]!;
  } else if (!d.event_date.trim()) {
    return { ok: false, error: 'Event date is required.' };
  }

  if (!d.start_time || !d.end_time) {
    return { ok: false, error: 'Start and end time are required.' };
  }

  const timeErr = validateStartEndTimes(d.start_time, d.end_time);
  if (timeErr) {
    return { ok: false, error: timeErr };
  }

  if (d.scheduleMode === 'weekly') {
    if (!d.recurrenceUntil.trim()) {
      return { ok: false, error: 'End date is required for weekly recurrence.' };
    }
    if (d.recurrenceUntil < d.event_date) {
      return { ok: false, error: 'End date must be on or after the first occurrence date.' };
    }
  }

  const depositPence =
    d.payment_requirement === 'deposit' && d.deposit_pounds.trim() !== ''
      ? Math.max(0, Math.round(parseFloat(d.deposit_pounds) * 100))
      : null;

  if (d.payment_requirement === 'deposit') {
    const raw = d.deposit_pounds.trim();
    const dep = parseFloat(raw);
    if (!raw || !Number.isFinite(dep) || dep <= 0) {
      return { ok: false, error: 'Enter a deposit amount greater than zero when taking a deposit online.' };
    }
  }

  const basePayload = {
    name: d.name.trim(),
    description: d.description.trim() || null,
    event_date: eventDateForPayload,
    start_time: normalizeTimeToHhMm(d.start_time),
    end_time: normalizeTimeToHhMm(d.end_time),
    capacity: d.capacity,
    image_url: d.image_url.trim() || null,
    ticket_types: validTickets.map((tt) => {
      const cap = parseOptionalTicketCapacity(tt.capacity);
      return {
        name: tt.name.trim(),
        price_pence: Math.round(parseFloat(tt.price_pence || '0') * 100),
        ...(cap !== undefined ? { capacity: cap } : {}),
      };
    }),
    calendar_id: d.calendar_id.trim() || null,
    max_advance_booking_days: d.max_advance_booking_days,
    min_booking_notice_hours: d.min_booking_notice_hours,
    cancellation_notice_hours: d.cancellation_notice_hours,
    allow_same_day_booking: d.allow_same_day_booking,
    payment_requirement: d.payment_requirement,
    deposit_amount_pence: depositPence,
  };

  let postBody: Record<string, unknown> = { ...basePayload };
  if (d.scheduleMode === 'weekly') {
    postBody = {
      ...basePayload,
      event_date: d.event_date,
      schedule: { type: 'weekly' as const, until_date: d.recurrenceUntil },
    };
  } else if (d.scheduleMode === 'custom') {
    const dates = parseCustomDatesFromText(d.customDatesText);
    postBody = {
      ...basePayload,
      event_date: dates[0],
      schedule: { type: 'custom' as const, dates },
    };
  }

  return { ok: true, body: postBody };
}

/** Aligns with dashboard Class timetable → Add class type (`BLANK_CT` / `buildClassTypePayload`). */
type ClassPaymentRequirement = 'none' | 'deposit' | 'full_payment';

interface ClassDraft {
  name: string;
  description: string;
  /** Team calendar column id (`unified_calendars.id`); required by POST /api/venue/classes. */
  instructor_id: string;
  /** Guest-facing instructor label; optional. */
  instructor_custom_name: string;
  duration_minutes: number;
  capacity: number;
  /** Price per person in major units (string for controlled inputs). */
  price: string;
  payment_requirement: ClassPaymentRequirement;
  deposit_pounds: string;
  colour: string;
  is_active: boolean;
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
}

function createEmptyClassDraft(instructorId: string): ClassDraft {
  return {
    name: '',
    description: '',
    instructor_id: instructorId,
    instructor_custom_name: '',
    duration_minutes: 60,
    capacity: 10,
    price: '',
    payment_requirement: 'none',
    deposit_pounds: '',
    colour: '#6366f1',
    is_active: true,
    max_advance_booking_days: 90,
    min_booking_notice_hours: 1,
    cancellation_notice_hours: 48,
    allow_same_day_booking: true,
  };
}

function buildClassTypePayloadFromDraft(c: ClassDraft): Record<string, unknown> {
  const priceRaw = c.price.trim();
  const priceNum = parseFloat(priceRaw);
  const pricePence =
    priceRaw === '' || Number.isNaN(priceNum) ? null : Math.max(0, Math.round(priceNum * 100));
  const depositRaw = c.deposit_pounds.trim();
  const depNum = parseFloat(depositRaw);
  const depositPence =
    c.payment_requirement === 'deposit' && depositRaw !== '' && !Number.isNaN(depNum)
      ? Math.max(0, Math.round(depNum * 100))
      : null;
  return {
    name: c.name.trim(),
    description: c.description.trim() || null,
    duration_minutes: c.duration_minutes,
    capacity: c.capacity,
    colour: c.colour,
    is_active: c.is_active,
    payment_requirement: c.payment_requirement,
    deposit_amount_pence: depositPence,
    price_pence: pricePence,
    instructor_id: c.instructor_id.trim(),
    instructor_name: c.instructor_custom_name.trim() || null,
    max_advance_booking_days: c.max_advance_booking_days,
    min_booking_notice_hours: c.min_booking_notice_hours,
    cancellation_notice_hours: c.cancellation_notice_hours,
    allow_same_day_booking: c.allow_same_day_booking,
  };
}

type ResourcePaymentRequirement = 'none' | 'deposit' | 'full_payment';

/** Aligned with dashboard Resource timeline Add Resource (exceptions omitted in onboarding). */
interface ResourceDraft {
  name: string;
  resource_type: string;
  /** Host team calendar (non-resource): required by POST /api/venue/resources */
  display_on_calendar_id: string;
  slot_interval_minutes: number;
  min_booking_minutes: number;
  max_booking_minutes: number;
  /** When false, shortest booking follows the start-time step (with system minimum). */
  longer_minimum_than_slot: boolean;
  pricePerSlot: string;
  payment_requirement: ResourcePaymentRequirement;
  depositPounds: string;
  /** Guest booking window (same fields as Resource timeline) */
  max_advance_booking_days: number;
  min_booking_notice_hours: number;
  cancellation_notice_hours: number;
  allow_same_day_booking: boolean;
  is_active: boolean;
  availability_hours: WorkingHours;
}

const RESOURCE_TYPE_SUGGESTIONS = [
  'Tennis court',
  'Meeting room',
  'Studio',
  'Pitch',
  'Equipment',
  'Desk',
  'Bay',
  'Lane',
  'Pod',
] as const;

const RES_SLOT_MIN = 5;
const RES_SLOT_MAX = 480;
const RES_MIN_BOOK_MIN = 15;
const RES_MIN_BOOK_MAX = 480;
const RES_MAX_BOOK_MIN = 15;
const RES_MAX_BOOK_MAX = 1440;

function createEmptyResourceDraft(hostCalendarId: string): ResourceDraft {
  return {
    name: '',
    resource_type: '',
    display_on_calendar_id: hostCalendarId,
    slot_interval_minutes: DEFAULT_RESOURCE_SLOT_INTERVAL_MINUTES,
    min_booking_minutes: DEFAULT_RESOURCE_MIN_BOOKING_MINUTES,
    max_booking_minutes: 180,
    longer_minimum_than_slot: false,
    pricePerSlot: '',
    payment_requirement: 'none',
    depositPounds: '',
    max_advance_booking_days: DEFAULT_ENTITY_BOOKING_WINDOW.max_advance_booking_days,
    min_booking_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.min_booking_notice_hours,
    cancellation_notice_hours: DEFAULT_ENTITY_BOOKING_WINDOW.cancellation_notice_hours,
    allow_same_day_booking: DEFAULT_ENTITY_BOOKING_WINDOW.allow_same_day_booking,
    is_active: true,
    availability_hours: defaultPractitionerWorkingHours(),
  };
}

type AppointmentPlanModel = 'unified_scheduling' | 'event_ticket' | 'class_session' | 'resource_booking';
const APPOINTMENTS_MODEL_LABEL: Record<AppointmentPlanModel, string> = {
  unified_scheduling: 'Appointments',
  class_session: 'Classes',
  event_ticket: 'Events',
  resource_booking: 'Bookable resources',
};

function isAppointmentPlanModel(model: BookingModel): model is AppointmentPlanModel {
  return APPOINTMENTS_ACTIVE_MODEL_ORDER.includes(model as AppointmentPlanModel);
}

/** Plan §8.2 Step 2: heading adapts to terminology (team / calendars). */
function unifiedTeamStepLabel(terms: { staff: string }): string {
  const s = terms.staff.trim();
  if (/^staff$/i.test(s)) {
    return 'Your team & calendars';
  }
  return `Your ${s}s`;
}

type OnboardingStepDef = { key: string; label: string };

/**
 * Legacy layout used for Appointments Plus before unified flow: profile → Stripe → model steps → preview.
 * Indices are remapped once when `appointments_onboarding_unified_flow` is false.
 */
function buildLegacyGenericNonRestaurantOnboardingSteps(
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
 * Every Appointments-plan booking model uses team calendar columns (`unified_calendars`) for at least one flow
 * (appointments, classes, events, resources), so per-calendar working hours belong in onboarding whenever any
 * model is enabled, not only when `unified_scheduling` is selected.
 */
function appointmentsPlanNeedsCalendarAvailabilityStep(activeModels: AppointmentPlanModel[]): boolean {
  return activeModels.length > 0;
}

/** Appointments plan: calendars → calendar hours → optional staff invites → model setup → Stripe → review. */
function buildAppointmentsPlanModelSteps(
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
 * Previous appointments step order (Stripe before staff; appointments setup before calendar hours).
 * Used only to remap stored `onboarding_step` indices for users mid-flow when the flow order changes.
 */
function buildLegacyAppointmentsPlanModelSteps(activeModels: AppointmentPlanModel[]): OnboardingStepDef[] {
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

function migrateOnboardingStepToCurrentLayout(
  storedIndex: number,
  legacySteps: OnboardingStepDef[],
  currentSteps: OnboardingStepDef[],
): number {
  const legacyKey = legacySteps[storedIndex]?.key;
  if (!legacyKey) {
    return Math.min(Math.max(0, storedIndex), Math.max(0, currentSteps.length - 1));
  }
  let idx = currentSteps.findIndex((s) => s.key === legacyKey);
  if (idx < 0 && legacyKey === 'users') {
    const priority: Array<OnboardingStepDef['key']> = [
      'services',
      'classes',
      'first_event',
      'resources',
      'dashboard',
      'stripe_onboarding',
      'preview',
    ];
    for (const key of priority) {
      const j = currentSteps.findIndex((s) => s.key === key);
      if (j >= 0) {
        idx = j;
        break;
      }
    }
  }
  if (idx >= 0) return idx;
  return Math.min(Math.max(0, storedIndex), Math.max(0, currentSteps.length - 1));
}

/** Restaurant plan onboarding (current layout: one step for services + capacity + duration + rules). */
function buildRestaurantOnboardingSteps(tableManagementEnabled: boolean): OnboardingStepDef[] {
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

/** Previous restaurant flow: four separate screens for the same service editor. */
function buildLegacyRestaurantOnboardingSteps(tableManagementEnabled: boolean): OnboardingStepDef[] {
  const steps: OnboardingStepDef[] = [
    { key: 'profile', label: 'Business Profile' },
    { key: 'r_welcome', label: 'Welcome' },
    { key: 'r_opening_hours', label: 'Opening Hours' },
    { key: 'r_table_mode', label: 'Table Management' },
    { key: 'r_services', label: 'Dining Services' },
    { key: 'r_capacity', label: 'Capacity' },
    { key: 'r_dining_duration', label: 'Dining Duration' },
    { key: 'r_booking_rules', label: 'Booking Rules' },
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
 * Maps stored step index when the restaurant onboarding flow drops duplicate service-setup screens.
 * If the user had already reached the last redundant step, resume on the next substantive step.
 */
function migrateRestaurantOnboardingStepToCurrentLayout(
  storedIndex: number,
  legacySteps: OnboardingStepDef[],
  currentSteps: OnboardingStepDef[],
): number {
  const legacyKey = legacySteps[storedIndex]?.key;
  if (!legacyKey) {
    return Math.min(Math.max(0, storedIndex), Math.max(0, currentSteps.length - 1));
  }
  if (legacyKey === 'r_booking_rules') {
    const svcIdx = currentSteps.findIndex((s) => s.key === 'r_services');
    if (svcIdx >= 0 && svcIdx + 1 < currentSteps.length) {
      return svcIdx + 1;
    }
    return svcIdx >= 0 ? svcIdx : 0;
  }
  const mergedHead = ['r_services', 'r_capacity', 'r_dining_duration'];
  if (mergedHead.includes(legacyKey)) {
    const idx = currentSteps.findIndex((s) => s.key === 'r_services');
    if (idx >= 0) return idx;
  }
  return migrateOnboardingStepToCurrentLayout(storedIndex, legacySteps, currentSteps);
}

export default function OnboardingPage() {
  const router = useRouter();
  const [venue, setVenue] = useState<VenueOnboarding | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [maxCompletedStep, setMaxCompletedStep] = useState(0);
  const stripeReturnStatusRef = useRef<string | null | undefined>(undefined);
  const handledStripeReturnRef = useRef(false);
  if (stripeReturnStatusRef.current === undefined && typeof window !== 'undefined') {
    stripeReturnStatusRef.current = new URLSearchParams(window.location.search).get('stripe');
  }
  /** Step index the user navigated back to; forces save on Continue instead of skipping persistence. */
  const [revisitedStepIndex, setRevisitedStepIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { entitlement, entitlementLoaded, refresh: refreshCalendarEntitlement } = useCalendarEntitlement(
    Boolean(venue?.is_admin),
  );
  const canAddCalendar = canAddCalendarColumn(entitlement, entitlementLoaded);

  // Step 1: Business profile (address fields match Settings → Venue profile)
  const [name, setName] = useState('');
  const [addressName, setAddressName] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressTown, setAddressTown] = useState('');
  const [addressPostcode, setAddressPostcode] = useState('');
  const [phone, setPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [businessWebsiteUrl, setBusinessWebsiteUrl] = useState('');
  const [currency, setCurrency] = useState<Currency>('GBP');

  // Model B: Practitioners + services
  const [practitioners, setPractitioners] = useState<PractitionerDraft[]>([{ name: '', email: '' }]);
  const [services, setServices] = useState<AppointmentServiceFormDraft[]>([]);
  /** When revisiting the services step, we sync from the server before saving (avoids skipping POST and duplicate rows). */
  const [servicesSyncReady, setServicesSyncReady] = useState(true);
  /** Unified onboarding: calendar roster for service assignment + hours step */
  const [rosterList, setRosterList] = useState<Array<{ id: string; name: string }>>([]);
  const [openingHoursDraft, setOpeningHoursDraft] = useState<OpeningHoursSettings>(() => defaultOpeningHoursSettings());
  const [calendarWorkingDraft, setCalendarWorkingDraft] = useState<Record<string, WorkingHours>>({});

  /** Restaurant plan: tracks simple vs advanced table management (drives dynamic step list). */
  const [tableManagementEnabled, setTableManagementEnabled] = useState(false);

  useEffect(() => {
    if (!venue || venue.booking_model !== 'table_reservation') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/venue/tables/settings');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { settings?: { table_management_enabled?: boolean } };
        if (!cancelled) {
          setTableManagementEnabled(Boolean(data.settings?.table_management_enabled));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-sync when venue identity / model changes, not whole venue object (frequent PATCHes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, venue?.booking_model]);

  // Model C: First event
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    name: '',
    description: '',
    event_date: '',
    start_time: '10:00',
    end_time: '12:00',
    capacity: 20,
    image_url: '',
    ticket_types: [{ name: 'General Admission', price_pence: '0.00', capacity: '' }],
    scheduleMode: 'single',
    recurrenceUntil: '',
    customDatesText: '',
    calendar_id: '',
    max_advance_booking_days: 90,
    min_booking_notice_hours: 1,
    cancellation_notice_hours: 48,
    allow_same_day_booking: true,
    payment_requirement: 'none',
    deposit_pounds: '',
  });

  const addEventTicketType = useCallback(() => {
    setEventDraft((f) => ({
      ...f,
      ticket_types: [...f.ticket_types, { name: '', price_pence: '0.00', capacity: '' }],
    }));
  }, []);

  const removeEventTicketType = useCallback((i: number) => {
    setEventDraft((f) => ({ ...f, ticket_types: f.ticket_types.filter((_, j) => j !== i) }));
  }, []);

  const updateEventTicketType = useCallback((i: number, patch: Partial<EventTicketDraft>) => {
    setEventDraft((f) => {
      const updated = [...f.ticket_types];
      updated[i] = { ...updated[i]!, ...patch };
      return { ...f, ticket_types: updated };
    });
  }, []);

  // Model D: Classes (draft shape matches dashboard Class timetable → Add class type)
  const [classes, setClasses] = useState<ClassDraft[]>(() => [createEmptyClassDraft('')]);

  // Model E: Resources
  const [resources, setResources] = useState<ResourceDraft[]>(() => [createEmptyResourceDraft('')]);
  const [staffInvites, setStaffInvites] = useState<StaffInviteDraft[]>([{ email: '', role: 'staff' }]);

  type InlineCalendarTarget =
    | { kind: 'event' }
    | { kind: 'class'; index: number }
    | { kind: 'resource'; index: number }
    | { kind: 'service' };

  const [showAddCalendarModal, setShowAddCalendarModal] = useState(false);
  const [inlineCalendarTarget, setInlineCalendarTarget] = useState<InlineCalendarTarget | null>(null);
  const [newCalendarName, setNewCalendarName] = useState('');
  const [addCalendarSubmitting, setAddCalendarSubmitting] = useState(false);
  const [addCalendarModalError, setAddCalendarModalError] = useState<string | null>(null);

  const openInlineAddCalendar = useCallback(
    (target: InlineCalendarTarget) => {
      if (!canAddCalendar) return;
      setInlineCalendarTarget(target);
      setAddCalendarModalError(null);
      setNewCalendarName('');
      setShowAddCalendarModal(true);
    },
    [canAddCalendar],
  );

  const closeInlineAddCalendar = useCallback(() => {
    if (addCalendarSubmitting) return;
    setShowAddCalendarModal(false);
    setAddCalendarModalError(null);
    setInlineCalendarTarget(null);
  }, [addCalendarSubmitting]);

  const submitInlineNewCalendar = useCallback(async () => {
    const name = newCalendarName.trim();
    const target = inlineCalendarTarget;
    if (!name) {
      setAddCalendarModalError('Enter a display name for the calendar.');
      return;
    }
    if (!target) {
      setAddCalendarModalError('Something went wrong. Close and try again.');
      return;
    }
    setAddCalendarSubmitting(true);
    setAddCalendarModalError(null);
    try {
      const seededWorkingHours = defaultCalendarWorkingHoursFromOpeningHours(openingHoursDraft);
      const res = await fetch('/api/venue/practitioners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          is_active: true,
          working_hours: seededWorkingHours,
          break_times: [],
          days_off: [],
        }),
      });
      const json = (await res.json()) as {
        error?: string;
        id?: string;
        name?: string;
        upgrade_required?: boolean;
      };
      if (!res.ok) {
        if (res.status === 403 && json.upgrade_required) {
          void refreshCalendarEntitlement();
          setAddCalendarModalError(json.error ?? 'Calendar limit reached for your plan.');
        } else {
          setAddCalendarModalError(json.error ?? 'Could not create calendar');
        }
        return;
      }
      const newId = json.id;
      const newNameResolved = typeof json.name === 'string' ? json.name : name;
      if (!newId) {
        setAddCalendarModalError('Calendar was created but no id was returned. Refresh the page.');
        return;
      }
      setRosterList((prev) => {
        if (prev.some((c) => c.id === newId)) return prev;
        return [...prev, { id: newId, name: newNameResolved }].sort((a, b) => a.name.localeCompare(b.name));
      });
      setCalendarWorkingDraft((prev) => ({
        ...prev,
        [newId]: seededWorkingHours,
      }));
      if (target.kind === 'event') {
        setEventDraft((f) => ({ ...f, calendar_id: newId }));
      } else if (target.kind === 'class') {
        setClasses((prev) => {
          const next = [...prev];
          const row = next[target.index];
          if (row) {
            next[target.index] = { ...row, instructor_id: newId };
          }
          return next;
        });
      } else if (target.kind === 'resource') {
        setResources((prev) => {
          const next = [...prev];
          const row = next[target.index];
          if (row) {
            next[target.index] = {
              ...row,
              name: row.name.trim() ? row.name : newNameResolved,
              display_on_calendar_id: newId,
            };
          }
          return next;
        });
      } else {
        setServices((prev) =>
          prev.map((row) =>
            row.practitioner_ids.includes(newId) ? row : { ...row, practitioner_ids: [...row.practitioner_ids, newId] },
          ),
        );
      }
      setNewCalendarName('');
      setShowAddCalendarModal(false);
      setInlineCalendarTarget(null);
      void refreshCalendarEntitlement();
    } catch {
      setAddCalendarModalError('Could not create calendar');
    } finally {
      setAddCalendarSubmitting(false);
    }
  }, [newCalendarName, inlineCalendarTarget, openingHoursDraft, refreshCalendarEntitlement]);

  useEffect(() => {
    async function loadVenue() {
      try {
        const res = await fetch('/api/venue/onboarding');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/login?redirectTo=/onboarding');
            return;
          }
          if (res.status === 404) {
            router.push('/signup/business-type');
            return;
          }
          throw new Error('Failed to load venue');
        }
        const data = await res.json();
        const v = data.venue as VenueOnboarding;
        setVenue(v);
        setName(v.name === 'My Business' ? '' : v.name);
        const parsed = parseAddress(v.address);
        setAddressName(parsed.name);
        setAddressStreet(parsed.street);
        setAddressTown(parsed.town);
        setAddressPostcode(parsed.postcode);
        setPhone(v.phone ?? '');
        setBusinessEmail(v.email ?? '');
        setBusinessWebsiteUrl(v.website_url ?? '');
        setCurrency(v.currency ?? 'GBP');

        if (v.onboarding_completed) {
          router.push('/dashboard');
          return;
        }

        if (isAppointmentPlanTier(v.pricing_tier) && (!v.active_booking_models || v.active_booking_models.length === 0)) {
          router.push('/signup/booking-models');
          return;
        }

        let initialStep = v.onboarding_step;
        let initialMaxStep = v.onboarding_step;
        let restaurantTableMgmt = false;

        if (v.booking_model === 'table_reservation') {
          try {
            const tsRes = await fetch('/api/venue/tables/settings');
            if (tsRes.ok) {
              const tsBody = (await tsRes.json()) as { settings?: { table_management_enabled?: boolean } };
              restaurantTableMgmt = Boolean(tsBody.settings?.table_management_enabled);
            }
          } catch {
            /* non-blocking */
          }
          setTableManagementEnabled(restaurantTableMgmt);
          const currentR = buildRestaurantOnboardingSteps(restaurantTableMgmt);
          const legacyR = buildLegacyRestaurantOnboardingSteps(restaurantTableMgmt);
          const migratedR = migrateRestaurantOnboardingStepToCurrentLayout(v.onboarding_step, legacyR, currentR);
          if (migratedR !== v.onboarding_step) {
            initialStep = migratedR;
            initialMaxStep = migratedR;
            void fetch('/api/venue/onboarding', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ onboarding_step: migratedR }),
            });
          }
        }

        if (isAppointmentPlanTier(v.pricing_tier)) {
          const active = (v.active_booking_models ?? []).filter(isAppointmentPlanModel) as AppointmentPlanModel[];
          if (active.length > 0) {
            const currentSteps = buildAppointmentsPlanModelSteps(active, {
              omitOtherUsersStep: v.pricing_tier === 'light',
            });
            const unifiedFlow = Boolean(v.appointments_onboarding_unified_flow);

            if (!unifiedFlow) {
              const legacySteps = isPlusPlanTier(v.pricing_tier)
                ? buildLegacyGenericNonRestaurantOnboardingSteps(v.booking_model, v.terminology)
                : buildLegacyAppointmentsPlanModelSteps(active);
              initialStep = migrateOnboardingStepToCurrentLayout(
                v.onboarding_step,
                legacySteps,
                currentSteps,
              );
              initialMaxStep = initialStep;
              const patch: Record<string, unknown> = { appointments_onboarding_unified_flow: true };
              if (initialStep !== v.onboarding_step) {
                patch.onboarding_step = initialStep;
              }
              void fetch('/api/venue/onboarding', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
              });
            }
          }
        }
        setStep(initialStep);
        setMaxCompletedStep(initialMaxStep);

        // Pre-fill services from business config defaults (stored in pence, display in pounds)
        if (v.business_type) {
          const config = getBusinessConfig(v.business_type);
          if (config.defaultServices?.length) {
            setServices(
              config.defaultServices.map((ds) =>
                appointmentServiceDraftFromBusinessDefault({
                  name: ds.name,
                  duration: ds.duration,
                  price: ds.price,
                }),
              ),
            );
          } else if (isUnifiedSchedulingVenue(v.booking_model)) {
            setServices([createEmptyAppointmentServiceDraft()]);
          }
        } else if (isUnifiedSchedulingVenue(v.booking_model)) {
          setServices([createEmptyAppointmentServiceDraft()]);
        }

        // Model B: merge existing calendars (retry / refresh after partial save).
        // Appointments Light is capped at one calendar; higher tiers can add more.
        if (isUnifiedSchedulingVenue(v.booking_model)) {
          try {
            const prRes = await fetch('/api/venue/practitioners');
            if (prRes.ok) {
              const body = (await prRes.json()) as {
                practitioners?: Array<{ name: string; email: string | null; sort_order: number }>;
              };
              const list = body.practitioners ?? [];
              const sorted = [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
              if (sorted.length === 0) {
                setPractitioners([{ name: '', email: '' }]);
              } else {
                const visibleCalendars = v.pricing_tier === 'light' ? sorted.slice(0, 1) : sorted;
                setPractitioners(
                  visibleCalendars.map((row) => ({
                    name: row.name ?? '',
                    email: row.email?.trim() ? row.email : '',
                  })),
                );
              }
            } else {
              setPractitioners([{ name: '', email: '' }]);
            }
          } catch {
            setPractitioners([{ name: '', email: '' }]);
          }
        }

        // Model E: start with one empty resource row
        if (v.booking_model === 'resource_booking') {
          setResources([createEmptyResourceDraft('')]);
        }
      } catch {
        setError('Failed to load venue data.');
      } finally {
        setLoading(false);
      }
    }
    loadVenue();
  }, [router]);

  /** Strip ?stripe= from URL after returning from Stripe Connect (same data as initial GET). */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.get('stripe')) return;
    router.replace('/onboarding', { scroll: false });
  }, [router]);

  const terms = useMemo(
    () => venue?.terminology ?? { client: 'Client', booking: 'Booking', staff: 'Staff' },
    [venue?.terminology],
  );

  const isAppointmentsPlanVenue = isAppointmentPlanTier(venue?.pricing_tier);
  const isLightPlanVenue = venue?.pricing_tier === 'light';

  /**
   * Per-plan calendar limit (Infinity for unlimited plans).
   * Compared against the DRAFT array length so the UI blocks before any API call.
   */
  const calendarPlanLimit: number = entitlement?.calendar_limit ?? Infinity;
  const calendarDraftAtLimit =
    calendarPlanLimit !== Infinity && practitioners.length >= calendarPlanLimit;

  /**
   * Per-plan staff limit (Infinity for unlimited plans).
   * Used both to gate the invite form and to pre-validate on submit.
   */
  const staffPlanLimit: number = entitlement?.staff_limit ?? Infinity;

  useEffect(() => {
    if (entitlementLoaded && !canAddCalendar) {
      setShowAddCalendarModal(false);
    }
  }, [entitlementLoaded, canAddCalendar]);

  const activeAppointmentsModels: AppointmentPlanModel[] = useMemo(
    () => (venue?.active_booking_models ?? []).filter(isAppointmentPlanModel),
    [venue?.active_booking_models],
  );

  /** Normalised secondaries (e.g. restaurant + events). Primary flow is unchanged; checklist on dashboard covers catalogue for each enabled add-on. */
  const enabledSecondaryModels = useMemo(
    () =>
      venue
        ? normalizeEnabledModels(venue.enabled_models, venue.booking_model)
        : [],
    [venue],
  );

  const modelSteps = useMemo(() => {
    if (!venue) return [];
    if (isAppointmentPlanTier(venue.pricing_tier)) {
      return buildAppointmentsPlanModelSteps(activeAppointmentsModels, {
        omitOtherUsersStep: venue.pricing_tier === 'light',
      });
    }

    if (venue.booking_model === 'table_reservation') {
      return buildRestaurantOnboardingSteps(tableManagementEnabled);
    }

    const steps: Array<{ key: string; label: string }> = [
      { key: 'profile', label: 'Business Profile' },
      { key: 'stripe_onboarding', label: 'Payments (Stripe)' },
    ];

    switch (venue.booking_model) {
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
    }

    steps.push({ key: 'preview', label: 'Preview & Go Live' });
    return steps;
  }, [activeAppointmentsModels, venue, terms, tableManagementEnabled]);

  const currentStepKey = modelSteps[step]?.key ?? 'profile';
  const totalSteps = modelSteps.length;

  useEffect(() => {
    if (handledStripeReturnRef.current) return;
    if (loading || !venue || venue.onboarding_completed || modelSteps.length === 0) return;
    if (stripeReturnStatusRef.current !== 'success') return;

    const stripeIndex = modelSteps.findIndex((s) => s.key === 'stripe_onboarding');
    if (stripeIndex < 0) {
      handledStripeReturnRef.current = true;
      return;
    }

    const nextStep = Math.min(stripeIndex + 1, modelSteps.length - 1);
    handledStripeReturnRef.current = true;
    setStep(nextStep);
    setMaxCompletedStep((prev) => Math.max(prev, nextStep));
    void fetch('/api/venue/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ onboarding_step: nextStep }),
    });
  }, [loading, modelSteps, step, venue]);

  const rosterIds = useMemo(() => rosterList.map((r) => r.id), [rosterList]);

  /** Default class / resource host calendar when roster loads (matches dashboard forms). */
  useEffect(() => {
    if (rosterList.length === 0) return;
    const firstId = rosterList[0]!.id;
    setClasses((prev) =>
      prev.map((c) => (c.instructor_id.trim() ? c : { ...c, instructor_id: firstId })),
    );
    setResources((prev) =>
      prev.map((r) => (r.display_on_calendar_id.trim() ? r : { ...r, display_on_calendar_id: firstId })),
    );
  }, [rosterList]);

  /** Keep event calendar aligned with team columns from `unified_calendars` (invalid/stale id → first column). */
  useEffect(() => {
    if (rosterList.length === 0) return;
    const ids = new Set(rosterList.map((r) => r.id));
    const firstId = rosterList[0]!.id;
    setEventDraft((prev) => {
      const cal = prev.calendar_id.trim();
      if (!cal || !ids.has(cal)) {
        return { ...prev, calendar_id: firstId };
      }
      return prev;
    });
  }, [rosterList]);

  useEffect(() => {
    if (!venue) return;
    /** Prefetch roster on team, hours, staff, Stripe, and model steps so calendars are loaded when needed. */
    if (
      ![
        'team',
        'stripe_onboarding',
        'users',
        'services',
        'hours',
        'classes',
        'resources',
        'first_event',
      ].includes(currentStepKey)
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const prRes = await fetch('/api/venue/practitioners?roster=1');
        if (!prRes.ok || cancelled) return;
        const body = (await prRes.json()) as {
          practitioners?: Array<{ id: string; name: string; calendar_type?: string | null }>;
        };
        const list = (body.practitioners ?? [])
          .filter((p) => (p.calendar_type ?? 'practitioner') !== 'resource')
          .map((p) => ({ id: p.id, name: p.name }));
        if (!cancelled) setRosterList(list);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, currentStepKey]);

  useEffect(() => {
    if (rosterIds.length === 0) return;
    setServices((prev) =>
      prev.map((s) => (s.practitioner_ids.length === 0 ? { ...s, practitioner_ids: [...rosterIds] } : s)),
    );
  }, [rosterIds]);

  useEffect(() => {
    if (!venue || currentStepKey !== 'services') {
      setServicesSyncReady(true);
      return;
    }
    if (!isUnifiedSchedulingVenue(venue.booking_model)) return;
    if (!(step < maxCompletedStep && step !== revisitedStepIndex)) {
      setServicesSyncReady(true);
      return;
    }
    let cancelled = false;
    setServicesSyncReady(false);
    (async () => {
      try {
        const res = await fetch('/api/venue/appointment-services');
        if (!res.ok || cancelled) {
          if (!cancelled) setServicesSyncReady(true);
          return;
        }
        const body = (await res.json()) as {
          services?: unknown[];
          practitioner_services?: Array<{ practitioner_id: string; service_id: string }>;
        };
        const drafts = appointmentServiceDraftsFromApiResponse(body);
        if (drafts.length > 0 && !cancelled) {
          setServices(drafts);
        }
      } catch {
        /* non-blocking */
      } finally {
        if (!cancelled) setServicesSyncReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, currentStepKey, step, maxCompletedStep, revisitedStepIndex]);

  useEffect(() => {
    if (!venue) return;
    if (currentStepKey !== 'hours' && currentStepKey !== 'opening_hours') return;
    const isAppointmentsTier = isAppointmentPlanTier(venue.pricing_tier);
    if (
      currentStepKey === 'hours' &&
      !isUnifiedSchedulingVenue(venue.booking_model) &&
      !isAppointmentsTier
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const venueRequest = fetch('/api/venue');
        const practitionerRequest =
          currentStepKey === 'opening_hours'
            ? Promise.resolve(new Response(JSON.stringify({ practitioners: [] }), { status: 200 }))
            : fetch('/api/venue/practitioners?roster=1');
        const [vRes, pRes] = await Promise.all([venueRequest, practitionerRequest]);
        if (!vRes.ok || !pRes.ok || cancelled) return;
        const venueRow = (await vRes.json()) as { opening_hours?: OpeningHoursSettings | null };
        const prBody = (await pRes.json()) as {
          practitioners?: Array<{ id: string; working_hours?: WorkingHours }>;
        };
        const pracs = prBody.practitioners ?? [];
        let mergedOpening: OpeningHoursSettings;
        if (venueRow.opening_hours && typeof venueRow.opening_hours === 'object') {
          mergedOpening = {
            ...defaultOpeningHoursSettings(),
            ...venueRow.opening_hours,
          } as OpeningHoursSettings;
          if (!cancelled) setOpeningHoursDraft(mergedOpening);
        } else {
          mergedOpening = defaultOpeningHoursSettings();
          if (!cancelled) setOpeningHoursDraft(mergedOpening);
        }
        const fromOpening = defaultCalendarWorkingHoursFromOpeningHours(mergedOpening);
        const byId: Record<string, WorkingHours> = {};
        for (const p of pracs) {
          const wh = p.working_hours;
          const hasCustom =
            wh &&
            typeof wh === 'object' &&
            Object.keys(wh).length > 0 &&
            !isDefaultNewUnifiedCalendarWorkingHours(wh);
          byId[p.id] = hasCustom ? (wh as WorkingHours) : fromOpening;
        }
        if (!cancelled) setCalendarWorkingDraft(byId);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venue, currentStepKey]);

  const saveProgress = useCallback(
    async (nextStep: number) => {
      const res = await fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: nextStep }),
      });
      if (!res.ok) throw new Error('Failed to save progress');
    },
    []
  );

  /** Latest step for unload / tab backgrounding (must survive React commit timing). */
  const stepRef = useRef(step);
  stepRef.current = step;

  /**
   * Keep `venues.onboarding_step` aligned with the visible step so users resume here after closing the tab,
   * navigating away, or logging in again, not only after clicking Continue.
   */
  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;
    if (modelSteps.length === 0) return;
    const maxIdx = modelSteps.length - 1;
    const clamped = Math.min(Math.max(0, step), maxIdx);
    if (clamped !== step) {
      setStep(clamped);
    }
  }, [venue, modelSteps.length, step, venue?.onboarding_completed]);

  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;
    if (modelSteps.length === 0) return;
    const maxIdx = modelSteps.length - 1;
    if (step < 0 || step > maxIdx) return;

    const t = setTimeout(() => {
      void fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: step }),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [step, venue, modelSteps.length]);

  useEffect(() => {
    if (!venue || venue.onboarding_completed) return;

    const persistNow = () => {
      const idx = stepRef.current;
      void fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding_step: idx }),
        keepalive: true,
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        persistNow();
      }
    };

    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', persistNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [venue]);

  /** Each step should start at the top; retained scroll position on shorter next steps felt like a jump to the bottom. */
  useEffect(() => {
    if (loading || !venue) return;
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo(0, 0);
      });
    });
    return () => window.cancelAnimationFrame(id);
  }, [step, loading, venue]);

  async function handleNext() {
    setError(null);

    if (currentStepKey === 'welcome') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save your progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'dashboard') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save your progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'stripe_onboarding') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save progress. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'profile') {
      if (!name.trim()) {
        setError('Please enter your business name.');
        return;
      }
      const street = addressStreet.trim();
      const town = addressTown.trim();
      const postcode = addressPostcode.trim();
      if (!street || !town || !postcode) {
        setError('Please enter street, town or city, and postcode for your business address.');
        return;
      }
      const email = businessEmail.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setError('Enter a valid business email address, or leave it blank.');
        return;
      }
      const websiteUrl = businessWebsiteUrl.trim();
      if (websiteUrl && !isValidWebsiteUrlInput(websiteUrl)) {
        setError('Enter a valid business website URL, or leave it blank.');
        return;
      }
      const combinedAddress = buildAddress({
        name: addressName.trim(),
        street,
        town,
        postcode,
      });
      setSaving(true);
      try {
        const slug = name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/-+$/, '');
        const finalSlug = slug || `venue-${Date.now()}`;
        const nextStep = Math.max(step + 1, maxCompletedStep);
        const res = await fetch('/api/venue/onboarding', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            address: combinedAddress,
            phone: phone.trim(),
            email,
            website_url: websiteUrl,
            slug: finalSlug,
            currency,
            onboarding_step: nextStep,
          }),
        });
        if (!res.ok) throw new Error('Failed to save profile');
        setVenue((prev) =>
          prev
            ? {
                ...prev,
                name: name.trim(),
                address: combinedAddress,
                phone: phone.trim(),
                email: email || null,
                website_url: websiteUrl || null,
                slug: finalSlug,
                currency,
              }
            : prev
        );
      } catch {
        setError('Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'opening_hours') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const hasVenueOpenDay = Object.values(openingHoursDraft).some((d) => {
        if (!d) return false;
        if ('closed' in d && d.closed === true) return false;
        if ('periods' in d && Array.isArray(d.periods) && d.periods.length > 0) return true;
        return false;
      });
      if (!hasVenueOpenDay) {
        setError('Choose at least one day when the business is open.');
        return;
      }
      setSaving(true);
      try {
        const ohRes = await fetch('/api/venue/opening-hours', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(openingHoursDraft),
        });
        if (!ohRes.ok) throw new Error('Failed to save opening hours');
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save opening hours. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'team') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const unnamed = practitioners.find((p) => !p.name.trim());
      if (unnamed) {
        setError(`Enter a name for each ${terms.staff.toLowerCase()}.`);
        return;
      }
      if (calendarPlanLimit !== Infinity && practitioners.length > calendarPlanLimit) {
        setError(
          `Your ${planDisplayName(venue?.pricing_tier)} plan includes up to ${calendarPlanLimit} calendars. Please remove some before continuing.`,
        );
        return;
      }
      setSaving(true);
      try {
        const listRes = await fetch('/api/venue/practitioners');
        if (!listRes.ok) {
          const errBody = (await listRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? 'Could not load your team. Please refresh and try again.');
        }
        const listBody = (await listRes.json()) as {
          practitioners?: Array<{ id: string; sort_order: number }>;
        };
        const sortedExisting = [...(listBody.practitioners ?? [])].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
        );

        for (let i = 0; i < practitioners.length; i++) {
          const p = practitioners[i];
          const existing = sortedExisting[i];
          if (existing?.id) {
            const res = await fetch('/api/venue/practitioners', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: existing.id,
                name: p.name.trim(),
                sort_order: i,
                ...(p.email.trim() ? { email: p.email.trim() } : {}),
              }),
            });
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not update ${terms.staff.toLowerCase()} ${i + 1}.`,
              );
            }
          } else {
            const res = await fetch('/api/venue/practitioners', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: p.name.trim(),
                sort_order: i,
                ...(p.email.trim() ? { email: p.email.trim() } : {}),
              }),
            });
            if (!res.ok) {
              const errBody = (await res.json().catch(() => ({}))) as {
                error?: string;
                upgrade_required?: boolean;
                limit?: number;
              };
              if (errBody.upgrade_required) {
                throw new Error(
                  'Could not add team member. Please check your plan under Settings \u2192 Plan.',
                );
              }
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not add ${terms.staff.toLowerCase()} ${i + 1}.`,
              );
            }
          }
        }

        if (sortedExisting.length > practitioners.length) {
          const toRemove = sortedExisting.slice(practitioners.length);
          for (const row of toRemove) {
            if (!row?.id) continue;
            const delRes = await fetch('/api/venue/practitioners', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: row.id }),
            });
            if (!delRes.ok) {
              const errBody = (await delRes.json().catch(() => ({}))) as { error?: string };
              throw new Error(
                typeof errBody.error === 'string'
                  ? errBody.error
                  : `Could not remove an extra ${terms.staff.toLowerCase()} record. Try again or manage team under Settings.`,
              );
            }
          }
        }

        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save team. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'users') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const validInvites = staffInvites
        .map((invite) => ({ email: invite.email.trim().toLowerCase(), role: invite.role }))
        .filter((invite) => invite.email.length > 0);
      for (const invite of validInvites) {
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email);
        if (!emailOk) {
          setError(`Enter a valid email address for ${invite.email || 'each user'}.`);
          return;
        }
      }
      if (staffPlanLimit !== Infinity) {
        const existingCount = entitlement?.active_staff ?? 1;
        const uniqueNewInvites = [...new Set(validInvites.map((i) => i.email))].length;
        if (existingCount + uniqueNewInvites > staffPlanLimit) {
          setError(
            `Your ${planDisplayName(venue?.pricing_tier)} plan includes up to ${staffPlanLimit} team logins (you currently have ${existingCount}). Please remove some invites to continue.`,
          );
          return;
        }
      }
      setSaving(true);
      try {
        const staffListRes = await fetch('/api/venue/staff');
        if (!staffListRes.ok) {
          const errBody = (await staffListRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error ?? 'Could not load staff list');
        }
        const staffBody = (await staffListRes.json()) as {
          staff?: Array<{ email: string }>;
        };
        const existingEmails = new Set(
          (staffBody.staff ?? []).map((r) => r.email.toLowerCase().trim()),
        );
        for (const invite of validInvites) {
          if (existingEmails.has(invite.email)) {
            continue;
          }
          const res = await fetch('/api/venue/staff/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(invite),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? `Failed to invite ${invite.email}`);
          }
          existingEmails.add(invite.email);
        }
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save users. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'services') {
      if (!servicesSyncReady) return;
      const validServices = services.filter((s) => s.name.trim());
      if (validServices.length === 0) {
        if (step < maxCompletedStep && step !== revisitedStepIndex) {
          setStep((s) => s + 1);
          return;
        }
        setSaving(true);
        try {
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch {
          setError('Failed to save progress. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      } else {
        const needsRoster = venue ? isUnifiedSchedulingVenue(venue.booking_model) : false;
        if (needsRoster && rosterIds.length === 0) {
          setError('Your team could not be loaded. Go back one step and save your team again.');
          return;
        }
        for (const s of validServices) {
          const svcErr = validateAppointmentServiceDraftForSave(s, {
            isAdmin: Boolean(venue?.is_admin),
            needsRoster,
            staffTerm: terms.staff,
          });
          if (svcErr) {
            setError(svcErr);
            return;
          }
        }
        setSaving(true);
        try {
          for (let i = 0; i < validServices.length; i++) {
            const s = validServices[i];
            const payload = {
              ...serviceDraftToApiPayload(s, { isAdmin: Boolean(venue?.is_admin) }),
              sort_order: i,
            };
            if (s.serverId) {
              const res = await fetch('/api/venue/appointment-services', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: s.serverId, ...payload }),
              });
              if (!res.ok) {
                const errBody = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                  typeof errBody.error === 'string' ? errBody.error : 'Failed to update service',
                );
              }
            } else {
              const res = await fetch('/api/venue/appointment-services', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });
              if (!res.ok) {
                const errBody = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(
                  typeof errBody.error === 'string' ? errBody.error : 'Failed to create service',
                );
              }
            }
          }
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save services. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }

    if (currentStepKey === 'hours') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      if (rosterList.length === 0) {
        setError('No calendars found. Go back and save your team first.');
        return;
      }
      const hasVenueOpenDay = Object.values(openingHoursDraft).some((d) => {
        if (!d) return false;
        if ('closed' in d && d.closed === true) return false;
        if ('periods' in d && Array.isArray(d.periods) && d.periods.length > 0) return true;
        return false;
      });
      if (!hasVenueOpenDay) {
        setError('Choose at least one day when the business is open, or adjust opening hours below.');
        return;
      }

      setSaving(true);
      try {
        if (!isAppointmentsPlanVenue) {
          const ohRes = await fetch('/api/venue/opening-hours', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(openingHoursDraft),
          });
          if (!ohRes.ok) throw new Error('Failed to save opening hours');
        }
        for (const cal of rosterList) {
          const wh =
            calendarWorkingDraft[cal.id] ??
            defaultCalendarWorkingHoursFromOpeningHours(openingHoursDraft);
          const hasDay = Object.values(wh).some((ranges) => Array.isArray(ranges) && ranges.length > 0);
          if (!hasDay) {
            throw new Error(
              `Set at least one working day for ${cal.name} (or adjust their weekly schedule below).`,
            );
          }
          const patchRes = await fetch('/api/venue/practitioners', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: cal.id, working_hours: wh }),
          });
          if (!patchRes.ok) throw new Error(`Failed to save working hours for ${cal.name}`);
        }
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save hours.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (currentStepKey === 'first_event') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const eventName = eventDraft.name.trim();
      const schedulingEmpty = isEventSchedulingEmpty(eventDraft);

      if (isAppointmentsPlanVenue && !eventName && schedulingEmpty) {
        setSaving(true);
        try {
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch {
          setError('Failed to save progress. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      } else {
        if (isAppointmentsPlanVenue && !eventName && !schedulingEmpty) {
          setError('Enter an event name or clear all scheduling fields to skip this step.');
          return;
        }
        if (isAppointmentsPlanVenue) {
          if (rosterList.length === 0) {
            setError(
              'Team calendars are still loading or missing. Go back to the Calendars step, ensure each column is saved with Continue, then return here. Or wait a few seconds and try again.',
            );
            return;
          }
          const calId = eventDraft.calendar_id.trim();
          if (calId && !rosterIds.includes(calId)) {
            setError('Choose a calendar column from the dropdown (from your Calendars step).');
            return;
          }
        }
        const built = buildOnboardingExperienceEventPostBody(eventDraft);
        if (!built.ok) {
          setError(built.error);
          return;
        }
        setSaving(true);
        try {
          const res = await fetch('/api/venue/experience-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(built.body),
          });
          const json = (await res.json()) as {
            error?: string;
            details?: unknown;
            upgrade_required?: boolean;
            current?: number;
            limit?: number;
          };
          if (!res.ok) {
            if (res.status === 403 && json.upgrade_required) {
              throw new Error(
                `Plan limit reached: ${json.current ?? '?'} of ${json.limit ?? '?'} active events. Upgrade your plan or deactivate old events.`,
              );
            }
            if (res.status === 409) {
              throw new Error(
                json.error ??
                  'This time conflicts with another booking or block on that calendar. Choose another time or calendar.',
              );
            }
            const hint = formatZodFlattenedError(json.details);
            const baseErr = json.error ?? 'Failed to create event';
            throw new Error(hint ? `${baseErr}: ${hint}` : baseErr);
          }
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save event. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }

    if (currentStepKey === 'classes') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const validClasses = classes.filter((c) => c.name.trim());
      if (validClasses.length === 0) {
        setSaving(true);
        try {
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch {
          setError('Failed to save progress. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      } else {
        if (rosterList.length === 0) {
          setError('No calendars found. Go back and complete the Calendars step first.');
          return;
        }
        for (const c of validClasses) {
          if (!c.instructor_id.trim()) {
            setError('Select a calendar for each class.');
            return;
          }
          const pricePence = poundsToMinor(c.price);
          const req = c.payment_requirement;
          if (req !== 'none' && pricePence <= 0) {
            setError(
              `Set a price per person for "${c.name.trim()}" when using deposit or full payment online.`,
            );
            return;
          }
          if (req === 'deposit') {
            const dep = poundsToMinor(c.deposit_pounds);
            if (dep <= 0) {
              setError(`Enter a deposit amount for "${c.name.trim()}".`);
              return;
            }
            if (pricePence > 0 && dep > pricePence) {
              setError(`Deposit cannot exceed price per person for "${c.name.trim()}".`);
              return;
            }
          }
        }
        setSaving(true);
        try {
          for (const c of validClasses) {
            const typeRes = await fetch('/api/venue/classes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildClassTypePayloadFromDraft(c)),
            });
            const typeBody = (await typeRes.json()) as { data?: { id?: string }; error?: string };
            if (!typeRes.ok) {
              throw new Error(typeBody.error ?? 'Failed to create class type');
            }
            const classTypeId = typeBody.data?.id;
            if (!classTypeId) throw new Error('Class type ID missing from response');
          }

          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save classes. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }

    if (currentStepKey === 'resources') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      const validResources = resources.filter((r) => r.name.trim());
      if (validResources.length === 0) {
        setSaving(true);
        try {
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch {
          setError('Failed to save progress. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      } else {
        if (rosterList.length === 0) {
          setError('No team calendars found. Go back and complete the Calendars step first.');
          return;
        }
        for (const r of validResources) {
          if (!r.display_on_calendar_id.trim()) {
            setError('Choose which calendar column each resource appears on.');
            return;
          }
          const slot = r.slot_interval_minutes;
          const minB = r.min_booking_minutes;
          const maxB = r.max_booking_minutes;
          const effectiveMin = r.longer_minimum_than_slot
            ? minB
            : syncedMinBookingMinutesFromSlot(slot, RES_MIN_BOOK_MIN);
          if (!Number.isFinite(slot) || slot < RES_SLOT_MIN || slot > RES_SLOT_MAX) {
            setError(`Start-time step must be between ${RES_SLOT_MIN} and ${RES_SLOT_MAX} minutes.`);
            return;
          }
          if (r.longer_minimum_than_slot) {
            if (!Number.isFinite(minB) || minB < RES_MIN_BOOK_MIN || minB > RES_MIN_BOOK_MAX) {
              setError(`Shortest booking must be between ${RES_MIN_BOOK_MIN} and ${RES_MIN_BOOK_MAX} minutes.`);
              return;
            }
            if (minB < slot) {
              setError(
                'Shortest booking must be at least the start-time step, or turn off Advanced to match the step automatically.',
              );
              return;
            }
          }
          if (!Number.isFinite(maxB) || maxB < RES_MAX_BOOK_MIN || maxB > RES_MAX_BOOK_MAX) {
            setError(`Max booking must be between ${RES_MAX_BOOK_MIN} and ${RES_MAX_BOOK_MAX} minutes.`);
            return;
          }
          if (effectiveMin > maxB) {
            setError('Shortest booking cannot be longer than the longest booking.');
            return;
          }
          const priceRaw = r.pricePerSlot.trim();
          const pricePence = priceRaw === '' ? 0 : poundsToMinor(priceRaw);
          if (
            (r.payment_requirement === 'deposit' || r.payment_requirement === 'full_payment') &&
            pricePence <= 0
          ) {
            setError('Set a price for each start-time step before choosing deposit or full payment online.');
            return;
          }
          if (r.payment_requirement === 'deposit') {
            const dep = parseFloat(r.depositPounds);
            if (!Number.isFinite(dep) || dep <= 0) {
              setError('Enter a deposit amount greater than zero.');
              return;
            }
            const depPence = Math.round(dep * 100);
            const maxSlots = Math.max(1, Math.ceil(maxB / slot));
            const maxTotal = pricePence * maxSlots;
            if (pricePence > 0 && depPence > maxTotal) {
              setError('Deposit cannot exceed the maximum possible booking total for this resource.');
              return;
            }
          }
        }
        setSaving(true);
        try {
          for (const r of validResources) {
            const priceRaw = r.pricePerSlot.trim();
            const pricePence = priceRaw === '' ? 0 : poundsToMinor(priceRaw);
            const payReq = r.payment_requirement;
            const effectiveMinSubmit = r.longer_minimum_than_slot
              ? r.min_booking_minutes
              : syncedMinBookingMinutesFromSlot(r.slot_interval_minutes, RES_MIN_BOOK_MIN);
            const depPence =
              payReq === 'deposit' && r.depositPounds.trim() !== ''
                ? Math.round(parseFloat(r.depositPounds) * 100)
                : null;
            const res = await fetch('/api/venue/resources', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: r.name.trim(),
                ...(r.resource_type.trim() && { resource_type: r.resource_type.trim() }),
                display_on_calendar_id: r.display_on_calendar_id.trim(),
                slot_interval_minutes: r.slot_interval_minutes,
                min_booking_minutes: effectiveMinSubmit,
                max_booking_minutes: r.max_booking_minutes,
                ...(pricePence > 0 && { price_per_slot_pence: pricePence }),
                payment_requirement: payReq,
                deposit_amount_pence: payReq === 'deposit' ? depPence : null,
                availability_hours: r.availability_hours,
                is_active: r.is_active,
                max_advance_booking_days: r.max_advance_booking_days,
                min_booking_notice_hours: r.min_booking_notice_hours,
                cancellation_notice_hours: r.cancellation_notice_hours,
                allow_same_day_booking: r.allow_same_day_booking,
              }),
            });
            const errBody = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              throw new Error(errBody.error ?? 'Failed to create resource');
            }
          }
          await saveProgress(step + 1);
          setMaxCompletedStep((prev) => Math.max(prev, step + 1));
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save resources. Please try again.');
          setSaving(false);
          return;
        }
        setSaving(false);
      }
    }

    if (currentStepKey === 'restaurant_setup') {
      if (step < maxCompletedStep && step !== revisitedStepIndex) {
        setStep((s) => s + 1);
        return;
      }
      setSaving(true);
      try {
        await saveProgress(step + 1);
        setMaxCompletedStep((prev) => Math.max(prev, step + 1));
      } catch {
        setError('Failed to save. Please try again.');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    // Restaurant-specific steps delegate saving to the child component via advanceRestaurantStep.
    // handleNext is not used for these steps; the standard Continue button is hidden.
    if (
      currentStepKey === 'r_welcome' ||
      currentStepKey === 'r_opening_hours' ||
      currentStepKey === 'r_services' ||
      currentStepKey === 'r_table_mode' ||
      currentStepKey === 'r_table_setup' ||
      currentStepKey === 'r_dashboard'
    ) {
      return;
    }

    if (revisitedStepIndex === step) {
      setRevisitedStepIndex(null);
    }
    setStep((s) => s + 1);
  }

  /**
   * Called by restaurant step components when they finish (save or skip).
   * Saves the onboarding step progress index then advances to the next step.
   */
  async function advanceRestaurantStep() {
    setSaving(true);
    setError(null);
    try {
      const nextStep = Math.max(step + 1, maxCompletedStep);
      await saveProgress(nextStep);
      setMaxCompletedStep(nextStep);
      setStep((s) => s + 1);
    } catch {
      setError('Failed to save progress. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGoLive() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/onboarding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          onboarding_completed: true,
          onboarding_step: totalSteps,
        }),
      });
      if (!res.ok) throw new Error('Failed to complete onboarding');
      router.push('/dashboard');
    } catch {
      setError('Failed to complete setup. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
      </div>
    );
  }

  if (!venue) {
    return (
      <div className="text-center text-slate-500">
        <p>Unable to load your venue. Please try refreshing.</p>
      </div>
    );
  }

  const sym = currencySymbol(currency);
  const stripeConnected = Boolean(venue.stripe_connected_account_id);

  const RESTAURANT_SELF_MANAGED_STEPS = new Set([
    'r_welcome',
    'r_opening_hours',
    'r_services',
    'r_table_mode',
    'r_table_setup',
    'r_dashboard',
  ]);

  const wideOnboardingStep =
    currentStepKey === 'welcome' ||
    currentStepKey === 'dashboard' ||
    currentStepKey === 'first_event' ||
    currentStepKey === 'stripe_onboarding' ||
    currentStepKey === 'r_welcome' ||
    currentStepKey === 'r_services' ||
    currentStepKey === 'r_table_mode' ||
    currentStepKey === 'r_dashboard' ||
    (currentStepKey === 'hours' &&
      (isAppointmentsPlanVenue || isUnifiedSchedulingVenue(venue.booking_model))) ||
    (currentStepKey === 'services' && isUnifiedSchedulingVenue(venue.booking_model)) ||
    currentStepKey === 'classes' ||
    currentStepKey === 'resources';

  const serviceSetupOnboardingStep = currentStepKey === 'r_services';
  const extraWideOnboardingStep = currentStepKey === 'r_table_setup' || serviceSetupOnboardingStep;
  const onboardingWidthClass = extraWideOnboardingStep
    ? 'max-w-7xl'
    : wideOnboardingStep
      ? 'max-w-3xl'
      : 'max-w-xl';
  const onboardingCardPaddingClass = extraWideOnboardingStep ? 'p-4 sm:p-6' : 'p-6 sm:p-8';

  return (
    <div className={`w-full ${onboardingWidthClass}`}>
      {/* Progress */}
      <div className="mb-8">
        <div className="mb-2 flex justify-between text-xs font-medium text-slate-400">
          <span>
            Step {step + 1} of {totalSteps} · {modelSteps[step]?.label}
          </span>
          <span>{Math.round(((step + 1) / totalSteps) * 100)}%</span>
        </div>
        <div className="h-2 rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-brand-600 transition-all"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>
        {step > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            Use <span className="font-medium text-slate-600">Back</span> to change a previous step. Your entries stay in
            this session and are saved to your venue when you choose Continue.
          </p>
        )}
      </div>

      <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${onboardingCardPaddingClass}`}>
        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {currentStepKey === 'welcome' && (
          <AppointmentsWelcomeStep
            isLightPlan={isLightPlanVenue}
            activeModels={activeAppointmentsModels as AppointmentPlanModel[]}
            modelLabel={APPOINTMENTS_MODEL_LABEL}
            staffTerm={terms.staff}
          />
        )}

        {currentStepKey === 'dashboard' && (
          <AppointmentsDashboardStep
            activeModels={activeAppointmentsModels as AppointmentPlanModel[]}
            isLightPlan={isLightPlanVenue}
            staffTerm={terms.staff}
            hasTeamCalendars={rosterList.length > 0}
          />
        )}

        {currentStepKey === 'stripe_onboarding' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Payments (Stripe)</h2>
            <p className="mb-3 text-sm text-slate-600">
              Use this step to connect Stripe so you can <strong className="font-medium text-slate-800">accept payments from your customers</strong>{' '}
              (for example deposits, tickets, or paid bookings). Payments are processed by Stripe.{' '}
              {RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}
            </p>
            <p className="mb-4 text-sm text-slate-600">
              This setup is only for customer payments. Your <strong className="font-medium text-slate-800">ReserveNI subscription</strong>{' '}
              is billed separately. Manage your plan and payment method under{' '}
              <Link
                href="/dashboard/settings?tab=plan"
                className="font-medium text-brand-600 underline hover:text-brand-700"
              >
                Settings → Plan &amp; billing
              </Link>
              .
            </p>
            <p className="mb-4 text-sm text-slate-600">{SUBSCRIPTION_CANCELLATION_PUBLIC_NOTICE}</p>
            <p className="mb-4 text-sm text-slate-500">
              Optional: use <span className="font-medium text-slate-700">Continue</span> to skip for now and connect later in{' '}
              <Link href="/dashboard/settings?tab=payments" className="font-medium text-brand-600 underline hover:text-brand-700">
                Settings → Payments
              </Link>
              .
            </p>
            <StripeConnectSection
              stripeAccountId={venue.stripe_connected_account_id ?? null}
              isAdmin={venue.is_admin}
              hideSectionTitle
              stripeAccountLinkPaths={{
                return: '/onboarding?stripe=success',
                refresh: '/onboarding?stripe=refresh',
              }}
            />
          </div>
        )}

        {/* Profile step */}
        {currentStepKey === 'profile' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Tell us about your business</h2>
            <p className="mb-6 text-sm text-slate-500">
              This information will appear on your booking page.
            </p>
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Business name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Business name"
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-1.5 block text-sm font-medium text-slate-700">Business address</legend>
                <p className="text-xs text-slate-500">
                  Same format as Settings → Venue profile. You can add a building name if you like.
                </p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Building / venue name (optional)</label>
                  <input
                    type="text"
                    value={addressName}
                    onChange={(e) => setAddressName(e.target.value)}
                    placeholder="e.g. The Old Mill"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Street *</label>
                  <input
                    type="text"
                    value={addressStreet}
                    onChange={(e) => setAddressStreet(e.target.value)}
                    placeholder="e.g. 12 Main Street"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Town / city *</label>
                    <input
                      type="text"
                      value={addressTown}
                      onChange={(e) => setAddressTown(e.target.value)}
                      placeholder="e.g. Belfast"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Postcode *</label>
                    <input
                      type="text"
                      value={addressPostcode}
                      onChange={(e) => setAddressPostcode(e.target.value)}
                      placeholder="e.g. BT1 1AA"
                      className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      autoComplete="postal-code"
                    />
                  </div>
                </div>
              </fieldset>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Phone
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Business email <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={businessEmail}
                    onChange={(e) => setBusinessEmail(e.target.value)}
                    placeholder="hello@example.com"
                    autoComplete="email"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Used as the venue contact and reply-to address for guest emails.
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Business website <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    inputMode="url"
                    value={businessWebsiteUrl}
                    onChange={(e) => setBusinessWebsiteUrl(e.target.value)}
                    placeholder="example.com or https://example.com"
                    autoComplete="url"
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-500">
                    Shown on your public booking page when set.
                  </p>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Currency
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                >
                  {CURRENCY_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {currentStepKey === 'opening_hours' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Set your opening hours</h2>
            <p className="mb-4 text-sm text-slate-500">
              These are the broad weekly hours when your business accepts online bookings. Set them generously, and
              you can always narrow per-calendar hours in the next step.
            </p>
            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-sm font-medium text-slate-800">How booking availability works</p>
              <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm text-slate-600">
                <li>
                  <strong className="text-slate-800">Business opening hours</strong> (this step) are the outer
                  limit for all online bookings.
                </li>
                <li>
                  <strong className="text-slate-800">Calendar availability</strong> (next step) narrows that down
                  per person, room, or resource.
                </li>
                <li>A time is bookable only when <strong>both</strong> are open.</li>
              </ul>
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                <p>
                  Example: business 09:00–18:00, therapist 10:00–16:00 → bookable times for that therapist are
                  10:00–16:00.
                </p>
                <p>
                  Example: business open all day, but Room A blocked 14:00–15:00 → Room A is not bookable in that
                  hour.
                </p>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Tip: closing for a holiday or a day off? Toggle the day to <strong>Closed</strong>. You can also
                add date-specific closures from Calendar availability later.
              </p>
            </div>
            <OpeningHoursControl value={openingHoursDraft} onChange={setOpeningHoursDraft} />
          </div>
        )}

        {/* Restaurant plan steps */}
        {currentStepKey === 'r_welcome' && (
          <RestaurantWelcomeStep onContinue={() => void advanceRestaurantStep()} />
        )}

        {currentStepKey === 'r_opening_hours' && (
          <OpeningHoursStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_services' && (
          <ServicesStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_table_mode' && (
          <TableModeStep
            onDone={advanceRestaurantStep}
            onModeSelected={(advanced) => setTableManagementEnabled(advanced)}
          />
        )}

        {currentStepKey === 'r_table_setup' && (
          <TableSetupStep onDone={advanceRestaurantStep} />
        )}

        {currentStepKey === 'r_dashboard' && (
          <DashboardOrientationStep
            onDone={advanceRestaurantStep}
            tableManagementEnabled={tableManagementEnabled}
          />
        )}

        {/* Legacy restaurant_setup step (no longer reached by new signups) */}
        {currentStepKey === 'restaurant_setup' && (
          <div className="text-center">
            <h2 className="mb-2 text-lg font-bold text-slate-900">Restaurant setup</h2>
            <p className="mb-4 text-sm text-slate-500">
              Next you&apos;ll see a short summary and your booking link. After that, a dedicated step on your
              dashboard will set up service periods, table capacity, party sizes, and deposit rules for your
              reservations.
            </p>
          </div>
        )}

        {/* Model B: Team / calendars (all appointment-style plans: same add/remove UI) */}
        {currentStepKey === 'team' && venue && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set up your calendars' : unifiedTeamStepLabel(terms)}
            </h2>
            {isLightPlanVenue ? (
              <p className="mb-4 text-sm text-slate-500">
                Appointments Light is limited to one bookable calendar and one user. Give your calendar a name
                (usually your name or business name), and you’ll set its working hours next. Need more calendars or
                team logins? Upgrade under{' '}
                <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-600 underline hover:text-brand-700">
                  Settings → Plan
                </Link>
                .
              </p>
            ) : isPlusPlanTier(venue.pricing_tier) ? (
              <p className="mb-4 text-sm text-slate-500">
                Add a <strong>calendar column</strong> for each lane on your schedule — your Appointments
                Plus plan includes up to <strong>5 calendar columns</strong>. You can add or remove columns
                any time from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>
                .
              </p>
            ) : (
              <p className="mb-4 text-sm text-slate-500">
                Add a <strong>calendar column</strong> for each lane on your schedule. You can add or remove
                columns any time from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>
                .
              </p>
            )}

            {!isLightPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                <p className="mb-2 font-medium text-slate-800">What’s a calendar column?</p>
                <p className="mb-3 text-slate-600">
                  Think of it as a lane on your daily schedule. Each column has its own working hours and its own
                  bookings. Columns usually represent one of:
                </p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li>
                    <strong className="text-slate-800">A person</strong>, e.g. a therapist, stylist, tutor, or
                    practitioner.
                  </li>
                  <li>
                    <strong className="text-slate-800">A room or chair</strong>, e.g. Treatment room 1, Chair A.
                  </li>
                  <li>
                    <strong className="text-slate-800">A resource or category</strong>, e.g. Court 1, Studio, or
                    “Walk-ins”.
                  </li>
                </ul>
                <p className="mt-3 text-xs text-slate-500">
                  Tip: many businesses mirror their physical space (one column per chair, one per room). You can
                  change the setup later without losing history.
                </p>
              </div>
            )}
            <div className="mb-6 space-y-3">
              {practitioners.map((p, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-slate-200 p-4 transition-shadow hover:shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Calendar {i + 1}
                    </span>
                    {!isLightPlanVenue && practitioners.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPractitioners(practitioners.filter((_, j) => j !== i))}
                        className="shrink-0 text-xs font-medium text-slate-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {isAppointmentsPlanVenue ? (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => {
                          const updated = [...practitioners];
                          updated[i] = { ...p, name: e.target.value };
                          setPractitioners(updated);
                        }}
                        placeholder="Calendar name or resource label"
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Name <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={p.name}
                          onChange={(e) => {
                            const updated = [...practitioners];
                            updated[i] = { ...p, name: e.target.value };
                            setPractitioners(updated);
                          }}
                          placeholder="e.g. Staff name or room label"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Email <span className="font-normal text-slate-400">(optional)</span>
                        </label>
                        <input
                          type="email"
                          value={p.email}
                          onChange={(e) => {
                            const updated = [...practitioners];
                            updated[i] = { ...p, email: e.target.value };
                            setPractitioners(updated);
                          }}
                          placeholder="name@example.com"
                          className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isPlusPlanTier(venue.pricing_tier) && calendarPlanLimit !== Infinity && (
                <p className="mb-2 text-right text-xs text-slate-500">
                  {practitioners.length} / {calendarPlanLimit} calendars
                </p>
              )}
              {isLightPlanVenue && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
                  Appointments Light includes <strong>1 calendar</strong>, so additional calendars cannot be
                  created during onboarding. You can upgrade later if you need separate calendars for extra staff,
                  rooms, or resources.
                </div>
              )}
              {!isLightPlanVenue && !calendarDraftAtLimit && (
                <button
                  type="button"
                  onClick={() => setPractitioners([...practitioners, { name: '', email: '' }])}
                  className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm font-medium text-slate-500 transition-colors hover:border-brand-300 hover:text-brand-600"
                >
                  + Add calendar
                </button>
              )}
              {isPlusPlanTier(venue.pricing_tier) && calendarDraftAtLimit && (
                <p className="mt-1 text-center text-xs text-slate-500">
                  You&apos;ve reached the {calendarPlanLimit}-calendar limit on your Appointments Plus
                  plan. Remove one above to add a different calendar, or upgrade from{' '}
                  <Link href="/dashboard/settings?tab=plan" className="font-medium text-brand-600 underline hover:text-brand-700">
                    Settings → Plan
                  </Link>
                  .
                </p>
              )}
            </div>
          </div>
        )}

        {currentStepKey === 'users' && (
          <OnboardingStaffInviteStep
            invites={staffInvites}
            setInvites={setStaffInvites}
            staffLimit={entitlement?.staff_limit ?? null}
            existingStaffCount={entitlement?.active_staff}
          />
        )}

        {currentStepKey === 'services' && isUnifiedSchedulingVenue(venue.booking_model) && (
            <div>
              <h2 className="mb-1 text-lg font-bold text-slate-900">
                {isAppointmentsPlanVenue ? 'Set up appointments' : 'Your services'}
              </h2>
              <p className="mb-4 text-sm text-slate-500">
                A <strong>service</strong> is anything guests book one-to-one with you: a consultation, a
                treatment, a lesson, a grooming session. Each service has its own duration, price, and rules.
              </p>
              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
                <p className="mb-2 font-medium text-slate-800">For each service you can set…</p>
                <ul className="list-inside list-disc space-y-1 text-slate-600">
                  <li>
                    <strong className="text-slate-800">Duration</strong> and an optional{' '}
                    <strong>buffer</strong> (gap between bookings for cleaning, notes, or travel).
                  </li>
                  <li>
                    <strong className="text-slate-800">Price</strong> and whether guests pay online, pay in
                    person, or leave a deposit.
                  </li>
                  <li>
                    <strong className="text-slate-800">Guest booking rules</strong>: min/max notice and how far
                    ahead guests can book.
                  </li>
                  {!isLightPlanVenue && (
                    <li>
                      <strong className="text-slate-800">Which calendars</strong> offer the service, with
                      optional per-calendar overrides.
                    </li>
                  )}
                </ul>
                <p className="mt-2 text-xs italic text-slate-500">
                  e.g. “60 min massage, £55, deposit £10 on booking, bookable 2 hours to 30 days ahead”.
                </p>
              </div>
              <p className="mb-6 text-xs text-slate-500">
                Adding services now is optional. You can leave this blank and add or refine services later under{' '}
                <Link
                  href="/dashboard/appointment-services"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Services
                </Link>
                . Pro tip: add your 1–3 most popular services now so your booking page looks finished on day one.
              </p>
              <OnboardingAppointmentServiceList
                currencySymbol={currencySymbol(currency)}
                terms={terms}
                services={services}
                setServices={setServices}
                roster={rosterList}
                rosterIds={rosterIds}
                venueIsAdmin={venue.is_admin}
                stripeConnected={stripeConnected}
                hideStaffCustomization={isLightPlanVenue}
                venueOpeningHours={isAppointmentsPlanVenue ? null : (openingHoursDraft as unknown as OpeningHours)}
                calendarWorkingHoursById={calendarWorkingDraft}
                inlineAddCalendar={
                  venue.is_admin
                    ? {
                        entitlementLoaded,
                        canAddCalendar,
                        entitlement,
                        onAddCalendar: () => openInlineAddCalendar({ kind: 'service' }),
                      }
                    : null
                }
              />
            </div>
          )}

        {currentStepKey === 'hours' &&
          (isAppointmentsPlanVenue || isUnifiedSchedulingVenue(venue.booking_model)) && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set calendar availability' : 'Opening hours & schedules'}
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              {isAppointmentsPlanVenue
                ? `Set when each calendar can take bookings. Guests see a time slot only when business opening hours and the calendar’s working hours both allow it.`
                : `Set when the business accepts appointments and when each ${terms.staff.toLowerCase()} is available. You can adjust breaks, day-off, and custom schedules any time from Calendar availability.`
              }
            </p>

            <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-800">How the hours fit together</p>
              <ul className="list-inside list-disc space-y-1.5 text-slate-600">
                <li>
                  <strong className="text-slate-800">Business opening hours</strong> are the outer window for all
                  bookings.
                </li>
                <li>
                  <strong className="text-slate-800">Calendar working hours</strong> narrow that down per column
                  (for example, one therapist works mornings, another evenings).
                </li>
                <li>A time is bookable only where <strong>both</strong> are open.</li>
              </ul>
              <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
                <p>Example: business 09:00–18:00, therapist 10:00–16:00 → guests can book 10:00–16:00.</p>
                <p>Example: business 09:00–18:00, Room A blocked 14:00–15:00 → no bookings in Room A in that hour.</p>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Breaks, day-off, and date-specific closures can be added from{' '}
                <Link
                  href="/dashboard/calendar-availability"
                  className="font-medium text-brand-600 underline hover:text-brand-700"
                >
                  Calendar availability
                </Link>{' '}
                any time.
              </p>
            </div>
            {!isAppointmentsPlanVenue && (
              <div className="mb-8">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">Business opening hours</h3>
                <p className="mb-4 text-xs text-slate-500">
                  Guest booking slots are limited to times when you are open and when staff are working.
                </p>
                <OpeningHoursControl value={openingHoursDraft} onChange={setOpeningHoursDraft} />
              </div>
            )}
            <div className="space-y-10">
              {rosterList.map((cal) => (
                <div key={cal.id}>
                  <h3 className="mb-3 text-sm font-semibold text-slate-800">
                    {cal.name}: working hours
                  </h3>
                  <WorkingHoursControl
                    value={
                      calendarWorkingDraft[cal.id] ??
                      defaultCalendarWorkingHoursFromOpeningHours(openingHoursDraft)
                    }
                    onChange={(wh) =>
                      setCalendarWorkingDraft((prev) => ({
                        ...prev,
                        [cal.id]: wh,
                      }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Model C: First event: aligned with dashboard Event manager → Create event */}
        {currentStepKey === 'first_event' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set up your first event (optional)' : 'Set up your first event'}
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              An <strong>event</strong> is a one-off or recurring ticketed occasion with a fixed start time and
              limited capacity, such as a wine tasting, masterclass, guided tour, or supper club. Guests book a
              ticket from your public Events tab.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-800">In this step you can…</p>
              <ul className="list-inside list-disc space-y-1 text-slate-600">
                <li>
                  Pick a <strong className="text-slate-800">schedule</strong>: one-off date, weekly recurrence,
                  or custom dates (one event row is created per date).
                </li>
                <li>
                  Set <strong className="text-slate-800">capacity</strong>, <strong>price</strong>, and one or
                  more <strong>ticket types</strong> (e.g. Adult / Child).
                </li>
                <li>
                  Choose which <strong className="text-slate-800">calendar column</strong> the event appears on
                  so it doesn’t clash with other bookings.
                </li>
                <li>
                  Add an image, description, and guest rules, all editable later from Event manager.
                </li>
              </ul>
            </div>
            {isAppointmentsPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Optional: skip if you’d rather</p>
                <p className="mt-1">
                  Leave the form empty and click Continue to skip. You can create events any time from{' '}
                  <Link
                    href="/dashboard/event-manager"
                    className="font-medium text-brand-600 underline hover:text-brand-700"
                  >
                    Event manager
                  </Link>
                  .
                </p>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="space-y-2 border-b border-slate-100 px-5 py-4">
                <h3 className="font-semibold text-slate-800">Create event</h3>
                <p className="text-xs text-slate-500">
                  Online payment defaults to None during onboarding; connect Stripe under Settings → Payments before
                  accepting deposits or card payments.
                </p>
              </div>
              <div className="space-y-4 px-5 py-4">
                <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                  <p className="mb-2 text-xs font-medium text-slate-700">Schedule</p>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="onb_event_sched"
                        checked={eventDraft.scheduleMode === 'single'}
                        onChange={() => setEventDraft((f) => ({ ...f, scheduleMode: 'single' }))}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-slate-700">One date</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="onb_event_sched"
                        checked={eventDraft.scheduleMode === 'weekly'}
                        onChange={() => setEventDraft((f) => ({ ...f, scheduleMode: 'weekly' }))}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-slate-700">Weekly (same weekday)</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="onb_event_sched"
                        checked={eventDraft.scheduleMode === 'custom'}
                        onChange={() => setEventDraft((f) => ({ ...f, scheduleMode: 'custom' }))}
                        className="text-brand-600 focus:ring-brand-500"
                      />
                      <span className="text-slate-700">Custom dates</span>
                    </label>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Weekly and custom create one event row per date (same ticket setup on each).
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Event name *</label>
                    <input
                      type="text"
                      value={eventDraft.name}
                      onChange={(e) => setEventDraft((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Seasonal tasting, Workshop"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  {eventDraft.scheduleMode !== 'custom' ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          {eventDraft.scheduleMode === 'weekly' ? 'First occurrence *' : 'Date *'}
                        </label>
                        <input
                          type="date"
                          value={eventDraft.event_date}
                          onChange={(e) => setEventDraft((f) => ({ ...f, event_date: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                        />
                      </div>
                      {eventDraft.scheduleMode === 'weekly' && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Repeat until *</label>
                          <input
                            type="date"
                            value={eventDraft.recurrenceUntil}
                            onChange={(e) => setEventDraft((f) => ({ ...f, recurrenceUntil: e.target.value }))}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Dates * (YYYY-MM-DD)</label>
                      <textarea
                        rows={4}
                        value={eventDraft.customDatesText}
                        onChange={(e) => setEventDraft((f) => ({ ...f, customDatesText: e.target.value }))}
                        placeholder={'2026-06-01\n2026-06-15\n2026-07-01'}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Capacity *</label>
                    <NumericInput
                      min={1}
                      value={eventDraft.capacity}
                      onChange={(v) => setEventDraft((f) => ({ ...f, capacity: v }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Start time *</label>
                    <input
                      type="time"
                      value={eventDraft.start_time}
                      onChange={(e) => setEventDraft((f) => ({ ...f, start_time: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">End time *</label>
                    <input
                      type="time"
                      value={eventDraft.end_time}
                      onChange={(e) => setEventDraft((f) => ({ ...f, end_time: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-700">Guest booking rules</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                        <NumericInput
                          min={1}
                          max={365}
                          value={eventDraft.max_advance_booking_days}
                          onChange={(v) =>
                            setEventDraft((f) => ({
                              ...f,
                              max_advance_booking_days: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Min notice (hours)</label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={eventDraft.min_booking_notice_hours}
                          onChange={(v) =>
                            setEventDraft((f) => ({
                              ...f,
                              min_booking_notice_hours: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Cancellation notice (hours)
                        </label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={eventDraft.cancellation_notice_hours}
                          onChange={(v) =>
                            setEventDraft((f) => ({
                              ...f,
                              cancellation_notice_hours: v,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={eventDraft.allow_same_day_booking}
                            onChange={(e) =>
                              setEventDraft((f) => ({ ...f, allow_same_day_booking: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Allow same-day bookings
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="sm:col-span-2 space-y-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                    <p className="text-xs font-medium text-slate-700">Calendar column</p>
                    <p className="text-xs text-slate-500">
                      Show this event on a team calendar column in the dashboard. The time must not overlap other
                      appointments, classes, resources on that column, or blocked time.
                      {venue.is_admin && (
                        <span className="mt-1 block text-slate-600">
                          Choosing a column here also decides which staff can edit or delete this event later.
                        </span>
                      )}
                    </p>
                    {isAppointmentsPlanVenue && rosterList.length === 0 && (
                      <p className="text-xs text-amber-800">
                        Loading team calendars… If this persists, go back to the Calendars step and use Continue to save
                        your columns.
                      </p>
                    )}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Calendar</label>
                      <select
                        value={eventDraft.calendar_id}
                        onChange={(e) => setEventDraft((f) => ({ ...f, calendar_id: e.target.value }))}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      >
                        <option value="">
                          {rosterList.length === 0 ? 'Loading calendars…' : 'Not assigned to a calendar'}
                        </option>
                        {rosterList.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {venue.is_admin && (
                        <div className="mt-2">
                          <OnboardingInlineAddCalendarControls
                            entitlementLoaded={entitlementLoaded}
                            canAddCalendar={canAddCalendar}
                            entitlement={entitlement}
                            onAddCalendar={() => openInlineAddCalendar({ kind: 'event' })}
                            layout="event"
                            helperWhenCanAdd={
                              <>
                                Create a new team calendar column here without leaving onboarding. It is selected for
                                this event automatically.
                              </>
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Description <span className="font-normal text-slate-400">optional</span>
                    </label>
                    <textarea
                      rows={2}
                      value={eventDraft.description}
                      onChange={(e) => setEventDraft((f) => ({ ...f, description: e.target.value }))}
                      placeholder="Briefly describe the event for guests…"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Image URL <span className="font-normal text-slate-400">optional</span>
                    </label>
                    <input
                      type="url"
                      value={eventDraft.image_url}
                      onChange={(e) => setEventDraft((f) => ({ ...f, image_url: e.target.value }))}
                      placeholder="https://…"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                    />
                    {/^https?:\/\//i.test(eventDraft.image_url.trim()) && (
                      <div className="mt-2">
                        <p className="mb-1 text-xs text-slate-500">Preview</p>
                        <img
                          src={eventDraft.image_url.trim()}
                          alt=""
                          className="max-h-40 max-w-full rounded-lg border border-slate-200 object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-medium text-slate-700">Ticket types</h3>
                  <div className="space-y-2">
                    {eventDraft.ticket_types.map((tt, i) => (
                      <div
                        key={i}
                        className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1 sm:min-w-[140px]">
                          <label className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm">
                            Ticket name
                          </label>
                          <input
                            type="text"
                            value={tt.name}
                            onChange={(e) => updateEventTicketType(i, { name: e.target.value })}
                            placeholder="e.g. General Admission"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          />
                        </div>
                        <div className="w-full min-w-0 sm:w-28">
                          <label className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm">
                            Price ({sym})
                          </label>
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={tt.price_pence}
                            onChange={(e) => updateEventTicketType(i, { price_pence: e.target.value })}
                            placeholder="0.00"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          />
                        </div>
                        <div className="w-full min-w-0 sm:w-24">
                          <label className="mb-1 block text-xs font-medium text-slate-500 sm:text-sm">
                            Cap <span className="font-normal text-slate-400">opt.</span>
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            value={tt.capacity}
                            onChange={(e) => updateEventTicketType(i, { capacity: e.target.value })}
                            placeholder="-"
                            className="w-full rounded border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          />
                        </div>
                        {eventDraft.ticket_types.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeEventTicketType(i)}
                            className="min-h-10 self-end rounded-lg px-2 text-sm font-medium text-red-500 hover:bg-red-50 hover:text-red-700"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addEventTicketType}
                    className="mt-2 text-sm font-medium text-brand-600 hover:text-brand-800"
                  >
                    + Add ticket type
                  </button>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Online payment (Stripe)</label>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="onb_event_payment"
                        className="mt-0.5"
                        checked={eventDraft.payment_requirement === 'none'}
                        onChange={() =>
                          setEventDraft((f) => ({ ...f, payment_requirement: 'none', deposit_pounds: '' }))
                        }
                      />
                      <span>None - pay at venue or free event</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="onb_event_payment"
                        className="mt-0.5"
                        checked={eventDraft.payment_requirement === 'deposit'}
                        onChange={() => setEventDraft((f) => ({ ...f, payment_requirement: 'deposit' }))}
                      />
                      <span>Deposit per person (partial payment online)</span>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="onb_event_payment"
                        className="mt-0.5"
                        checked={eventDraft.payment_requirement === 'full_payment'}
                        onChange={() =>
                          setEventDraft((f) => ({ ...f, payment_requirement: 'full_payment', deposit_pounds: '' }))
                        }
                      />
                      <span>Full payment online (per ticket)</span>
                    </label>
                  </div>
                  {eventDraft.payment_requirement === 'deposit' && (
                    <div className="mt-3 max-w-xs">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Deposit amount ({sym}) *</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={eventDraft.deposit_pounds}
                        onChange={(e) => setEventDraft((f) => ({ ...f, deposit_pounds: e.target.value }))}
                        placeholder="e.g. 5.00"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                      />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Deposit and full payment require ticket prices &gt; 0 and a connected Stripe account.
                  </p>
                  <StripePaymentWarning
                    stripeConnected={stripeConnected}
                    requiresOnlinePayment={
                      eventDraft.payment_requirement === 'deposit' ||
                      eventDraft.payment_requirement === 'full_payment'
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Model D: Classes: class types only (timetable & sessions: dashboard → Class timetable) */}
        {currentStepKey === 'classes' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">Set up your classes</h2>
            <p className="mb-4 text-sm text-slate-500">
              A <strong>class type</strong> is the template for a recurring group session: a yoga class, a
              pottery workshop, a weekly swim lesson. Here you define what each session looks like; you’ll
              schedule the weekly rota from the dashboard in the next step.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-800">For each class type you can set…</p>
              <ul className="list-inside list-disc space-y-1 text-slate-600">
                <li>
                  <strong className="text-slate-800">Name &amp; description</strong> shown on your booking page.
                </li>
                <li>
                  <strong className="text-slate-800">Duration</strong> and{' '}
                  <strong>capacity</strong> (maximum guests per session).
                </li>
                <li>
                  <strong className="text-slate-800">Price</strong> and optional online payment or deposit.
                </li>
                <li>
                  Which <strong className="text-slate-800">calendar column</strong> the sessions appear on, plus
                  an optional instructor label and colour.
                </li>
              </ul>
              <p className="mt-2 text-xs italic text-slate-500">
                e.g. “Beginner yoga, 60 min, 12 spots, £10”.
              </p>
            </div>
            <p className="mb-6 text-xs text-slate-500">
              Once saved, head to{' '}
              <Link href="/dashboard/class-timetable" className="font-medium text-brand-600 underline hover:text-brand-700">
                Class timetable
              </Link>{' '}
              to set the weekly rota (day, time, repeat) and generate bookable sessions for guests. You can skip
              this step and add class types later if you prefer.
            </p>
            <div className="space-y-4">
              {classes.map((c, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      {classes.length > 1 ? `Class type ${i + 1}` : 'New class type'}
                    </h3>
                    {classes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setClasses(classes.filter((_, j) => j !== i))}
                        className="text-xs font-medium text-slate-400 hover:text-red-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="space-y-6">
                    <section className="space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basics</h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium text-slate-600">Name *</label>
                          <input
                            type="text"
                            value={c.name}
                            onChange={(e) => {
                              const updated = [...classes];
                              updated[i] = { ...c, name: e.target.value };
                              setClasses(updated);
                            }}
                            placeholder="e.g. Beginner session, Open studio"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium text-slate-600">Description</label>
                          <textarea
                            value={c.description}
                            onChange={(e) => {
                              const updated = [...classes];
                              updated[i] = { ...c, description: e.target.value };
                              setClasses(updated);
                            }}
                            rows={3}
                            placeholder="Shown to guests on the booking page."
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Colour</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={c.colour}
                              onChange={(e) => {
                                const updated = [...classes];
                                updated[i] = { ...c, colour: e.target.value };
                                setClasses(updated);
                              }}
                              className="h-9 w-12 cursor-pointer rounded border border-slate-200 p-0.5"
                            />
                            <span className="text-xs text-slate-500">{c.colour}</span>
                          </div>
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                            <input
                              id={`onb-class-active-${i}`}
                              type="checkbox"
                              checked={c.is_active}
                              onChange={(e) => {
                                const updated = [...classes];
                                updated[i] = { ...c, is_active: e.target.checked };
                                setClasses(updated);
                              }}
                              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                            />
                            <span>Active (visible to guests)</span>
                          </label>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3 border-t border-slate-100 pt-5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Session defaults
                      </h4>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Duration (minutes)</label>
                          <NumericInput
                            min={5}
                            max={480}
                            value={c.duration_minutes}
                            onChange={(v) => {
                              const updated = [...classes];
                              updated[i] = {
                                ...c,
                                duration_minutes: v,
                              };
                              setClasses(updated);
                            }}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-600">Capacity (spots)</label>
                          <NumericInput
                            min={1}
                            value={c.capacity}
                            onChange={(v) => {
                              const updated = [...classes];
                              updated[i] = { ...c, capacity: v };
                              setClasses(updated);
                            }}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-medium text-slate-600">Calendar column *</label>
                          <p className="mb-2 text-xs text-slate-500">
                            Pick the team calendar column this class occupies in the schedule.
                          </p>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                            <select
                              value={c.instructor_id}
                              onChange={(e) => {
                                const updated = [...classes];
                                updated[i] = { ...c, instructor_id: e.target.value };
                                setClasses(updated);
                              }}
                              className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm"
                              required
                            >
                              <option value="" disabled>
                                Choose a calendar…
                              </option>
                              {rosterList.length > 0 && (
                                <optgroup label="Calendar columns">
                                  {rosterList.map((cal) => (
                                    <option key={cal.id} value={cal.id}>
                                      {cal.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            <div className="min-w-0 flex-1">
                              <label className="mb-1 block text-xs font-medium text-slate-600">
                                Instructor label (optional)
                              </label>
                              <input
                                type="text"
                                value={c.instructor_custom_name}
                                onChange={(e) => {
                                  const updated = [...classes];
                                  updated[i] = { ...c, instructor_custom_name: e.target.value };
                                  setClasses(updated);
                                }}
                                placeholder="Shown to guests instead of the calendar name"
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                              />
                            </div>
                          </div>
                          {venue.is_admin && (
                            <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 p-3">
                              <OnboardingInlineAddCalendarControls
                                entitlementLoaded={entitlementLoaded}
                                canAddCalendar={canAddCalendar}
                                entitlement={entitlement}
                                onAddCalendar={() => openInlineAddCalendar({ kind: 'class', index: i })}
                                layout="panel"
                                helperWhenCanAdd={
                                  <>
                                    Create a new team calendar column without leaving onboarding. It is selected for
                                    this class type automatically. You can edit weekly hours anytime in{' '}
                                    <Link
                                      href="/dashboard/calendar-availability"
                                      className="font-medium text-brand-700 underline hover:text-brand-800"
                                    >
                                      Calendar availability
                                    </Link>
                                    .
                                  </>
                                }
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3 border-t border-slate-100 pt-5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Guest booking rules
                      </h4>
                      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                            <NumericInput
                              min={1}
                              max={365}
                              value={c.max_advance_booking_days}
                              onChange={(v) => {
                                const updated = [...classes];
                                updated[i] = {
                                  ...c,
                                  max_advance_booking_days: v,
                                };
                                setClasses(updated);
                              }}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Min notice (hours)
                            </label>
                            <NumericInput
                              min={0}
                              max={168}
                              value={c.min_booking_notice_hours}
                              onChange={(v) => {
                                const updated = [...classes];
                                updated[i] = {
                                  ...c,
                                  min_booking_notice_hours: v,
                                };
                                setClasses(updated);
                              }}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Cancellation notice (hours)
                            </label>
                            <NumericInput
                              min={0}
                              max={168}
                              value={c.cancellation_notice_hours}
                              onChange={(v) => {
                                const updated = [...classes];
                                updated[i] = {
                                  ...c,
                                  cancellation_notice_hours: v,
                                };
                                setClasses(updated);
                              }}
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                          </div>
                          <div className="flex items-end pb-1">
                            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                checked={c.allow_same_day_booking}
                                onChange={(e) => {
                                  const updated = [...classes];
                                  updated[i] = { ...c, allow_same_day_booking: e.target.checked };
                                  setClasses(updated);
                                }}
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              Allow same-day bookings
                            </label>
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-3 border-t border-slate-100 pt-5">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Price & online payment
                      </h4>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Price ({sym}) <span className="font-normal text-slate-400">optional</span>
                        </label>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={c.price}
                          onChange={(e) => {
                            const updated = [...classes];
                            updated[i] = { ...c, price: e.target.value };
                            setClasses(updated);
                          }}
                          placeholder="0.00"
                          className="w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-xs font-medium text-slate-600">
                          Online payment (Stripe)
                        </label>
                        <div className="space-y-2">
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                            <input
                              type="radio"
                              name={`onb-class-${i}-payment`}
                              className="mt-0.5"
                              checked={c.payment_requirement === 'none'}
                              onChange={() => {
                                const updated = [...classes];
                                updated[i] = { ...c, payment_requirement: 'none', deposit_pounds: '' };
                                setClasses(updated);
                              }}
                            />
                            <span>None: pay at venue or free class</span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                            <input
                              type="radio"
                              name={`onb-class-${i}-payment`}
                              className="mt-0.5"
                              checked={c.payment_requirement === 'deposit'}
                              onChange={() => {
                                const updated = [...classes];
                                updated[i] = { ...c, payment_requirement: 'deposit' };
                                setClasses(updated);
                              }}
                            />
                            <span>Deposit per person (partial payment online)</span>
                          </label>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                            <input
                              type="radio"
                              name={`onb-class-${i}-payment`}
                              className="mt-0.5"
                              checked={c.payment_requirement === 'full_payment'}
                              onChange={() => {
                                const updated = [...classes];
                                updated[i] = {
                                  ...c,
                                  payment_requirement: 'full_payment',
                                  deposit_pounds: '',
                                };
                                setClasses(updated);
                              }}
                            />
                            <span>Full payment online (per person)</span>
                          </label>
                        </div>
                        {c.payment_requirement === 'deposit' && (
                          <div className="mt-3 max-w-xs">
                            <label className="mb-1 block text-xs font-medium text-slate-600">
                              Deposit amount ({sym}) *
                            </label>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={c.deposit_pounds}
                              onChange={(e) => {
                                const updated = [...classes];
                                updated[i] = { ...c, deposit_pounds: e.target.value };
                                setClasses(updated);
                              }}
                              placeholder="e.g. 5.00"
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                        )}
                        <p className="mt-2 text-xs text-slate-500">
                          Deposit and full payment require a price per person and a connected Stripe account.
                        </p>
                        <StripePaymentWarning
                          stripeConnected={stripeConnected}
                          requiresOnlinePayment={
                            c.payment_requirement === 'deposit' || c.payment_requirement === 'full_payment'
                          }
                        />
                      </div>
                    </section>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setClasses([...classes, createEmptyClassDraft(rosterList[0]?.id ?? '')])}
                className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-brand-300 hover:text-brand-600"
              >
                + Add another class type
              </button>
            </div>
          </div>
        )}

        {/* Model E: Resources: aligned with dashboard Resource timeline (no date-exception calendar) */}
        {currentStepKey === 'resources' && (
          <div>
            <h2 className="mb-1 text-lg font-bold text-slate-900">
              {isAppointmentsPlanVenue ? 'Set up bookable resources (optional)' : 'Set up your resources'}
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              A <strong>resource</strong> is anything guests rent by the slot: a tennis court, a meeting room, a
              lane, a desk, a piece of kit. Each resource has its own weekly availability, booking time grid, and
              pricing.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-800">For each resource you can set…</p>
              <ul className="list-inside list-disc space-y-1 text-slate-600">
                <li>
                  <strong className="text-slate-800">Type</strong>: court, room, desk, equipment, or your own
                  label.
                </li>
                <li>
                  <strong className="text-slate-800">Start-time step</strong> and booking length (shortest / longest,
                  advance notice).
                </li>
                <li>
                  <strong className="text-slate-800">Pricing</strong> per step of that grid, with optional online
                  payment or deposit.
                </li>
                <li>
                  Which <strong className="text-slate-800">calendar column</strong> it appears on so staff see
                  it alongside other bookings.
                </li>
              </ul>
              <p className="mt-2 text-xs italic text-slate-500">
                e.g. “Court 1, start every 60 minutes, £12 per hour, Mon–Sun 09:00–21:00”.
              </p>
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Date-specific closures or custom hours (e.g. public holidays, maintenance days) can be added later
              from{' '}
              <Link href="/dashboard/resource-timeline" className="font-medium text-brand-600 underline hover:text-brand-700">
                Resource timeline
              </Link>
              .
            </p>
            {isAppointmentsPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">Optional: skip if you’d rather</p>
                <p className="mt-1">
                  Leave the form empty and click Continue to skip, or add one or more resources now. You can add
                  more any time from the dashboard.
                </p>
              </div>
            )}
            <div className="space-y-4">
              {resources.map((r, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4 space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="mb-1 block text-xs font-medium text-slate-600">Resource name *</label>
                      <input
                        type="text"
                        value={r.name}
                        onChange={(e) => {
                          const updated = [...resources];
                          updated[i] = { ...r, name: e.target.value };
                          setResources(updated);
                        }}
                        placeholder="e.g. Court 1, Studio A"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    {resources.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setResources(resources.filter((_, j) => j !== i))}
                        className="mt-7 shrink-0 text-xs text-slate-400 hover:text-red-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {venue.is_admin && (
                    <div className="rounded-lg border border-blue-100 bg-blue-50/90 px-3 py-2.5 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">Calendar assignment and permissions</p>
                      <p className="mt-1.5 leading-relaxed text-slate-600">
                        You can assign this resource to <strong>any</strong> team calendar column. Staff linked to a
                        column can <strong>create</strong>, <strong>edit</strong>, and{' '}
                        <strong>delete</strong> resources on that column only.
                      </p>
                    </div>
                  )}
                  {!venue.is_admin && (
                    <p className="text-xs leading-relaxed text-slate-600">
                      Choose a calendar column you control under <strong>Show on calendar</strong>. Only admins can
                      assign a resource to columns you do not manage.
                    </p>
                  )}
                  <div>
                    <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                      Type
                      <HelpTooltip
                        icon="?"
                        content="Choose one of the quick-pick types below or write your own label. This is shown to guests as extra context, but it does not change availability, price, or booking rules."
                      />
                    </label>
                    <input
                      type="text"
                      value={r.resource_type}
                      onChange={(e) => {
                        const updated = [...resources];
                        updated[i] = { ...r, resource_type: e.target.value };
                        setResources(updated);
                      }}
                      placeholder="Short label (e.g. meeting room, equipment bay)"
                      autoComplete="off"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Optional. Quick picks (tap to fill — you can still edit the text):
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {RESOURCE_TYPE_SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            const updated = [...resources];
                            updated[i] = { ...r, resource_type: s };
                            setResources(updated);
                          }}
                          className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-100"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="max-w-xl">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Show on calendar *</label>
                    <select
                      value={r.display_on_calendar_id}
                      onChange={(e) => {
                        const updated = [...resources];
                        updated[i] = { ...r, display_on_calendar_id: e.target.value };
                        setResources(updated);
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">
                        {rosterList.length === 0 ? 'Loading team calendars…' : 'Select a calendar column'}
                      </option>
                      {rosterList.map((cal) => (
                        <option key={cal.id} value={cal.id}>
                          {cal.name}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-slate-500">
                      Resource bookings and free slots appear on that calendar. Two resources can use the same calendar
                      only if their weekly hours do not overlap (e.g. 9–1 vs 3–6).
                      {venue.is_admin && (
                        <span className="mt-1 block text-slate-600">
                          Staff can only manage resources tied to calendars they control — choose the column accordingly.
                        </span>
                      )}
                    </p>
                    {venue.is_admin && (
                      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50/90 p-3">
                        <OnboardingInlineAddCalendarControls
                          entitlementLoaded={entitlementLoaded}
                          canAddCalendar={canAddCalendar}
                          entitlement={entitlement}
                          onAddCalendar={() => openInlineAddCalendar({ kind: 'resource', index: i })}
                          layout="panel"
                          helperWhenCanAdd={
                            <>
                              Create a new team calendar column without leaving onboarding. It is selected for this
                              resource automatically. You can edit weekly hours anytime in{' '}
                              <Link
                                href="/dashboard/calendar-availability"
                                className="font-medium text-brand-700 underline hover:text-brand-800"
                              >
                                Calendar availability
                              </Link>
                              .
                            </>
                          }
                        />
                      </div>
                    )}
                  </div>
                  <h3 className="text-sm font-semibold text-slate-800">Booking rules</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    Start times use a fixed step. Online price uses the same step: total = (price per step) × (booking
                    length ÷ step).
                  </p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        Start times every (minutes)
                        <HelpTooltip icon="?" maxWidth={320} content={RESOURCE_SLOT_INTERVAL_HELP} />
                      </label>
                      <NumericInput
                        value={r.slot_interval_minutes}
                        onChange={(v) => {
                          const updated = [...resources];
                          const row = updated[i]!;
                          const nextMin = row.longer_minimum_than_slot
                            ? row.min_booking_minutes
                            : syncedMinBookingMinutesFromSlot(v, RES_MIN_BOOK_MIN);
                          updated[i] = {
                            ...row,
                            slot_interval_minutes: v,
                            min_booking_minutes: nextMin,
                          };
                          setResources(updated);
                        }}
                        min={RES_SLOT_MIN}
                        max={RES_SLOT_MAX}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        {RES_SLOT_MIN}–{RES_SLOT_MAX} minutes.
                      </p>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">Longest booking (minutes)</label>
                      <NumericInput
                        value={r.max_booking_minutes}
                        onChange={(v) => {
                          const updated = [...resources];
                          const row = updated[i]!;
                          updated[i] = {
                            ...row,
                            max_booking_minutes: v,
                          };
                          setResources(updated);
                        }}
                        min={RES_MAX_BOOK_MIN}
                        max={RES_MAX_BOOK_MAX}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      />
                      <p className="mt-1 text-[11px] text-slate-500">
                        {RES_MAX_BOOK_MIN}–{RES_MAX_BOOK_MAX} minutes.
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
                        Shortest booking (minutes)
                        <HelpTooltip icon="?" maxWidth={320} content={RESOURCE_MIN_BOOKING_HELP} />
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-slate-600">
                        <input
                          type="checkbox"
                          checked={r.longer_minimum_than_slot}
                          onChange={(e) => {
                            const updated = [...resources];
                            const row = updated[i]!;
                            const on = e.target.checked;
                            const nextMin = on
                              ? row.min_booking_minutes
                              : syncedMinBookingMinutesFromSlot(row.slot_interval_minutes, RES_MIN_BOOK_MIN);
                            updated[i] = {
                              ...row,
                              longer_minimum_than_slot: on,
                              min_booking_minutes: nextMin,
                            };
                            setResources(updated);
                          }}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        Advanced: longer minimum than start-time step
                      </label>
                    </div>
                    <NumericInput
                      value={r.min_booking_minutes}
                      onChange={(v) => {
                        const updated = [...resources];
                        const row = updated[i]!;
                        updated[i] = {
                          ...row,
                          min_booking_minutes: v,
                        };
                        setResources(updated);
                      }}
                      min={RES_MIN_BOOK_MIN}
                      max={RES_MIN_BOOK_MAX}
                      disabled={!r.longer_minimum_than_slot}
                      className="mt-1.5 w-full max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      {r.longer_minimum_than_slot
                        ? `${RES_MIN_BOOK_MIN}–${RES_MIN_BOOK_MAX} minutes; must be at least the start-time step.`
                        : `Matches the start-time step (minimum ${RES_MIN_BOOK_MIN} minutes).`}
                    </p>
                  </div>
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-700">Guest online booking</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Max advance (days)</label>
                        <NumericInput
                          min={1}
                          max={365}
                          value={r.max_advance_booking_days}
                          onChange={(v) => {
                            const updated = [...resources];
                            updated[i] = { ...updated[i]!, max_advance_booking_days: v };
                            setResources(updated);
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Min notice (hours)</label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={r.min_booking_notice_hours}
                          onChange={(v) => {
                            const updated = [...resources];
                            updated[i] = { ...updated[i]!, min_booking_notice_hours: v };
                            setResources(updated);
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Cancellation notice (hours)
                        </label>
                        <NumericInput
                          min={0}
                          max={168}
                          value={r.cancellation_notice_hours}
                          onChange={(v) => {
                            const updated = [...resources];
                            updated[i] = { ...updated[i]!, cancellation_notice_hours: v };
                            setResources(updated);
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="flex items-end pb-1">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={r.allow_same_day_booking}
                            onChange={(e) => {
                              const updated = [...resources];
                              updated[i] = { ...updated[i]!, allow_same_day_booking: e.target.checked };
                              setResources(updated);
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Allow same-day bookings
                        </label>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-600">
                        {Number.isFinite(r.slot_interval_minutes) && r.slot_interval_minutes > 0
                          ? `Price per ${r.slot_interval_minutes}-minute step (${currencySymbol(currency)})`
                          : `Price per start-time step (${currencySymbol(currency)})`}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                          {currencySymbol(currency)}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={r.pricePerSlot}
                          onChange={(e) => {
                            const updated = [...resources];
                            updated[i] = { ...updated[i]!, pricePerSlot: e.target.value };
                            setResources(updated);
                          }}
                          placeholder="Leave blank for free"
                          className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Charged per step of your start-time grid (see above).
                      </p>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={r.is_active}
                          onChange={(e) => {
                            const updated = [...resources];
                            updated[i] = { ...updated[i]!, is_active: e.target.checked };
                            setResources(updated);
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        Active (bookable by guests)
                      </label>
                    </div>
                  </div>
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-slate-600">Guest payment</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {(
                        [
                          { v: 'none' as const, label: 'Pay at venue' },
                          { v: 'deposit' as const, label: 'Deposit online' },
                          { v: 'full_payment' as const, label: 'Pay in full online' },
                        ] as const
                      ).map((opt) => (
                        <label
                          key={opt.v}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                            r.payment_requirement === opt.v
                              ? 'border-brand-500 bg-brand-50 text-slate-900'
                              : 'border-slate-200 text-slate-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`onb-resource-pay-${i}`}
                            checked={r.payment_requirement === opt.v}
                            onChange={() => {
                              const updated = [...resources];
                              updated[i] = {
                                ...updated[i]!,
                                payment_requirement: opt.v,
                                ...(opt.v !== 'deposit' ? { depositPounds: '' } : {}),
                              };
                              setResources(updated);
                            }}
                            className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                          />
                          {opt.label}
                        </label>
                      ))}
                    </div>
                    <StripePaymentWarning
                      stripeConnected={stripeConnected}
                      requiresOnlinePayment={
                        r.payment_requirement === 'deposit' || r.payment_requirement === 'full_payment'
                      }
                    />
                    {r.payment_requirement === 'deposit' && (
                      <div className="mt-3 max-w-xs">
                        <label className="mb-1 block text-xs font-medium text-slate-600">
                          Deposit amount ({currencySymbol(currency)})
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                            {currencySymbol(currency)}
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            value={r.depositPounds}
                            onChange={(e) => {
                              const updated = [...resources];
                              updated[i] = { ...updated[i]!, depositPounds: e.target.value };
                              setResources(updated);
                            }}
                            placeholder="e.g. 10.00"
                            className="w-full rounded-lg border border-slate-200 py-2 pl-7 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                          />
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Charged when the guest books (Stripe). Balance due at venue if applicable.
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">Weekly availability</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Resource hours can be wider than the calendar, but guests can only book where all opening hours
                      overlap.
                    </p>
                    <WorkingHoursControl
                      value={r.availability_hours}
                      onChange={(wh) => {
                        const updated = [...resources];
                        updated[i] = { ...r, availability_hours: wh };
                        setResources(updated);
                      }}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setResources([...resources, createEmptyResourceDraft(rosterList[0]?.id ?? '')])
                }
                className="w-full rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-brand-300 hover:text-brand-600"
              >
                + Add another resource
              </button>
            </div>
          </div>
        )}

        {/* Preview & Go Live */}
        {currentStepKey === 'preview' && (
          <div className="text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
                <svg
                  className="h-8 w-8 text-brand-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
            </div>
            <h2 className="mb-2 text-lg font-bold text-slate-900">You&apos;re all set!</h2>
            <p className="mb-4 text-sm text-slate-500">
              {venue.booking_model === 'table_reservation' ? (
                <>
                  Your restaurant is ready. Share your booking link below and guests can start making reservations
                  straight away. Refine settings any time from the Availability dashboard.
                </>
              ) : isAppointmentsPlanVenue ? (
                <>
                  Your business is configured and your selected booking models are ready to review in the dashboard.
                  Share the booking link below once you&apos;re happy with how each model looks.
                </>
              ) : (
                <>
                  Your booking page is ready. Share the link below with your {terms.client.toLowerCase()}s.
                </>
              )}
            </p>
            {isAppointmentsPlanVenue && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Ready in this venue
                </p>
                <div className="flex flex-wrap gap-2">
                  {activeAppointmentsModels.map((model) => (
                    <span
                      key={model}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700"
                    >
                      {APPOINTMENTS_MODEL_LABEL[model as AppointmentPlanModel]}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-600">
                  You can add or remove booking models later from Settings if your business needs change.
                </p>
              </div>
            )}
            {venue.booking_model === 'table_reservation' && (
              <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-900/80">
                  You&apos;re ready to take bookings
                </p>
                <p className="text-sm text-slate-700">
                  Your restaurant is configured. Fine-tune services, capacity, booking rules, and table management
                  any time from your <strong>Availability</strong> dashboard.
                </p>
              </div>
            )}
            {(isAppointmentsPlanVenue || isUnifiedSchedulingVenue(venue.booking_model)) && (
              <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50/80 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900/80">
                  Before you go live
                </p>
                <p className="mb-3 text-sm text-slate-700">
                  {!isAppointmentsPlanVenue || activeAppointmentsModels.includes('unified_scheduling')
                    ? 'You have already set services, opening hours, and working hours. Before taking paid bookings, finish Stripe Connect and any advanced availability rules in the dashboard:'
                    : 'You have already set opening hours and calendar availability for your team columns. Before taking paid bookings, finish Stripe Connect and refine availability in the dashboard:'}
                </p>
                <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-600">
                  <li>
                    <Link href="/dashboard/settings" className="font-medium text-brand-600 underline hover:text-brand-700">
                      Settings
                    </Link>
                    : Stripe Connect and venue payment options
                  </li>
                  <li>
                    <Link href="/dashboard/calendar-availability" className="font-medium text-brand-600 underline hover:text-brand-700">
                      Calendar availability
                    </Link>
                    : breaks, closures, and fine-tune schedules anytime
                  </li>
                </ul>
              </div>
            )}
            {!isAppointmentsPlanVenue && enabledSecondaryModels.length > 0 && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50/90 p-4 text-left">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Additional booking types enabled
                </p>
                <p className="mb-3 text-sm text-slate-700">
                  You have extra bookable types on this venue. Finish their catalogues from the dashboard - the setup
                  checklist will link to Events, Classes, or Resources as needed.
                </p>
                <ul className="list-inside list-disc space-y-1.5 text-sm text-slate-600">
                  {enabledSecondaryModels.includes('event_ticket') && (
                    <li>
                      <Link href="/dashboard/event-manager" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Events
                      </Link>
                    </li>
                  )}
                  {enabledSecondaryModels.includes('class_session') && (
                    <li>
                      <Link href="/dashboard/class-timetable" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Classes & timetable
                      </Link>
                    </li>
                  )}
                  {enabledSecondaryModels.includes('resource_booking') && (
                    <li>
                      <Link href="/dashboard/resource-timeline" className="font-medium text-brand-600 underline hover:text-brand-700">
                        Resources
                      </Link>
                    </li>
                  )}
                </ul>
              </div>
            )}
            {venue.slug && (
              <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-medium text-slate-400 mb-1">Your booking page</p>
                <p className="text-sm font-medium text-brand-600 break-all">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/book/
                  {venue.slug}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Back button for restaurant self-managed steps */}
        {RESTAURANT_SELF_MANAGED_STEPS.has(currentStepKey) && step > 0 && !saving && (
          <div className="mt-6 flex">
            <button
              type="button"
              onClick={() => {
                setRevisitedStepIndex(step - 1);
                setStep(step - 1);
              }}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        )}

        {/* Navigation: hidden for restaurant self-managed steps (they render their own CTAs) */}
        {!RESTAURANT_SELF_MANAGED_STEPS.has(currentStepKey) && (
          <div className="mt-8 flex justify-between">
            {step > 0 && !saving ? (
              <button
                type="button"
                onClick={() => {
                  setRevisitedStepIndex(step - 1);
                  setStep(step - 1);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Back
              </button>
            ) : (
              <div />
            )}
            {currentStepKey === 'preview' ? (
              <button
                type="button"
                onClick={handleGoLive}
                disabled={saving}
                className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Finishing...' : 'Go to Dashboard'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleNext}
                disabled={
                  saving ||
                  (currentStepKey === 'services' &&
                    isUnifiedSchedulingVenue(venue.booking_model) &&
                    !servicesSyncReady)
                }
                className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Continue'}
              </button>
            )}
          </div>
        )}
      </div>

      {showAddCalendarModal && venue.is_admin && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (addCalendarSubmitting) return;
            closeInlineAddCalendar();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="onb-add-calendar-title"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="onb-add-calendar-title" className="mb-1 text-lg font-semibold text-slate-900">
              Add calendar
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Same defaults as Calendar availability: weekly hours are set automatically; you can edit them later.
            </p>
            {addCalendarModalError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
              >
                {addCalendarModalError}
              </div>
            )}
            <label className="mb-1 block text-xs font-medium text-slate-600">Display name *</label>
            <input
              type="text"
              value={newCalendarName}
              onChange={(e) => setNewCalendarName(e.target.value)}
              placeholder="e.g. Studio A, Front desk"
              disabled={addCalendarSubmitting}
              className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitInlineNewCalendar();
                }
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitInlineNewCalendar()}
                disabled={addCalendarSubmitting}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {addCalendarSubmitting ? 'Creating…' : 'Create and use'}
              </button>
              <button
                type="button"
                onClick={() => closeInlineAddCalendar()}
                disabled={addCalendarSubmitting}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
