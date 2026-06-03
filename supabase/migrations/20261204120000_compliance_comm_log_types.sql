-- Reserve NI: extend communication_logs.message_type CHECK for compliance messages (spec §12).
--
-- The previous constraint (20260601000000) drifted from the code's
-- CommunicationLogMessageType union — it omitted the appointment-waitlist and
-- class-commerce log types that the app already emits. This migration re-adds the
-- constraint as a strict SUPERSET: every previously-allowed value, plus the
-- already-in-use waitlist/class types, plus the three new compliance types.
-- Purely additive — no previously-valid value is removed.

ALTER TABLE communication_logs
  DROP CONSTRAINT IF EXISTS communication_logs_message_type_check;

ALTER TABLE communication_logs
  ADD CONSTRAINT communication_logs_message_type_check CHECK (message_type IN (
    -- Existing (20260601000000)
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
    -- In-use code types missing from the prior constraint
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
    -- New compliance message log types (§12)
    'compliance_form_request_email',
    'compliance_form_request_sms',
    'compliance_form_reminder_email',
    'compliance_form_reminder_sms',
    'compliance_record_expiring_email',
    'compliance_record_expiring_sms'
  )) NOT VALID;

-- Validate separately so the migration does not fail on any pre-existing rows
-- that predate the constraint (defensive; new schemas validate cleanly).
ALTER TABLE communication_logs VALIDATE CONSTRAINT communication_logs_message_type_check;
