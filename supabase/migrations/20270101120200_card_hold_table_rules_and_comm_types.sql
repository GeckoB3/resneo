-- Card holds (Migration B2): table-rule deposit_type + communication log types.
--
-- booking_restrictions.deposit_type: table rules have no payment-requirement
-- enum, so the per-service deposit rule gains a type selector instead:
--   • `charge`    — take the deposit payment at booking time (today's behaviour, default).
--   • `card_hold` — store the card at booking time; staff may charge a no-show fee later.

ALTER TABLE public.booking_restrictions
  ADD COLUMN IF NOT EXISTS deposit_type text NOT NULL DEFAULT 'charge'
  CHECK (deposit_type IN ('charge', 'card_hold'));

-- Extend communication_logs.message_type CHECK as a strict superset (same pattern as
-- 20261214120000): every previously-allowed value plus the five card-hold types.

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_message_type_check;

ALTER TABLE communication_logs
  ADD CONSTRAINT communication_logs_message_type_check CHECK (message_type IN (
    'booking_confirmation_email',
    'booking_confirmation_sms',
    'deposit_request_sms',
    'deposit_request_email',
    'deposit_confirmation_email',
    'reminder_56h_email',
    'day_of_reminder_sms',
    'day_of_reminder_email',
    'post_visit_email',
    'reminder_1_email',
    'reminder_1_sms',
    'reminder_2_email',
    'reminder_2_sms',
    'unified_post_visit_email',
    'booking_modification_email',
    'booking_modification_sms',
    'cancellation_email',
    'cancellation_sms',
    'confirm_or_cancel_prompt_email',
    'confirm_or_cancel_prompt_sms',
    'deposit_payment_reminder_email',
    'deposit_payment_reminder_sms',
    'pre_visit_reminder_email',
    'pre_visit_reminder_sms',
    'cancellation_confirmation_email',
    'cancellation_confirmation_sms',
    'auto_cancel_notification_email',
    'auto_cancel_notification_sms',
    'custom_message_email',
    'custom_message_sms',
    'no_show_notification_email',
    'post_visit_thankyou_email',
    'appointment_waitlist_offer_email',
    'appointment_waitlist_offer_sms',
    'class_credits_purchased_email',
    'class_credits_expiring_email',
    'class_credits_restored_email',
    'class_course_enrolled_email',
    'class_course_refunded_email',
    'class_membership_started_email',
    'class_membership_renewed_email',
    'class_membership_cancelling_email',
    'class_membership_ended_email',
    'compliance_form_request_email',
    'compliance_form_request_sms',
    'compliance_form_reminder_email',
    'compliance_form_reminder_sms',
    'compliance_record_expiring_email',
    'compliance_record_expiring_sms',
    'owner_booking_notification_email',
    -- Card-hold deposit lifecycle messages
    'card_hold_request_email',
    'card_hold_request_sms',
    'card_hold_payment_reminder_email',
    'card_hold_payment_reminder_sms',
    'card_hold_charged_email'
  )) NOT VALID;

ALTER TABLE communication_logs VALIDATE CONSTRAINT communication_logs_message_type_check;
