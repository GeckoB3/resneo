import { getSupabaseAdminClient } from '@/lib/supabase';
import type { BookingModel } from '@/types/booking-models';
import { isCdeBookingModel } from '@/lib/booking/cde-booking';
import { isUnifiedSchedulingVenue } from '@/lib/booking/unified-scheduling';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';

export type CommunicationLane = 'table' | 'appointments_other';
export type CommunicationChannel = 'email' | 'sms';

export type CommunicationMessageKey =
  | 'booking_confirmation'
  | 'deposit_payment_request'
  | 'deposit_confirmation'
  | 'confirm_or_cancel_prompt'
  | 'deposit_payment_reminder'
  // Card-hold deposits (§10.3): own policy entries; deposit-request
  // customisations do not govern card-hold comms.
  | 'card_hold_request'
  | 'card_hold_payment_reminder'
  | 'pre_visit_reminder'
  | 'booking_modification'
  | 'cancellation_confirmation'
  | 'auto_cancel_notification'
  | 'custom_message'
  | 'no_show_notification'
  | 'post_visit_thankyou'
  | 'appointment_waitlist_offer'
  // Phase 2 §5.5 — class commerce.
  | 'class_credits_purchased'
  | 'class_credits_expiring'
  | 'class_credits_restored'
  | 'class_course_enrolled'
  | 'class_course_refunded'
  | 'class_membership_started'
  | 'class_membership_renewed'
  | 'class_membership_cancelling'
  | 'class_membership_ended'
  // Compliance records (§12) — appointments_other lane only.
  | 'compliance_form_request'
  | 'compliance_form_reminder'
  | 'compliance_record_expiring';

/** Read-only set of the compliance message keys for dispatch helpers. */
export const COMPLIANCE_MESSAGE_KEYS: readonly CommunicationMessageKey[] = [
  'compliance_form_request',
  'compliance_form_reminder',
  'compliance_record_expiring',
] as const;

/** Read-only set of the class-commerce keys for use in dispatch helpers. */
export const CLASS_COMMERCE_MESSAGE_KEYS: readonly CommunicationMessageKey[] = [
  'class_credits_purchased',
  'class_credits_expiring',
  'class_credits_restored',
  'class_course_enrolled',
  'class_course_refunded',
  'class_membership_started',
  'class_membership_renewed',
  'class_membership_cancelling',
  'class_membership_ended',
] as const;

export interface LaneMessagePolicy {
  enabled: boolean;
  channels: CommunicationChannel[];
  emailCustomMessage: string | null;
  smsCustomMessage: string | null;
  hoursBefore: number | null;
  hoursAfter: number | null;
}

export type LaneCommunicationPolicies = Record<CommunicationMessageKey, LaneMessagePolicy>;

export interface VenueCommunicationPolicies {
  table: LaneCommunicationPolicies;
  appointments_other: LaneCommunicationPolicies;
}

const SETTINGS_CACHE = new Map<
  string,
  { data: VenueCommunicationPolicies; ts: number }
>();
const CACHE_TTL_MS = 60_000;

const EMAIL_AND_SMS: CommunicationChannel[] = ['email', 'sms'];
const EMAIL_ONLY: CommunicationChannel[] = ['email'];

