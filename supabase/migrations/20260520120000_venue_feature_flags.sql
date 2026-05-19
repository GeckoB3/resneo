-- Per-venue feature toggles for phased appointment product rollout (P0.3).
-- Global overrides: FEATURE_FLAG_WAITLIST_V2, FEATURE_FLAG_GUEST_SELF_RESCHEDULE,
-- FEATURE_FLAG_ANY_AVAILABLE_PRACTITIONER (see Docs/FEATURE_FLAGS.md).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN venues.feature_flags IS
  'Per-venue beta flags: waitlist_v2, guest_self_reschedule, any_available_practitioner (boolean keys).';
