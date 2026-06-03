-- Reserve NI: Compliance Records feature (spec: Docs/reserveni-compliance-spec.md §4, §10, §14.1)
--
-- Six new tables forming the Compliance domain:
--   compliance_types                 — venue-level definitions of record types
--   compliance_type_versions         — immutable form-schema snapshots
--   compliance_records               — captured instances against a guest
--   service_compliance_requirements  — links Model B services to required types
--   compliance_form_links            — single-use public submission links
--   compliance_audit_events          — append-only audit trail
--
-- Idempotent: uses IF NOT EXISTS everywhere and DROP POLICY IF EXISTS + CREATE POLICY,
-- matching the established convention (see 20260919120000_linked_accounts.sql).

-- =============================================================================
-- 1. Tables
-- =============================================================================

-- --- compliance_types --------------------------------------------------------
-- current_version_id FK is added AFTER compliance_type_versions exists (deferrable,
-- so type + first version can be inserted in the same transaction).
CREATE TABLE IF NOT EXISTS public.compliance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  category text NOT NULL CHECK (category IN ('test','consent','intake','declaration','certificate')),
  description text,
  result_type text NOT NULL CHECK (result_type IN ('pass_fail','signed','completed','file_uploaded')),
  validity_period_days int,                        -- null = lifetime, 0 = single-use, >0 = days
  capture_methods text[] NOT NULL
    CHECK (
      cardinality(capture_methods) >= 1
      AND capture_methods <@ ARRAY['staff_in_venue','client_online']::text[]
    ),
  current_version_id uuid,                          -- FK added below (deferrable)
  library_template_slug text,
  form_link_expiry_days int CHECK (form_link_expiry_days IS NULL OR form_link_expiry_days > 0),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_types_venue_slug_unique UNIQUE (venue_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_compliance_types_venue ON public.compliance_types (venue_id);
CREATE INDEX IF NOT EXISTS idx_compliance_types_venue_active
  ON public.compliance_types (venue_id) WHERE is_active = true;

-- --- compliance_type_versions ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_type_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,   -- denormalised for RLS
  compliance_type_id uuid NOT NULL REFERENCES public.compliance_types (id) ON DELETE CASCADE,
  version_number int NOT NULL,
  form_schema jsonb NOT NULL,
  changelog text,
  created_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_type_versions_type_number_unique UNIQUE (compliance_type_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_compliance_type_versions_type
  ON public.compliance_type_versions (compliance_type_id);
CREATE INDEX IF NOT EXISTS idx_compliance_type_versions_venue
  ON public.compliance_type_versions (venue_id);

-- Deferrable FK: compliance_types.current_version_id -> compliance_type_versions.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_types_current_version_fk'
  ) THEN
    ALTER TABLE public.compliance_types
      ADD CONSTRAINT compliance_types_current_version_fk
      FOREIGN KEY (current_version_id)
      REFERENCES public.compliance_type_versions (id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- --- compliance_records -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  compliance_type_id uuid NOT NULL REFERENCES public.compliance_types (id) ON DELETE RESTRICT,
  compliance_type_version_id uuid NOT NULL REFERENCES public.compliance_type_versions (id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','expired','voided')),
  result text CHECK (result IN ('pass','fail','inconclusive','completed','signed')),
  responses jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  capture_channel text NOT NULL
    CHECK (capture_channel IN ('staff_web','staff_mobile','client_email','client_sms','client_walkin','import')),
  capture_ip inet,
  capture_user_agent text,
  expires_at timestamptz,
  notes text,
  voided_at timestamptz,
  voided_reason text,
  voided_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_records_lookup
  ON public.compliance_records (venue_id, guest_id, compliance_type_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_records_expiry
  ON public.compliance_records (venue_id, expires_at) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_compliance_records_booking
  ON public.compliance_records (booking_id) WHERE booking_id IS NOT NULL;

-- --- service_compliance_requirements -----------------------------------------
-- Polymorphic service FK: exactly one of appointment_service_id / service_item_id.
CREATE TABLE IF NOT EXISTS public.service_compliance_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  appointment_service_id uuid REFERENCES public.appointment_services (id) ON DELETE CASCADE,
  service_item_id uuid REFERENCES public.service_items (id) ON DELETE CASCADE,
  compliance_type_id uuid NOT NULL REFERENCES public.compliance_types (id) ON DELETE RESTRICT,
  enforcement text NOT NULL CHECK (enforcement IN ('warn_staff','warn_client','block_online','block_all')),
  lock_period_hours int CHECK (lock_period_hours IS NULL OR lock_period_hours >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_compliance_requirements_one_service_fk
    CHECK (num_nonnulls(appointment_service_id, service_item_id) = 1)
);

CREATE INDEX IF NOT EXISTS idx_service_compliance_requirements_venue
  ON public.service_compliance_requirements (venue_id);
CREATE INDEX IF NOT EXISTS idx_service_compliance_requirements_appt_service
  ON public.service_compliance_requirements (appointment_service_id) WHERE appointment_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_compliance_requirements_service_item
  ON public.service_compliance_requirements (service_item_id) WHERE service_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_compliance_requirements_type
  ON public.service_compliance_requirements (compliance_type_id);
-- One requirement per (service, type) — partial unique indexes per polymorphic branch.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_compliance_req_appt_service_type
  ON public.service_compliance_requirements (appointment_service_id, compliance_type_id)
  WHERE appointment_service_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_compliance_req_service_item_type
  ON public.service_compliance_requirements (service_item_id, compliance_type_id)
  WHERE service_item_id IS NOT NULL;

-- --- compliance_form_links ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_form_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 8 AND 12),
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  compliance_type_id uuid NOT NULL REFERENCES public.compliance_types (id) ON DELETE RESTRICT,
  compliance_type_version_id uuid NOT NULL REFERENCES public.compliance_type_versions (id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES public.bookings (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','expired','revoked')),
  consumed_record_id uuid REFERENCES public.compliance_records (id) ON DELETE SET NULL,
  sent_via text CHECK (sent_via IN ('email','sms','manual_copy')),
  sent_at timestamptz,
  prefill jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  access_count int NOT NULL DEFAULT 0,
  last_accessed_at timestamptz,
  created_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_form_links_venue
  ON public.compliance_form_links (venue_id);
CREATE INDEX IF NOT EXISTS idx_compliance_form_links_guest_status
  ON public.compliance_form_links (guest_id, status);
CREATE INDEX IF NOT EXISTS idx_compliance_form_links_pending
  ON public.compliance_form_links (compliance_type_id, guest_id) WHERE status = 'pending';

-- --- compliance_audit_events --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compliance_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests (id) ON DELETE SET NULL,
  compliance_record_id uuid REFERENCES public.compliance_records (id) ON DELETE SET NULL,
  compliance_form_link_id uuid REFERENCES public.compliance_form_links (id) ON DELETE SET NULL,
  compliance_type_id uuid REFERENCES public.compliance_types (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('staff','client','system')),
  actor_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_venue_guest
  ON public.compliance_audit_events (venue_id, guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compliance_audit_record
  ON public.compliance_audit_events (compliance_record_id) WHERE compliance_record_id IS NOT NULL;

-- =============================================================================
-- 2. Append-only trigger on compliance_audit_events (model: events_append_only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.compliance_audit_deny_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'compliance_audit_events is append-only: % not allowed', TG_OP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS compliance_audit_append_only ON public.compliance_audit_events;
CREATE TRIGGER compliance_audit_append_only
  BEFORE UPDATE OR DELETE ON public.compliance_audit_events
  FOR EACH ROW
  EXECUTE PROCEDURE public.compliance_audit_deny_update_delete();

-- =============================================================================
-- 3. Row-level security
-- =============================================================================
ALTER TABLE public.compliance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_type_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_compliance_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_form_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_audit_events ENABLE ROW LEVEL SECURITY;

-- compliance_types ------------------------------------------------------------
DROP POLICY IF EXISTS "staff_select_compliance_types" ON public.compliance_types;
CREATE POLICY "staff_select_compliance_types"
  ON public.compliance_types FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_manage_compliance_types" ON public.compliance_types;
CREATE POLICY "staff_manage_compliance_types"
  ON public.compliance_types FOR ALL
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_compliance_types" ON public.compliance_types;
CREATE POLICY "service_role_compliance_types"
  ON public.compliance_types FOR ALL TO service_role USING (true) WITH CHECK (true);

-- compliance_type_versions ----------------------------------------------------
DROP POLICY IF EXISTS "staff_select_compliance_type_versions" ON public.compliance_type_versions;
CREATE POLICY "staff_select_compliance_type_versions"
  ON public.compliance_type_versions FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_manage_compliance_type_versions" ON public.compliance_type_versions;
CREATE POLICY "staff_manage_compliance_type_versions"
  ON public.compliance_type_versions FOR ALL
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_compliance_type_versions" ON public.compliance_type_versions;
CREATE POLICY "service_role_compliance_type_versions"
  ON public.compliance_type_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- compliance_records — SELECT + INSERT + UPDATE for staff; NO DELETE policy -----
DROP POLICY IF EXISTS "staff_select_compliance_records" ON public.compliance_records;
CREATE POLICY "staff_select_compliance_records"
  ON public.compliance_records FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_insert_compliance_records" ON public.compliance_records;
CREATE POLICY "staff_insert_compliance_records"
  ON public.compliance_records FOR INSERT
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_update_compliance_records" ON public.compliance_records;
CREATE POLICY "staff_update_compliance_records"
  ON public.compliance_records FOR UPDATE
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_compliance_records" ON public.compliance_records;
CREATE POLICY "service_role_compliance_records"
  ON public.compliance_records FOR ALL TO service_role USING (true) WITH CHECK (true);

-- service_compliance_requirements ---------------------------------------------
DROP POLICY IF EXISTS "staff_select_service_compliance_requirements" ON public.service_compliance_requirements;
CREATE POLICY "staff_select_service_compliance_requirements"
  ON public.service_compliance_requirements FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_manage_service_compliance_requirements" ON public.service_compliance_requirements;
CREATE POLICY "staff_manage_service_compliance_requirements"
  ON public.service_compliance_requirements FOR ALL
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_service_compliance_requirements" ON public.service_compliance_requirements;
CREATE POLICY "service_role_service_compliance_requirements"
  ON public.service_compliance_requirements FOR ALL TO service_role USING (true) WITH CHECK (true);

-- compliance_form_links — staff manage; no public anon access ------------------
DROP POLICY IF EXISTS "staff_select_compliance_form_links" ON public.compliance_form_links;
CREATE POLICY "staff_select_compliance_form_links"
  ON public.compliance_form_links FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "staff_manage_compliance_form_links" ON public.compliance_form_links;
CREATE POLICY "staff_manage_compliance_form_links"
  ON public.compliance_form_links FOR ALL
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')))
  WITH CHECK (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_compliance_form_links" ON public.compliance_form_links;
CREATE POLICY "service_role_compliance_form_links"
  ON public.compliance_form_links FOR ALL TO service_role USING (true) WITH CHECK (true);

-- compliance_audit_events — SELECT for staff only; NO INSERT/UPDATE/DELETE ------
DROP POLICY IF EXISTS "staff_select_compliance_audit_events" ON public.compliance_audit_events;
CREATE POLICY "staff_select_compliance_audit_events"
  ON public.compliance_audit_events FOR SELECT
  USING (venue_id IN (SELECT venue_id FROM public.staff WHERE email = (auth.jwt() ->> 'email')));

DROP POLICY IF EXISTS "service_role_compliance_audit_events" ON public.compliance_audit_events;
CREATE POLICY "service_role_compliance_audit_events"
  ON public.compliance_audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- =============================================================================
-- 4. Private storage bucket for signatures + file-upload field type
-- =============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('compliance-files', 'compliance-files', false, 10485760)
ON CONFLICT (id) DO NOTHING;