function buildDefaultLanePolicies(): LaneCommunicationPolicies {
  return {
    booking_confirmation: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    deposit_payment_request: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    deposit_confirmation: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    confirm_or_cancel_prompt: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: 24,
      hoursAfter: null,
    },
    deposit_payment_reminder: {
      enabled: true,
      channels: ['sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: 2,
      hoursAfter: null,
    },
    // Card-hold deposits (§10.3): both card-request keys default to email + SMS.
    card_hold_request: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    card_hold_payment_reminder: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: 2,
      hoursAfter: null,
    },
    pre_visit_reminder: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: 2,
      hoursAfter: null,
    },
    booking_modification: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    cancellation_confirmation: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    auto_cancel_notification: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    custom_message: {
      enabled: true,
      channels: ['email', 'sms'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    no_show_notification: {
      enabled: false,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    post_visit_thankyou: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: 4,
    },
    appointment_waitlist_offer: {
      enabled: false,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    // Phase 2 §5.5 — class commerce keys. Email-on, SMS-off by default; venues
    // can toggle SMS for the keys that have it listed under ALLOWED_CHANNELS.
    class_credits_purchased: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_credits_expiring: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_credits_restored: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_course_enrolled: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_course_refunded: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_membership_started: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_membership_renewed: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_membership_cancelling: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    class_membership_ended: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    // Compliance — email-on by default; SMS allowed and venue-toggleable.
    compliance_form_request: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    compliance_form_reminder: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
    compliance_record_expiring: {
      enabled: true,
      channels: ['email'],
      emailCustomMessage: null,
      smsCustomMessage: null,
      hoursBefore: null,
      hoursAfter: null,
    },
  };
}

export function defaultCommunicationPolicies(): VenueCommunicationPolicies {
  const table = buildDefaultLanePolicies();
  const appointments_other = buildDefaultLanePolicies();
  appointments_other.appointment_waitlist_offer = defaultWaitlistOfferMessagePolicy();
  return { table, appointments_other };
}

/**
 * C1: distinct reminder offsets for class/event/resource (C/D/E) venues. CDE attendees expect a
 * day-ahead reminder rather than the appointment 2-hour lane, so these offsets default further out.
 * They remain independently overridable per-message via the normal communication-policy editor —
 * this only seeds different starting `hoursBefore` values for CDE-primary venues.
 */
function buildDefaultCdeLanePolicies(): LaneCommunicationPolicies {
  const lane = buildDefaultLanePolicies();
  // Day-ahead "confirm or cancel" instead of 24h, day-ahead pre-visit instead of 2h,
  // and a day-ahead (rather than 2h) deposit-payment nudge.
  lane.confirm_or_cancel_prompt = { ...lane.confirm_or_cancel_prompt, hoursBefore: 48 };
  lane.pre_visit_reminder = { ...lane.pre_visit_reminder, hoursBefore: 24 };
  lane.deposit_payment_reminder = { ...lane.deposit_payment_reminder, hoursBefore: 24 };
  return lane;
}

/** Default CDE reminder offsets used when seeding a fresh CDE-primary venue's `appointments_other` lane. */
export const CDE_DEFAULT_REMINDER_HOURS_BEFORE: Readonly<
  Partial<Record<CommunicationMessageKey, number>>
> = {
  confirm_or_cancel_prompt: 48,
  pre_visit_reminder: 24,
  deposit_payment_reminder: 24,
} as const;

/**
 * Default communication policies for a venue, model-aware (C1). C/D/E-primary venues get the
 * CDE reminder offsets in the `appointments_other` lane; everything else uses the shared defaults.
 */
export function defaultCommunicationPoliciesForVenue(opts: {
  bookingModel?: BookingModel | string | null;
}): VenueCommunicationPolicies {
  const base = defaultCommunicationPolicies();
  if (!isCdeBookingModel(opts.bookingModel)) return base;
  const appointments_other = buildDefaultCdeLanePolicies();
  appointments_other.appointment_waitlist_offer = defaultWaitlistOfferMessagePolicy();
  return { table: base.table, appointments_other };
}

/** Email-only waitlist invite defaults applied when appointment waitlist is first enabled. */
export function defaultWaitlistOfferMessagePolicy(): LaneMessagePolicy {
  return {
    enabled: true,
    channels: EMAIL_ONLY,
    emailCustomMessage: null,
    smsCustomMessage: null,
    hoursBefore: null,
    hoursAfter: null,
  };
}

export function communicationPoliciesWithWaitlistOfferEmailDefaults(
  current: VenueCommunicationPolicies,
): VenueCommunicationPolicies {
  return mergeCommunicationPoliciesPatch(current, {
    appointments_other: {
      appointment_waitlist_offer: defaultWaitlistOfferMessagePolicy(),
    },
  });
}

/**
 * When waitlist is active but invite comms were never migrated, apply email-only defaults once.
 */
export async function ensureWaitlistOfferCommunicationPolicyForVenue(venueId: string): Promise<void> {
  const current = await getVenueCommunicationPolicies(venueId);
  if (current.appointments_other.appointment_waitlist_offer.enabled) return;

  const commNext = communicationPoliciesWithWaitlistOfferEmailDefaults(current);
  const admin = getSupabaseAdminClient();
  const { error } = await admin
    .from('venues')
    .update({
      communication_policies: commNext as unknown as Record<string, never>,
    })
    .eq('id', venueId);

  if (error) {
    console.error('[ensureWaitlistOfferCommunicationPolicyForVenue] update failed:', error.message, {
      venueId,
    });
    return;
  }

  clearCommunicationPoliciesCache(venueId);
}

/** Appointments Light: SMS toggles default off — email-only channels for the unified scheduling lane. */
export function communicationPoliciesEmailOnlyAppointmentsLane(): VenueCommunicationPolicies {
  const base = defaultCommunicationPolicies();
  const lane = { ...base.appointments_other };
  for (const key of Object.keys(lane) as CommunicationMessageKey[]) {
    const pol = lane[key];
    const nextChannels = pol.channels.filter((c) => c !== 'sms');
    lane[key] = {
      ...pol,
      channels: nextChannels.length > 0 ? nextChannels : ['email'],
    };
  }
  return { table: base.table, appointments_other: lane };
}

const ALLOWED_CHANNELS_BY_MESSAGE: Record<
  CommunicationMessageKey,
  CommunicationChannel[]
> = {
  booking_confirmation: EMAIL_AND_SMS,
  deposit_payment_request: EMAIL_AND_SMS,
  deposit_confirmation: EMAIL_ONLY,
  confirm_or_cancel_prompt: EMAIL_AND_SMS,
  deposit_payment_reminder: EMAIL_AND_SMS,
  card_hold_request: EMAIL_AND_SMS,
  card_hold_payment_reminder: EMAIL_AND_SMS,
  pre_visit_reminder: EMAIL_AND_SMS,
  booking_modification: EMAIL_AND_SMS,
  cancellation_confirmation: EMAIL_AND_SMS,
  auto_cancel_notification: EMAIL_AND_SMS,
  custom_message: EMAIL_AND_SMS,
  no_show_notification: EMAIL_ONLY,
  post_visit_thankyou: EMAIL_ONLY,
  appointment_waitlist_offer: EMAIL_AND_SMS,
  // Class commerce — email-only for v1; SMS can land per-key later.
  class_credits_purchased: EMAIL_ONLY,
  class_credits_expiring: EMAIL_ONLY,
  class_credits_restored: EMAIL_ONLY,
  class_course_enrolled: EMAIL_ONLY,
  class_course_refunded: EMAIL_ONLY,
  class_membership_started: EMAIL_ONLY,
  class_membership_renewed: EMAIL_ONLY,
  class_membership_cancelling: EMAIL_ONLY,
  class_membership_ended: EMAIL_ONLY,
  compliance_form_request: EMAIL_AND_SMS,
  compliance_form_reminder: EMAIL_AND_SMS,
  compliance_record_expiring: EMAIL_AND_SMS,
};

function sanitizeChannels(
  messageKey: CommunicationMessageKey,
  raw: unknown,
  fallback: CommunicationChannel[],
): CommunicationChannel[] {
  if (!Array.isArray(raw)) return [...fallback];
  const allowed = new Set(ALLOWED_CHANNELS_BY_MESSAGE[messageKey]);
  const next = raw.filter(
    (value): value is CommunicationChannel =>
      (value === 'email' || value === 'sms') && allowed.has(value),
  );
  return next.length > 0 ? next : [...fallback];
}

function sanitizeNumber(
  raw: unknown,
  fallback: number | null,
  opts?: { min?: number; max?: number },
): number | null {
  if (raw == null) return fallback;
  let n: number;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return fallback;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return fallback;
    n = parsed;
  } else {
    return fallback;
  }
  let value = Math.round(n);
  if (opts?.min != null) value = Math.max(opts.min, value);
  if (opts?.max != null) value = Math.min(opts.max, value);
  return value;
}

