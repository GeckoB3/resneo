-- Lean appointments onboarding drops the per-model catalogue steps (services, classes,
-- events, resources) and the Stripe step. All five were already skippable, and the
-- dashboard "What's next" checklist prompts for each of them after onboarding.
-- `appointments_onboarding_lean_flow` gates the one-time `onboarding_step` index remap
-- for venues that were mid-flow when the lean layout shipped.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS appointments_onboarding_lean_flow boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN venues.appointments_onboarding_lean_flow IS
  'True when venues.onboarding_step indices follow the lean appointments wizard (no catalogue or Stripe steps). False means the stored index still refers to the previous layout and is remapped once on next load.';

-- Venues that already finished onboarding never re-enter the wizard, so their stored
-- index is irrelevant and there is nothing to remap.
UPDATE venues
SET appointments_onboarding_lean_flow = true
WHERE onboarding_completed = true;
