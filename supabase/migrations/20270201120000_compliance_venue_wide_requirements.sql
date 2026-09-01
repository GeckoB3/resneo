-- Reserve NI: Compliance requirements that apply to all appointment bookings
-- (Docs/compliance-booking-flow-plan.md §4, decision 2026-09-01).
--
-- Adds service_compliance_requirements.scope:
--   'service' — the row binds one Model B service (the only shape until now)
--   'venue'   — the row has no service FK and applies to every Model B booking at the
--               venue: a new client intake form, a general consent, and so on.
--
-- The one-service CHECK is replaced by a scope-aware one, and a partial unique index
-- stops a type being required venue-wide twice. Existing rows default to 'service' and
-- satisfy the new constraint unchanged. Code deployed before this migration filters by
-- service FK and never sees a 'venue' row, so it can land first. Expanding only; idempotent.

-- 1. scope column (+ its value check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'service_compliance_requirements'
      AND column_name = 'scope'
  ) THEN
    ALTER TABLE public.service_compliance_requirements
      ADD COLUMN scope text NOT NULL DEFAULT 'service';
    ALTER TABLE public.service_compliance_requirements
      ADD CONSTRAINT service_compliance_requirements_scope_check
      CHECK (scope IN ('service', 'venue'));
  END IF;
END $$;

-- 2. Replace the "exactly one service FK" check with a scope-aware one.
ALTER TABLE public.service_compliance_requirements
  DROP CONSTRAINT IF EXISTS service_compliance_requirements_one_service_fk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'service_compliance_requirements_scope_fk'
      AND conrelid = 'public.service_compliance_requirements'::regclass
  ) THEN
    ALTER TABLE public.service_compliance_requirements
      ADD CONSTRAINT service_compliance_requirements_scope_fk CHECK (
        (scope = 'service' AND num_nonnulls(appointment_service_id, service_item_id) = 1)
        OR (scope = 'venue' AND num_nonnulls(appointment_service_id, service_item_id) = 0)
      );
  END IF;
END $$;

-- 3. One venue-wide row per type, and a cheap way to fetch the venue-wide rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_compliance_req_venue_type
  ON public.service_compliance_requirements (venue_id, compliance_type_id)
  WHERE scope = 'venue';

CREATE INDEX IF NOT EXISTS idx_service_compliance_req_venue_scope
  ON public.service_compliance_requirements (venue_id, scope);