function sanitizeMessagePolicy(
  messageKey: CommunicationMessageKey,
  raw: unknown,
  fallback: LaneMessagePolicy,
): LaneMessagePolicy {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const row = raw as Record<string, unknown>;
  return {
    enabled: row.enabled !== false,
    channels: sanitizeChannels(messageKey, row.channels, fallback.channels),
    emailCustomMessage:
      typeof row.emailCustomMessage === 'string' ? row.emailCustomMessage : null,
    smsCustomMessage:
      typeof row.smsCustomMessage === 'string' ? row.smsCustomMessage : null,
    hoursBefore: sanitizeNumber(row.hoursBefore, fallback.hoursBefore, {
      min: 1,
      max: 168,
    }),
    hoursAfter: sanitizeNumber(row.hoursAfter, fallback.hoursAfter, {
      min: 1,
      max: 168,
    }),
  };
}

function sanitizeLanePolicies(
  raw: unknown,
  fallback: LaneCommunicationPolicies,
): LaneCommunicationPolicies {
  const row = raw && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {};
  return {
    booking_confirmation: sanitizeMessagePolicy(
      'booking_confirmation',
      row.booking_confirmation,
      fallback.booking_confirmation,
    ),
    deposit_payment_request: sanitizeMessagePolicy(
      'deposit_payment_request',
      row.deposit_payment_request,
      fallback.deposit_payment_request,
    ),
    deposit_confirmation: sanitizeMessagePolicy(
      'deposit_confirmation',
      row.deposit_confirmation,
      fallback.deposit_confirmation,
    ),
    confirm_or_cancel_prompt: sanitizeMessagePolicy(
      'confirm_or_cancel_prompt',
      row.confirm_or_cancel_prompt,
      fallback.confirm_or_cancel_prompt,
    ),
    deposit_payment_reminder: sanitizeMessagePolicy(
      'deposit_payment_reminder',
      row.deposit_payment_reminder,
      fallback.deposit_payment_reminder,
    ),
    card_hold_request: sanitizeMessagePolicy(
      'card_hold_request',
      row.card_hold_request,
      fallback.card_hold_request,
    ),
    card_hold_payment_reminder: sanitizeMessagePolicy(
      'card_hold_payment_reminder',
      row.card_hold_payment_reminder,
      fallback.card_hold_payment_reminder,
    ),
    pre_visit_reminder: sanitizeMessagePolicy(
      'pre_visit_reminder',
      row.pre_visit_reminder,
      fallback.pre_visit_reminder,
    ),
    booking_modification: sanitizeMessagePolicy(
      'booking_modification',
      row.booking_modification,
      fallback.booking_modification,
    ),
    cancellation_confirmation: sanitizeMessagePolicy(
      'cancellation_confirmation',
      row.cancellation_confirmation,
      fallback.cancellation_confirmation,
    ),
    auto_cancel_notification: sanitizeMessagePolicy(
      'auto_cancel_notification',
      row.auto_cancel_notification,
      fallback.auto_cancel_notification,
    ),
    custom_message: sanitizeMessagePolicy(
      'custom_message',
      row.custom_message,
      fallback.custom_message,
    ),
    no_show_notification: sanitizeMessagePolicy(
      'no_show_notification',
      row.no_show_notification,
      fallback.no_show_notification,
    ),
    post_visit_thankyou: sanitizeMessagePolicy(
      'post_visit_thankyou',
      row.post_visit_thankyou,
      fallback.post_visit_thankyou,
    ),
    appointment_waitlist_offer: sanitizeMessagePolicy(
      'appointment_waitlist_offer',
      row.appointment_waitlist_offer,
      fallback.appointment_waitlist_offer,
    ),
    class_credits_purchased: sanitizeMessagePolicy(
      'class_credits_purchased',
      row.class_credits_purchased,
      fallback.class_credits_purchased,
    ),
    class_credits_expiring: sanitizeMessagePolicy(
      'class_credits_expiring',
      row.class_credits_expiring,
      fallback.class_credits_expiring,
    ),
    class_credits_restored: sanitizeMessagePolicy(
      'class_credits_restored',
      row.class_credits_restored,
      fallback.class_credits_restored,
    ),
    class_course_enrolled: sanitizeMessagePolicy(
      'class_course_enrolled',
      row.class_course_enrolled,
      fallback.class_course_enrolled,
    ),
    class_course_refunded: sanitizeMessagePolicy(
      'class_course_refunded',
      row.class_course_refunded,
      fallback.class_course_refunded,
    ),
    class_membership_started: sanitizeMessagePolicy(
      'class_membership_started',
      row.class_membership_started,
      fallback.class_membership_started,
    ),
    class_membership_renewed: sanitizeMessagePolicy(
      'class_membership_renewed',
      row.class_membership_renewed,
      fallback.class_membership_renewed,
    ),
    class_membership_cancelling: sanitizeMessagePolicy(
      'class_membership_cancelling',
      row.class_membership_cancelling,
      fallback.class_membership_cancelling,
    ),
    class_membership_ended: sanitizeMessagePolicy(
      'class_membership_ended',
      row.class_membership_ended,
      fallback.class_membership_ended,
    ),
    compliance_form_request: sanitizeMessagePolicy(
      'compliance_form_request',
      row.compliance_form_request,
      fallback.compliance_form_request,
    ),
    compliance_form_reminder: sanitizeMessagePolicy(
      'compliance_form_reminder',
      row.compliance_form_reminder,
      fallback.compliance_form_reminder,
    ),
    compliance_record_expiring: sanitizeMessagePolicy(
      'compliance_record_expiring',
      row.compliance_record_expiring,
      fallback.compliance_record_expiring,
    ),
  };
}

