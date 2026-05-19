-- Appointment waitlist: optional end time for guest time-range preference (all day = both null).

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS desired_time_end time;

COMMENT ON COLUMN public.waitlist_entries.desired_time IS
  'Appointment waitlist: range start, exact time (legacy), or null for all-day preference.';
COMMENT ON COLUMN public.waitlist_entries.desired_time_end IS
  'Appointment waitlist: range end (exclusive upper bound in minutes logic). Null for all-day or legacy single-time entries.';
