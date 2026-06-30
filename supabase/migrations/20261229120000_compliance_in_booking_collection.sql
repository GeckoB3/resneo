-- Reserve NI: Compliance in-booking form collection (improvement plan §9.3, Phase 2).
--
-- Adds:
--   service_compliance_requirements.online_collection  — where a client-online form is
--       offered during online booking: 'inline' (in the flow), 'confirmation_link'
--       (link emailed in the confirmation), or 'none' (not surfaced online).
--   compliance_types.online_unmet_message              — venue-set message shown when a
--       booking is blocked by an unmet requirement the guest cannot self-complete
--       (e.g. a staff-only PPD patch test): "Please book a patch test first."
--   compliance_records.capture_channel 'client_booking' — records captured inline while
--       the client completes their online booking.
--
-- Replaces the venue-wide feature_flags.compliance.auto_send_on_booking toggle: its value
-- is migrated into per-requirement online_collection (on -> confirmation_link, off -> none).
-- Idempotent.

-- 1. service_compliance_requirements.online_collection (+ one-time backfill from the old toggle)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_compliance_requirements'
      AND column_name = 'online_collection'
  ) THEN
    ALTER TABLE public.service_compliance_requirements
      ADD COLUMN online_collection text NOT NULL DEFAULT 'confirmation_link';
    ALTER TABLE public.service_compliance_requirements
      ADD CONSTRAINT service_compliance_requirements_online_collection_check
      CHECK (online_collection IN ('inline', 'confirmation_link', 'none'));
    -- ADD COLUMN ... DEFAULT set every existing row to 'confirmation_link'; correct the rows
    -- whose venue had the old auto-send toggle OFF so current behaviour is preserved (no link).
    UPDATE public.service_compliance_requirements scr
    SET online_collection = 'none'
    FROM public.venues v
    WHERE v.id = scr.venue_id
      AND COALESCE((v.feature_flags #>> '{compliance,auto_send_on_booking}')::boolean, false) = false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_service_compliance_requirements_online_collection
  ON public.service_compliance_requirements (venue_id, online_collection);

-- 2. compliance_types.online_unmet_message
ALTER TABLE public.compliance_types
  ADD COLUMN IF NOT EXISTS online_unmet_message text;

-- 3. compliance_records.capture_channel: add 'client_booking'
ALTER TABLE public.compliance_records
  DROP CONSTRAINT IF EXISTS compliance_records_capture_channel_check;
ALTER TABLE public.compliance_records
  ADD CONSTRAINT compliance_records_capture_channel_check
  CHECK (capture_channel IN (
    'staff_web', 'staff_mobile', 'client_email', 'client_sms', 'client_walkin', 'client_booking', 'import'
  ));
