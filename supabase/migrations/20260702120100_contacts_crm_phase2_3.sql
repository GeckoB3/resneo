-- Reserve NI: Contacts CRM Phase 2/3 — audit, documents, merge, households, loyalty, marketing consent events.

-- -----------------------------------------------------------------------------
-- Append-only contact / GDPR audit log (server writes via service role)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests (id) ON DELETE SET NULL,
  actor_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_audit_venue_guest ON public.contact_audit_events (venue_id, guest_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_audit_venue_time ON public.contact_audit_events (venue_id, created_at DESC);

ALTER TABLE public.contact_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_contact_audit_events"
  ON public.contact_audit_events FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- No INSERT/UPDATE/DELETE for anon JWT — API uses service role.

-- -----------------------------------------------------------------------------
-- Guest documents (private storage paths; metadata only in DB)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  mime_type text,
  file_size_bytes int,
  category text,
  uploaded_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  uploaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_guest_documents_storage_path ON public.guest_documents (storage_path);
CREATE INDEX IF NOT EXISTS idx_guest_documents_guest ON public.guest_documents (venue_id, guest_id) WHERE deleted_at IS NULL;

ALTER TABLE public.guest_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_guest_documents"
  ON public.guest_documents FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- -----------------------------------------------------------------------------
-- Merge audit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  target_guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  source_guest_ids uuid[] NOT NULL,
  field_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_merge_venue ON public.guest_merge_events (venue_id, created_at DESC);

ALTER TABLE public.guest_merge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_guest_merge_events"
  ON public.guest_merge_events FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- -----------------------------------------------------------------------------
-- Marketing consent audit trail
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_marketing_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  actor_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  marketing_consent boolean NOT NULL,
  marketing_opt_out boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_mkt_consent_guest ON public.guest_marketing_consent_events (guest_id, created_at DESC);

ALTER TABLE public.guest_marketing_consent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_guest_marketing_consent_events"
  ON public.guest_marketing_consent_events FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- -----------------------------------------------------------------------------
-- Households
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_households (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_households_venue ON public.guest_households (venue_id);

CREATE TABLE IF NOT EXISTS public.guest_household_members (
  household_id uuid NOT NULL REFERENCES public.guest_households (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  role text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, guest_id)
);

CREATE INDEX IF NOT EXISTS idx_guest_household_members_guest ON public.guest_household_members (guest_id);

ALTER TABLE public.guest_households ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_household_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_guest_households"
  ON public.guest_households FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

CREATE POLICY "staff_select_guest_household_members"
  ON public.guest_household_members FOR SELECT
  USING (
    household_id IN (
      SELECT id FROM public.guest_households h
      WHERE h.venue_id IN (
        SELECT venue_id FROM public.staff
        WHERE email = (auth.jwt() ->> 'email')
      )
    )
  );

-- -----------------------------------------------------------------------------
-- Loyalty ledger (append-only deltas; balance = sum in app)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES public.guests (id) ON DELETE CASCADE,
  delta_points int NOT NULL,
  balance_after int,
  reason text,
  reference_type text,
  reference_id uuid,
  created_by_staff_id uuid REFERENCES public.staff (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guest_loyalty_guest ON public.guest_loyalty_ledger (venue_id, guest_id, created_at DESC);

ALTER TABLE public.guest_loyalty_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_select_guest_loyalty_ledger"
  ON public.guest_loyalty_ledger FOR SELECT
  USING (
    venue_id IN (
      SELECT venue_id FROM public.staff
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- -----------------------------------------------------------------------------
-- Storage bucket for guest documents (signed URLs from API)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('guest-documents', 'guest-documents', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Atomic merge: re-point FKs and delete duplicate guest rows
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_guests_into(
  p_venue_id uuid,
  p_target uuid,
  p_sources uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s uuid;
  rec RECORD;
BEGIN
  IF p_sources IS NULL OR array_length(p_sources, 1) IS NULL THEN
    RAISE EXCEPTION 'merge_guests_into: no sources';
  END IF;

  IF p_target = ANY (p_sources) THEN
    RAISE EXCEPTION 'merge_guests_into: target in sources';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.guests WHERE id = p_target AND venue_id = p_venue_id) THEN
    RAISE EXCEPTION 'merge_guests_into: target not found';
  END IF;

  FOREACH s IN ARRAY p_sources LOOP
    IF NOT EXISTS (SELECT 1 FROM public.guests WHERE id = s AND venue_id = p_venue_id) THEN
      RAISE EXCEPTION 'merge_guests_into: source % not found', s;
    END IF;
  END LOOP;

  UPDATE public.bookings
  SET guest_id = p_target, updated_at = now()
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.communications
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.guest_documents
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources) AND deleted_at IS NULL;

  UPDATE public.guest_loyalty_ledger
  SET guest_id = p_target
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  UPDATE public.class_course_enrollments
  SET guest_id = p_target, updated_at = now()
  WHERE venue_id = p_venue_id AND guest_id = ANY (p_sources);

  FOREACH s IN ARRAY p_sources LOOP
    FOR rec IN SELECT household_id FROM public.guest_household_members WHERE guest_id = s LOOP
      IF EXISTS (
        SELECT 1 FROM public.guest_household_members m
        WHERE m.household_id = rec.household_id AND m.guest_id = p_target
      ) THEN
        DELETE FROM public.guest_household_members
        WHERE household_id = rec.household_id AND guest_id = s;
      ELSE
        UPDATE public.guest_household_members
        SET guest_id = p_target
        WHERE household_id = rec.household_id AND guest_id = s;
      END IF;
    END LOOP;
  END LOOP;

  IF to_regclass('public.import_booking_rows') IS NOT NULL THEN
    UPDATE public.import_booking_rows
    SET guest_id = p_target
    WHERE guest_id = ANY (p_sources);
  END IF;

  DELETE FROM public.guests
  WHERE venue_id = p_venue_id AND id = ANY (p_sources);
END;
$$;

REVOKE ALL ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_guests_into(uuid, uuid, uuid[]) TO service_role;

COMMENT ON FUNCTION public.merge_guests_into IS 'Venue-scoped merge: re-point CRM/booking FKs to target guest and delete source guest rows.';
