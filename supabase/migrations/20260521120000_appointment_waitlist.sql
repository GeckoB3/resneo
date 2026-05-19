-- Phase 1a.3: appointment schedule waitlist (distinct from dining table waitlist).

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS waitlist_kind text NOT NULL DEFAULT 'table';

ALTER TABLE public.waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_waitlist_kind_check;

ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_waitlist_kind_check
  CHECK (waitlist_kind IN ('table', 'appointment'));

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS appointment_service_id uuid REFERENCES public.appointment_services (id) ON DELETE SET NULL;

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS service_item_id uuid REFERENCES public.service_items (id) ON DELETE SET NULL;

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS practitioner_id uuid;

CREATE INDEX IF NOT EXISTS idx_waitlist_appointment_venue_date
  ON public.waitlist_entries (venue_id, desired_date)
  WHERE waitlist_kind = 'appointment';

COMMENT ON COLUMN public.waitlist_entries.waitlist_kind IS 'table = dining covers waitlist; appointment = schedule slot waitlist (Phase 1a.3).';
