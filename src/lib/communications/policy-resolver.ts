import { getSupabaseAdminClient } from '@/lib/supabase';
import { isLightPlanTier, isSmsAllowed } from '@/lib/tier-enforcement';
import { venueHasStripePaymentMethodForSms } from '@/lib/stripe/venue-customer-payment';
import type { BookingModel } from '@/types/booking-models';
import {
  type CommunicationChannel,
  type CommunicationLane,
  type CommunicationMessageKey,
  getVenueCommunicationPolicies,
  inferCommunicationLaneFromBookingModel,
} from './policies';

export type CommunicationLogMessageType =
  | 'booking_confirmation_email'
  | 'booking_confirmation_sms'
  | 'deposit_request_email'
  | 'deposit_request_sms'
  | 'deposit_confirmation_email'
  | 'confirm_or_cancel_prompt_email'
  | 'confirm_or_cancel_prompt_sms'
  | 'deposit_payment_reminder_email'
  | 'deposit_payment_reminder_sms'
  | 'pre_visit_reminder_email'
  | 'pre_visit_reminder_sms'
  | 'booking_modification_email'
  | 'booking_modification_sms'
  | 'cancellation_confirmation_email'
  | 'cancellation_confirmation_sms'
  | 'auto_cancel_notification_email'
  | 'auto_cancel_notification_sms'
  | 'custom_message_email'
  | 'custom_message_sms'
  | 'no_show_notification_email'
  | 'post_visit_thankyou_email'
  | 'appointment_waitlist_offer_email'
  | 'appointment_waitlist_offer_sms'
  | 'class_credits_purchased_email'
  | 'class_credits_expiring_email'
  | 'class_credits_restored_email'
  | 'class_course_enrolled_email'
  | 'class_course_refunded_email'
  | 'class_membership_started_email'
  | 'class_membership_renewed_email'
  | 'class_membership_cancelling_email'
  | 'class_membership_ended_email';

const LOG_MESSAGE_TYPE_MAP: Record<
  CommunicationMessageKey,
  Partial<Record<CommunicationChannel, CommunicationLogMessageType>>
> = {
  booking_confirmation: {
    email: 'booking_confirmation_email',
    sms: 'booking_confirmation_sms',
  },
  deposit_payment_request: {
    email: 'deposit_request_email',
    sms: 'deposit_request_sms',
  },
  deposit_confirmation: {
    email: 'deposit_confirmation_email',
  },
  confirm_or_cancel_prompt: {
    email: 'confirm_or_cancel_prompt_email',
    sms: 'confirm_or_cancel_prompt_sms',
  },
  deposit_payment_reminder: {
    email: 'deposit_payment_reminder_email',
    sms: 'deposit_payment_reminder_sms',
  },
  pre_visit_reminder: {
    email: 'pre_visit_reminder_email',
    sms: 'pre_visit_reminder_sms',
  },
  booking_modification: {
    email: 'booking_modification_email',
    sms: 'booking_modification_sms',
  },
  cancellation_confirmation: {
    email: 'cancellation_confirmation_email',
    sms: 'cancellation_confirmation_sms',
  },
  auto_cancel_notification: {
    email: 'auto_cancel_notification_email',
    sms: 'auto_cancel_notification_sms',
  },
  custom_message: {
    email: 'custom_message_email',
    sms: 'custom_message_sms',
  },
  no_show_notification: {
    email: 'no_show_notification_email',
  },
  post_visit_thankyou: {
    email: 'post_visit_thankyou_email',
  },
  appointment_waitlist_offer: {
    email: 'appointment_waitlist_offer_email',
    sms: 'appointment_waitlist_offer_sms',
  },
  class_credits_purchased: { email: 'class_credits_purchased_email' },
  class_credits_expiring: { email: 'class_credits_expiring_email' },
  class_credits_restored: { email: 'class_credits_restored_email' },
  class_course_enrolled: { email: 'class_course_enrolled_email' },
  class_course_refunded: { email: 'class_course_refunded_email' },
  class_membership_started: { email: 'class_membership_started_email' },
  class_membership_renewed: { email: 'class_membership_renewed_email' },
  class_membership_cancelling: { email: 'class_membership_cancelling_email' },
  class_membership_ended: { email: 'class_membership_ended_email' },
};

export interface ResolveCommPolicyInput {
  venueId: string;
  messageKey: CommunicationMessageKey;
  bookingModel?: BookingModel | string | null;
  lane?: CommunicationLane;
  requestedChannels?: CommunicationChannel[];
}

export interface ResolvedCommPolicy {
  lane: CommunicationLane;
  messageKey: CommunicationMessageKey;
  enabled: boolean;
  channels: CommunicationChannel[];
  emailCustomMessage: string | null;
  smsCustomMessage: string | null;
  hoursBefore: number | null;
  hoursAfter: number | null;
  smsAllowed: boolean;
  logMessageTypeByChannel: Partial<
    Record<CommunicationChannel, CommunicationLogMessageType>
  >;
}

export async function resolveCommPolicy(
  input: ResolveCommPolicyInput,
): Promise<ResolvedCommPolicy> {
  const policies = await getVenueCommunicationPolicies(input.venueId);
  const lane =
    input.lane ?? inferCommunicationLaneFromBookingModel(input.bookingModel);
  const policy = policies[lane][input.messageKey];
  const smsAllowed = await isSmsAllowed(input.venueId);

  const admin = getSupabaseAdminClient();
  const { data: tierRow } = await admin
    .from('venues')
    .select('pricing_tier')
    .eq('id', input.venueId)
    .maybeSingle();
  const pricingTier = (tierRow as { pricing_tier?: string | null } | null)?.pricing_tier;

  let channels = [...policy.channels];
  if (input.requestedChannels?.length) {
    const requested = new Set(input.requestedChannels);
    channels = channels.filter((channel) => requested.has(channel));
  }
  if (!smsAllowed) {
    channels = channels.filter((channel) => channel !== 'sms');
  }

  if (isLightPlanTier(pricingTier) && channels.includes('sms')) {
    const canBillSms = await venueHasStripePaymentMethodForSms(input.venueId);
    if (!canBillSms) {
      console.warn(
        JSON.stringify({
          event: 'light_plan_sms_skipped_no_payment_method',
          venue_id: input.venueId,
          message_key: input.messageKey,
        }),
      );
      channels = channels.filter((channel) => channel !== 'sms');
    }
  }

  return {
    lane,
    messageKey: input.messageKey,
    enabled: policy.enabled,
    channels,
    emailCustomMessage: policy.emailCustomMessage,
    smsCustomMessage: policy.smsCustomMessage,
    hoursBefore: policy.hoursBefore,
    hoursAfter: policy.hoursAfter,
    smsAllowed,
    logMessageTypeByChannel: LOG_MESSAGE_TYPE_MAP[input.messageKey],
  };
}
