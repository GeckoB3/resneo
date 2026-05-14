-- Per-staff preference: dashboard setup checklist dismissed (persists across logins / devices for that account).

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS dashboard_setup_checklist_dismissed_at timestamptz;

COMMENT ON COLUMN public.staff.dashboard_setup_checklist_dismissed_at IS
  'When set, this staff member no longer sees the dashboard setup checklist (admin dismiss or auto-hide when setup complete).';
