-- Confirm or cancel prompt: default to email only for new venues (table + appointments lanes).
--
-- It defaulted to email AND SMS. Product decision 2026-09-05: a new venue starts with the
-- prompt by email only and switches SMS on itself. SMS stays allowed for this message
-- (ALLOWED_CHANNELS_BY_MESSAGE in policies.ts is unchanged), so the card still offers it.
--
-- New venues only. The column is NOT NULL with this default, so every existing venue already holds
-- a concrete blob and keeps whatever it has. Code fallback is buildDefaultLanePolicies() in
-- policies.ts; policies.defaults.test.ts asserts the column default and the code default agree.
ALTER TABLE venues
  ALTER COLUMN communication_policies SET DEFAULT '{
    "table": {
      "booking_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_payment_request": {"enabled": true, "channels": ["email", "sms"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "deposit_confirmation": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": null, "hoursAfter": null},
      "confirm_or_cancel_prompt": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 24, "hoursAfter": null},
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
      "confirm_or_cancel_prompt": {"enabled": true, "channels": ["email"], "emailCustomMessage": null, "smsCustomMessage": null, "hoursBefore": 24, "hoursAfter": null},
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
