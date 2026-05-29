-- New venues default to 7-day inactivity auto-logout (10080 minutes).
ALTER TABLE venues
  ALTER COLUMN session_timeout_minutes SET DEFAULT 10080;

COMMENT ON COLUMN venues.session_timeout_minutes IS
  'Auto-logout after N minutes of inactivity. Default 10080 (7 days).';
