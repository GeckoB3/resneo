-- Deposit payment reminder: default to email AND SMS for new venues (table + appointments lanes).
--
-- It defaulted to SMS only. SMS is filtered out of the channel list for a venue without the
-- entitlement (see isSmsAllowed in policy-resolver), which left the message with no channels at
-- all: those venues sent no deposit reminder before the booking was auto-released. The email
-- template has always existed (renderer.ts, "Reminder: Complete your deposit"); nothing selected it.
--
-- New venues only. The column is NOT NULL with this default, so every existing venue already holds
-- a concrete blob and keeps whatever it has. Code fallback is policies.ts.
ALTER TABLE venues
  ALTER COLUMN communication_policies SET DEFAULT '{
    "table": {
      "booking_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_payment_request": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "confirm_or_cancel_prompt": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 24, "hoursAfter": null},
      "deposit_payment_reminder": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 2, "hoursAfter": null},
      "pre_visit_reminder": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 2, "hoursAfter": null},
      "booking_modification": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "cancellation_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "auto_cancel_notification": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "custom_message": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "no_show_notification": {"enabled": false, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "post_visit_thankyou": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": 4}
    },
    "appointments_other": {
      "booking_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_payment_request": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "confirm_or_cancel_prompt": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 24, "hoursAfter": null},
      "deposit_payment_reminder": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 2, "hoursAfter": null},
      "pre_visit_reminder": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 2, "hoursAfter": null},
      "booking_modification": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "cancellation_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "auto_cancel_notification": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "custom_message": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "no_show_notification": {"enabled": false, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "post_visit_thankyou": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": 4}
    }
  }'::jsonb;
