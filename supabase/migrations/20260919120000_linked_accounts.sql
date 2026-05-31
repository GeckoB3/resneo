-- Resneo: Linked Accounts feature (see Docs/reserveni-linked-accounts-spec.md)
-- Phase 1: pairwise venue links + cross-venue audit log.
-- Phase 2: venue collectives (combined public booking page).
-- Idempotent: Supabase Preview / branched DBs may already have parts of this.

-- =============================================================================
-- 1. Enums
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_status') THEN
    CREATE TYPE link_status AS ENUM (
      'pending', 'accepted', 'rejected', 'revoked', 'expired', 'suspended'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_calendar_visibility') THEN
    CREATE TYPE link_calendar_visibility AS ENUM ('none', 'time_only', 'full_details');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_action_level') THEN
    CREATE TYPE link_action_level AS ENUM ('none', 'edit_existing', 'create_edit_cancel');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_termination_reason') THEN
    CREATE TYPE link_termination_reason AS ENUM (
      'unlinked', 'subscription_lapsed', 'venue_deleted', 'plan_ineligible', 'request_expired'
    );
  END IF;
END $$;

-- =============================================================================
-- 2. account_links — pairwise relationship between two venues
-- =============================================================================

CREATE TABLE IF NOT EXISTS account_links (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_low_id            uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  venue_high_id           uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  requested_by_venue_id   uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  status                  link_status NOT NULL DEFAULT 'pending',

  -- Permissions GRANTED BY venue_low TO venue_high (what high may do to low's data)
  low_grants_calendar     link_calendar_visibility NOT NULL DEFAULT 'full_details',
  low_grants_pii          boolean NOT NULL DEFAULT true,
  low_grants_act          link_action_level NOT NULL DEFAULT 'edit_existing',

  -- Permissions GRANTED BY venue_high TO venue_low
  high_grants_calendar    link_calendar_visibility NOT NULL DEFAULT 'full_details',
  high_grants_pii         boolean NOT NULL DEFAULT true,
  high_grants_act         link_action_level NOT NULL DEFAULT 'edit_existing',

  request_message         text,
  -- A negotiated mid-link permission change awaiting the other venue's
  -- acceptance (§6.5). jsonb: { by_venue_id, proposed_at, low_grants_*,
  -- high_grants_* }. NULL when there is no pending change.
  pending_change          jsonb,
  created_by_user_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  responded_by_user_id    uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  responded_at            timestamptz,
  suspended_at            timestamptz,
  terminated_at           timestamptz,
  termination_reason      link_termination_reason,
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_links_ordered_pair CHECK (venue_low_id < venue_high_id),
  CONSTRAINT account_links_requester_member
    CHECK (requested_by_venue_id IN (venue_low_id, venue_high_id)),

  -- §5.5 permission-coherence rules, applied per direction.
  CONSTRAINT account_links_low_coherent CHECK (
    (low_grants_calendar = 'full_details'
       OR (low_grants_pii = false AND low_grants_act = 'none'))
    AND (low_grants_pii = true OR low_grants_act = 'none')
  ),
  CONSTRAINT account_links_high_coherent CHECK (
    (high_grants_calendar = 'full_details'
       OR (high_grants_pii = false AND high_grants_act = 'none'))
    AND (high_grants_pii = true OR high_grants_act = 'none')
  ),
  -- A link cannot grant 'none' in both directions — that is a no-op.
  CONSTRAINT account_links_not_zero_way CHECK (
    low_grants_calendar <> 'none' OR high_grants_calendar <> 'none'
  )
);

-- Only one live link per venue pair; once dead, a fresh request may be created.
CREATE UNIQUE INDEX IF NOT EXISTS account_links_active_pair
  ON account_links (venue_low_id, venue_high_id)
  WHERE status IN ('pending', 'accepted', 'suspended');

CREATE INDEX IF NOT EXISTS account_links_low_status ON account_links (venue_low_id, status);
CREATE INDEX IF NOT EXISTS account_links_high_status ON account_links (venue_high_id, status);

COMMENT ON TABLE account_links IS
  'Pairwise link between two Resneo venues. venue_low_id < venue_high_id. Permissions are per-direction.';

CREATE OR REPLACE FUNCTION account_links_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_links_updated_at ON account_links;
CREATE TRIGGER account_links_updated_at
  BEFORE UPDATE ON account_links
  FOR EACH ROW
  EXECUTE PROCEDURE account_links_set_updated_at();

-- =============================================================================
-- 3. account_link_audit_log — cross-venue action record (never deleted)
-- =============================================================================

CREATE TABLE IF NOT EXISTS account_link_audit_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id             uuid NOT NULL REFERENCES account_links (id) ON DELETE CASCADE,
  acting_venue_id     uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  acting_user_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  owning_venue_id     uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  action_type         text NOT NULL,
  resource_type       text,
  resource_id         uuid,
  before_state        jsonb,
  after_state         jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_link_audit_owning
  ON account_link_audit_log (owning_venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_link_audit_acting
  ON account_link_audit_log (acting_venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS account_link_audit_link
  ON account_link_audit_log (link_id, created_at DESC);

COMMENT ON TABLE account_link_audit_log IS
  'Append-only cross-venue action record. Visible to both venues; retained after link termination.';

-- =============================================================================
-- 4. bookings — cross-venue attribution columns
-- =============================================================================

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS created_by_linked_venue_id uuid REFERENCES venues (id) ON DELETE SET NULL;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS last_modified_by_linked_venue_id uuid REFERENCES venues (id) ON DELETE SET NULL;
-- Phase 2: optional collective attribution for bookings routed via /book/c/{slug}.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS collective_id uuid;

COMMENT ON COLUMN bookings.created_by_linked_venue_id IS
  'Set when a linked venue created this booking via an account_link. NULL for same-venue bookings.';

-- =============================================================================
-- 5. venue_collectives / venue_collective_members — Phase 2
-- =============================================================================

CREATE TABLE IF NOT EXISTS venue_collectives (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                     text NOT NULL UNIQUE,
  name                     text NOT NULL,
  host_venue_id            uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  branding                 jsonb NOT NULL DEFAULT '{}',
  service_grouping         text NOT NULL DEFAULT 'by_practitioner',
  allow_any_practitioner   boolean NOT NULL DEFAULT false,
  status                   text NOT NULL DEFAULT 'active',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_collectives_grouping_valid
    CHECK (service_grouping IN ('by_practitioner', 'by_service_type')),
  CONSTRAINT venue_collectives_status_valid
    CHECK (status IN ('active', 'dissolved'))
);

CREATE INDEX IF NOT EXISTS venue_collectives_host ON venue_collectives (host_venue_id);

CREATE TABLE IF NOT EXISTS venue_collective_members (
  id                                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id                        uuid NOT NULL REFERENCES venue_collectives (id) ON DELETE CASCADE,
  venue_id                             uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  status                               text NOT NULL DEFAULT 'invited',
  display_order                        integer NOT NULL DEFAULT 0,
  visible_practitioner_ids             uuid[] NOT NULL DEFAULT '{}',
  visible_service_ids                  uuid[] NOT NULL DEFAULT '{}',
  allow_any_practitioner_substitution  boolean NOT NULL DEFAULT false,
  invited_by_user_id                   uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  joined_at                            timestamptz,
  left_at                              timestamptz,
  created_at                           timestamptz NOT NULL DEFAULT now(),
  updated_at                           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_collective_members_status_valid
    CHECK (status IN ('invited', 'active', 'left', 'removed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS venue_collective_members_live
  ON venue_collective_members (collective_id, venue_id)
  WHERE status IN ('invited', 'active');
CREATE INDEX IF NOT EXISTS venue_collective_members_venue
  ON venue_collective_members (venue_id, status);

DROP TRIGGER IF EXISTS venue_collectives_updated_at ON venue_collectives;
CREATE TRIGGER venue_collectives_updated_at
  BEFORE UPDATE ON venue_collectives
  FOR EACH ROW
  EXECUTE PROCEDURE account_links_set_updated_at();

DROP TRIGGER IF EXISTS venue_collective_members_updated_at ON venue_collective_members;
CREATE TRIGGER venue_collective_members_updated_at
  BEFORE UPDATE ON venue_collective_members
  FOR EACH ROW
  EXECUTE PROCEDURE account_links_set_updated_at();

-- =============================================================================
-- 6. Cross-venue access helper functions (SECURITY DEFINER)
-- =============================================================================

-- The set of venue ids the current caller is active staff at.
CREATE OR REPLACE FUNCTION public.current_staff_venue_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT venue_id FROM public.staff
  WHERE revoked_at IS NULL
    AND (email = (auth.jwt() ->> 'email')
         OR (user_id IS NOT NULL AND user_id = auth.uid()));
$$;

-- Best calendar visibility the caller has into p_owner_venue via any accepted link.
CREATE OR REPLACE FUNCTION public.link_calendar_grant(p_owner_venue uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT g.v FROM (
       SELECT CASE
         WHEN al.venue_low_id = p_owner_venue THEN al.low_grants_calendar::text
         ELSE al.high_grants_calendar::text
       END AS v
       FROM public.account_links al
       WHERE al.status = 'accepted'
         AND (
           (al.venue_low_id  = p_owner_venue AND al.venue_high_id IN (SELECT current_staff_venue_ids()))
           OR
           (al.venue_high_id = p_owner_venue AND al.venue_low_id  IN (SELECT current_staff_venue_ids()))
         )
     ) g
     ORDER BY CASE g.v WHEN 'full_details' THEN 2 WHEN 'time_only' THEN 1 ELSE 0 END DESC
     LIMIT 1),
    'none');
$$;

-- Whether the caller has PII access into p_owner_venue via any accepted link.
CREATE OR REPLACE FUNCTION public.link_pii_grant(p_owner_venue uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bool_or(
    CASE
      WHEN al.venue_low_id = p_owner_venue THEN al.low_grants_pii
      ELSE al.high_grants_pii
    END
  ), false)
  FROM public.account_links al
  WHERE al.status = 'accepted'
    AND (
      (al.venue_low_id  = p_owner_venue AND al.venue_high_id IN (SELECT current_staff_venue_ids()))
      OR
      (al.venue_high_id = p_owner_venue AND al.venue_low_id  IN (SELECT current_staff_venue_ids()))
    );
$$;

-- Best action level the caller has into p_owner_venue via any accepted link.
CREATE OR REPLACE FUNCTION public.link_action_grant(p_owner_venue uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT g.v FROM (
       SELECT CASE
         WHEN al.venue_low_id = p_owner_venue THEN al.low_grants_act::text
         ELSE al.high_grants_act::text
       END AS v
       FROM public.account_links al
       WHERE al.status = 'accepted'
         AND (
           (al.venue_low_id  = p_owner_venue AND al.venue_high_id IN (SELECT current_staff_venue_ids()))
           OR
           (al.venue_high_id = p_owner_venue AND al.venue_low_id  IN (SELECT current_staff_venue_ids()))
         )
     ) g
     ORDER BY CASE g.v WHEN 'create_edit_cancel' THEN 2 WHEN 'edit_existing' THEN 1 ELSE 0 END DESC
     LIMIT 1),
    'none');
$$;

-- Relation name the application should read for bookings of p_owner_venue:
-- 'bookings' for own venue / full_details, 'bookings_linked_anonymised' for time_only.
CREATE OR REPLACE FUNCTION public.get_linked_booking_source(p_owner_venue uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_owner_venue IN (SELECT current_staff_venue_ids()) THEN 'bookings'
    WHEN public.link_calendar_grant(p_owner_venue) = 'full_details' THEN 'bookings'
    WHEN public.link_calendar_grant(p_owner_venue) = 'time_only' THEN 'bookings_linked_anonymised'
    ELSE 'bookings'
  END;
$$;

-- =============================================================================
-- 7. bookings_linked_anonymised — field-level redaction for time_only viewers
-- =============================================================================

CREATE OR REPLACE VIEW public.bookings_linked_anonymised
WITH (security_barrier = true) AS
SELECT
  b.id, b.venue_id, b.practitioner_id,
  b.booking_date, b.booking_time, b.booking_end_time,
  b.status,
  NULL::uuid AS guest_id,
  NULL::uuid AS appointment_service_id,
  NULL::text AS dietary_notes,
  NULL::text AS occasion,
  NULL::text AS special_requests
FROM public.bookings b;

COMMENT ON VIEW public.bookings_linked_anonymised IS
  'time_only linked viewers read bookings through this view: time blocks only, all PII / service nulled.';

-- =============================================================================
-- 8. Cross-venue audit trigger on bookings
-- =============================================================================

-- A cross-venue mutation is performed via the linked_apply_* RPCs below, which
-- set the transaction-local GUC reserveni.linked_action_* keys. The trigger
-- writes an account_link_audit_log row only when those keys are present, so a
-- normal same-venue booking write never produces a cross-venue audit row.
CREATE OR REPLACE FUNCTION log_cross_venue_booking_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting_venue uuid;
  acting_user uuid;
  link uuid;
  act text;
BEGIN
  acting_venue := NULLIF(current_setting('reserveni.linked_action_venue', true), '')::uuid;
  IF acting_venue IS NULL THEN
    RETURN NEW;
  END IF;
  acting_user := NULLIF(current_setting('reserveni.linked_action_user', true), '')::uuid;
  link := NULLIF(current_setting('reserveni.linked_action_link', true), '')::uuid;

  IF TG_OP = 'INSERT' THEN
    act := 'created_booking';
    INSERT INTO account_link_audit_log
      (link_id, acting_venue_id, acting_user_id, owning_venue_id,
       action_type, resource_type, resource_id, before_state, after_state)
    VALUES
      (link, acting_venue, acting_user, NEW.venue_id,
       act, 'booking', NEW.id, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled' THEN
      act := 'cancelled_booking';
    ELSE
      act := 'edited_booking';
    END IF;
    INSERT INTO account_link_audit_log
      (link_id, acting_venue_id, acting_user_id, owning_venue_id,
       action_type, resource_type, resource_id, before_state, after_state)
    VALUES
      (link, acting_venue, acting_user, NEW.venue_id,
       act, 'booking', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cross_venue_booking_audit_trigger ON bookings;
CREATE TRIGGER cross_venue_booking_audit_trigger
  AFTER INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE PROCEDURE log_cross_venue_booking_action();

-- =============================================================================
-- 9. Cross-venue booking mutation RPCs
-- =============================================================================
-- These set the transaction-local audit GUCs and perform the write in the same
-- transaction so the audit trigger captures the acting venue / user / link.
-- Permission checks are performed in the API layer before these are called.

CREATE OR REPLACE FUNCTION public.linked_apply_booking_update(
  p_actor_user_id uuid,
  p_acting_venue_id uuid,
  p_link_id uuid,
  p_booking_id uuid,
  p_changes jsonb
)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result bookings;
BEGIN
  PERFORM set_config('reserveni.linked_action_venue', p_acting_venue_id::text, true);
  PERFORM set_config('reserveni.linked_action_user', COALESCE(p_actor_user_id::text, ''), true);
  PERFORM set_config('reserveni.linked_action_link', COALESCE(p_link_id::text, ''), true);

  UPDATE bookings SET
    booking_date           = COALESCE((p_changes->>'booking_date')::date, booking_date),
    booking_time           = COALESCE((p_changes->>'booking_time')::time, booking_time),
    booking_end_time       = COALESCE((p_changes->>'booking_end_time')::time, booking_end_time),
    practitioner_id        = CASE WHEN p_changes ? 'practitioner_id'
                                  THEN NULLIF(p_changes->>'practitioner_id', '')::uuid
                                  ELSE practitioner_id END,
    appointment_service_id = CASE WHEN p_changes ? 'appointment_service_id'
                                  THEN NULLIF(p_changes->>'appointment_service_id', '')::uuid
                                  ELSE appointment_service_id END,
    status                 = COALESCE((p_changes->>'status')::booking_status, status),
    special_requests       = CASE WHEN p_changes ? 'special_requests'
                                  THEN p_changes->>'special_requests' ELSE special_requests END,
    dietary_notes          = CASE WHEN p_changes ? 'dietary_notes'
                                  THEN p_changes->>'dietary_notes' ELSE dietary_notes END,
    last_modified_by_linked_venue_id = p_acting_venue_id,
    updated_at             = now()
  WHERE id = p_booking_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.linked_apply_booking_insert(
  p_actor_user_id uuid,
  p_acting_venue_id uuid,
  p_link_id uuid,
  p_row jsonb
)
RETURNS bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result bookings;
BEGIN
  PERFORM set_config('reserveni.linked_action_venue', p_acting_venue_id::text, true);
  PERFORM set_config('reserveni.linked_action_user', COALESCE(p_actor_user_id::text, ''), true);
  PERFORM set_config('reserveni.linked_action_link', COALESCE(p_link_id::text, ''), true);

  INSERT INTO bookings (
    venue_id, guest_id, booking_date, booking_time, booking_end_time,
    party_size, status, source, practitioner_id, appointment_service_id,
    special_requests, dietary_notes, booking_model, created_by_linked_venue_id
  )
  VALUES (
    (p_row->>'venue_id')::uuid,
    (p_row->>'guest_id')::uuid,
    (p_row->>'booking_date')::date,
    (p_row->>'booking_time')::time,
    NULLIF(p_row->>'booking_end_time', '')::time,
    COALESCE((p_row->>'party_size')::int, 1),
    COALESCE((p_row->>'status')::booking_status, 'Confirmed'),
    COALESCE((p_row->>'source')::booking_source, 'online'),
    NULLIF(p_row->>'practitioner_id', '')::uuid,
    NULLIF(p_row->>'appointment_service_id', '')::uuid,
    p_row->>'special_requests',
    p_row->>'dietary_notes',
    COALESCE(p_row->>'booking_model', 'unified_scheduling'),
    p_acting_venue_id
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.linked_apply_booking_update(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.linked_apply_booking_update(uuid, uuid, uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.linked_apply_booking_insert(uuid, uuid, uuid, jsonb) TO service_role;

-- =============================================================================
-- 10. Row-Level Security
-- =============================================================================

ALTER TABLE account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_link_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_collectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_collective_members ENABLE ROW LEVEL SECURITY;

-- account_links: staff of either venue may read; service_role manages.
DROP POLICY IF EXISTS "staff_select_account_links" ON account_links;
CREATE POLICY "staff_select_account_links"
  ON account_links FOR SELECT
  USING (
    venue_low_id IN (SELECT current_staff_venue_ids())
    OR venue_high_id IN (SELECT current_staff_venue_ids())
  );

DROP POLICY IF EXISTS "service_role_account_links" ON account_links;
CREATE POLICY "service_role_account_links"
  ON account_links FOR ALL TO service_role USING (true) WITH CHECK (true);

-- account_link_audit_log: both venues on a link may read; service_role writes.
DROP POLICY IF EXISTS "staff_select_audit_log" ON account_link_audit_log;
CREATE POLICY "staff_select_audit_log"
  ON account_link_audit_log FOR SELECT
  USING (
    acting_venue_id IN (SELECT current_staff_venue_ids())
    OR owning_venue_id IN (SELECT current_staff_venue_ids())
  );

DROP POLICY IF EXISTS "service_role_audit_log" ON account_link_audit_log;
CREATE POLICY "service_role_audit_log"
  ON account_link_audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- venue_collectives / members
DROP POLICY IF EXISTS "staff_select_collectives" ON venue_collectives;
CREATE POLICY "staff_select_collectives"
  ON venue_collectives FOR SELECT
  USING (
    host_venue_id IN (SELECT current_staff_venue_ids())
    OR id IN (
      SELECT collective_id FROM venue_collective_members
      WHERE venue_id IN (SELECT current_staff_venue_ids())
    )
  );

DROP POLICY IF EXISTS "service_role_collectives" ON venue_collectives;
CREATE POLICY "service_role_collectives"
  ON venue_collectives FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_active_collectives" ON venue_collectives;
CREATE POLICY "public_read_active_collectives"
  ON venue_collectives FOR SELECT TO anon USING (status = 'active');

DROP POLICY IF EXISTS "staff_select_collective_members" ON venue_collective_members;
CREATE POLICY "staff_select_collective_members"
  ON venue_collective_members FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR collective_id IN (
      SELECT id FROM venue_collectives
      WHERE host_venue_id IN (SELECT current_staff_venue_ids())
    )
  );

DROP POLICY IF EXISTS "service_role_collective_members" ON venue_collective_members;
CREATE POLICY "service_role_collective_members"
  ON venue_collective_members FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_active_collective_members" ON venue_collective_members;
CREATE POLICY "public_read_active_collective_members"
  ON venue_collective_members FOR SELECT TO anon USING (status = 'active');

-- Cross-venue bookings SELECT: own venue, or >= time_only calendar visibility.
DROP POLICY IF EXISTS "linked_venue_can_view_bookings" ON bookings;
CREATE POLICY "linked_venue_can_view_bookings"
  ON bookings FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) IN ('time_only', 'full_details')
  );

-- Cross-venue bookings UPDATE: own venue, or act >= edit_existing.
DROP POLICY IF EXISTS "linked_venue_can_edit_bookings" ON bookings;
CREATE POLICY "linked_venue_can_edit_bookings"
  ON bookings FOR UPDATE
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
  )
  WITH CHECK (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_action_grant(venue_id) IN ('edit_existing', 'create_edit_cancel')
  );

-- Cross-venue bookings INSERT: own venue, or act = create_edit_cancel.
DROP POLICY IF EXISTS "linked_venue_can_insert_bookings" ON bookings;
CREATE POLICY "linked_venue_can_insert_bookings"
  ON bookings FOR INSERT
  WITH CHECK (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_action_grant(venue_id) = 'create_edit_cancel'
  );

-- Cross-venue bookings DELETE: own venue, or act = create_edit_cancel.
DROP POLICY IF EXISTS "linked_venue_can_delete_bookings" ON bookings;
CREATE POLICY "linked_venue_can_delete_bookings"
  ON bookings FOR DELETE
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_action_grant(venue_id) = 'create_edit_cancel'
  );

-- Cross-venue guests SELECT: own venue, or full_details + PII granted.
DROP POLICY IF EXISTS "linked_venue_can_view_guests" ON guests;
CREATE POLICY "linked_venue_can_view_guests"
  ON guests FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR (public.link_calendar_grant(venue_id) = 'full_details'
        AND public.link_pii_grant(venue_id) = true)
  );

-- Linked-venue staff need to see inactive practitioners to render historic
-- bookings on a shared calendar; public_read_practitioners only covers active.
DROP POLICY IF EXISTS "linked_venue_can_view_practitioners" ON practitioners;
CREATE POLICY "linked_venue_can_view_practitioners"
  ON practitioners FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) IN ('time_only', 'full_details')
  );

DROP POLICY IF EXISTS "linked_venue_can_view_appointment_services" ON appointment_services;
CREATE POLICY "linked_venue_can_view_appointment_services"
  ON appointment_services FOR SELECT
  USING (
    venue_id IN (SELECT current_staff_venue_ids())
    OR public.link_calendar_grant(venue_id) = 'full_details'
  );

-- =============================================================================
-- End of linked accounts migration
-- =============================================================================
