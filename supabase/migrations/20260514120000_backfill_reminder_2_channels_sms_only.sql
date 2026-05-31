-- Backfill legacy day-of (reminder_2) channel rows that stored SMS only.
-- Matches app defaults in src/lib/notifications/notification-settings.ts and parity with
-- restaurant "Appointments & other bookings" when both channels are available in UI.
--
-- Manual verification for a test account (e.g. test1@resneo.com):
--   SELECT v.id, v.pricing_tier, v.notification_settings->'reminder_2_channels' AS r2
--   FROM venues v
--   JOIN staff s ON s.venue_id = v.id
--   WHERE lower(s.email) = lower('test1@resneo.com');

UPDATE venues
SET notification_settings = jsonb_set(
  notification_settings,
  '{reminder_2_channels}',
  '["email", "sms"]'::jsonb,
  true
)
WHERE notification_settings->'reminder_2_channels' = '["sms"]'::jsonb;