export function parseCommunicationPolicies(
  raw: unknown,
): VenueCommunicationPolicies {
  const fallback = defaultCommunicationPolicies();
  if (!raw || typeof raw !== 'object') return fallback;
  const row = raw as Record<string, unknown>;
  return {
    table: sanitizeLanePolicies(row.table, fallback.table),
    appointments_other: sanitizeLanePolicies(
      row.appointments_other,
      fallback.appointments_other,
    ),
  };
}

export function clearCommunicationPoliciesCache(venueId?: string): void {
  if (venueId) {
    SETTINGS_CACHE.delete(venueId);
    return;
  }
  SETTINGS_CACHE.clear();
}

export async function getVenueCommunicationPolicies(
  venueId: string,
): Promise<VenueCommunicationPolicies> {
  const cached = SETTINGS_CACHE.get(venueId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const admin = getSupabaseAdminClient();
  const { data } = await admin
    .from('venues')
    .select('communication_policies')
    .eq('id', venueId)
    .maybeSingle();

  const parsed = parseCommunicationPolicies(
    (data as { communication_policies?: unknown } | null)?.communication_policies,
  );
  SETTINGS_CACHE.set(venueId, { data: parsed, ts: Date.now() });
  return parsed;
}

export function mergeCommunicationPoliciesPatch(
  current: VenueCommunicationPolicies,
  patch: Partial<Record<CommunicationLane, Partial<Record<CommunicationMessageKey, Partial<LaneMessagePolicy>>>>>,
): VenueCommunicationPolicies {
  const next: VenueCommunicationPolicies = {
    table: { ...current.table },
    appointments_other: { ...current.appointments_other },
  };

  for (const lane of ['table', 'appointments_other'] as const) {
    const lanePatch = patch[lane];
    if (!lanePatch) continue;
    for (const messageKey of Object.keys(lanePatch) as CommunicationMessageKey[]) {
      const existing = next[lane][messageKey];
      const messagePatch = lanePatch[messageKey];
      if (!messagePatch) continue;
      next[lane][messageKey] = sanitizeMessagePolicy(messageKey, {
        ...existing,
        ...messagePatch,
      }, existing);
    }
  }

  return parseCommunicationPolicies(next);
}

export function inferCommunicationLaneFromBookingModel(
  bookingModel: BookingModel | string | null | undefined,
): CommunicationLane {
  if (bookingModel === 'table_reservation') return 'table';
  return 'appointments_other';
}

export function shouldShowAppointmentsOtherLane(opts: {
  pricingTier?: string | null;
  bookingModel?: BookingModel | string | null;
  enabledModels?: BookingModel[];
}): boolean {
  const primary = (opts.bookingModel as BookingModel | undefined) ?? 'table_reservation';
  if (isAppointmentPlanTier(opts.pricingTier)) return true;
  if (isUnifiedSchedulingVenue(primary) || isCdeBookingModel(primary)) return true;
  return primary === 'table_reservation' && (opts.enabledModels?.length ?? 0) > 0;
}
