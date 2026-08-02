-- Per-staff preference: which optional dashboard setup checklist rows have been snoozed ("Not now").
-- Stored server-side rather than in localStorage because /auth/signed-out responds with
-- Clear-Site-Data: "cache", "storage", which would wipe the preference on every sign-out.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS dashboard_setup_checklist_snoozed_keys text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.staff.dashboard_setup_checklist_snoozed_keys IS
  'Optional setup checklist step keys this staff member dismissed with "Not now" (e.g. stripe_connected). Snoozed rows are hidden and no longer block the checklist from auto-hiding.';
