-- Collective engine schema, dark (Docs/collective-one-venue-plan.md W3, §6.3, Appendix C; Pass A2).
--
-- EXPAND ONLY, AND INERT. Nothing here changes what any request does today: no collective is in
-- `service_model = 'replicas'` (the new column defaults to `legacy_copies`), no function writes the
-- new tables yet, and the only new triggers are bookkeeping (append-only audit, updated_at), a
-- venue-consistency check that no existing row violates, and a host guard that is gated on the
-- replicas model. The engine functions, dirty and lock triggers and the release trigger follow in
-- their own migrations once they exist.
--
-- Taken from Appendix C with these deliberate differences:
--   * `collective_column_classes` already exists (20270211120000, W3a).
--   * bookings.service_price_snapshot_pence, venues.stripe_charges_enabled, the per-calendar
--     columns, the service_items updated_at trigger and service_items_sync_not_self already exist
--     (20270212120000, 20270213120000, 20270214140000, 20270210120000, 20270214130000).
--   * No collective value for bookings.source (D55, owner 2026-09-14).
--   * The two "one live" unique indexes (a venue in at most one live collective, a venue hosting at
--     most one) are NOT added: the plan adds them only once invariant I7 returns 0 on production,
--     which the W0 survey has not yet run. Staging returned 0 on 2026-09-15.
--   * The sync-column refusal (C.4 `trg_service_items_sync_columns`, RN006) is covered by
--     20270214130000, which refuses client writes to those columns outright.

-- ===========================================================================
-- 1. Replica links: one row per (offering, member). Never deleted at release: released_at is set,
--    and a re-join reconnects the released row (T19).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.collective_service_replicas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id               uuid NOT NULL REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  collective_service_item_id  uuid NOT NULL REFERENCES public.collective_service_items (id) ON DELETE CASCADE,
  member_id                   uuid NOT NULL REFERENCES public.venue_collective_members (id) ON DELETE CASCADE,
  venue_id                    uuid NOT NULL REFERENCES public.venues (id) ON DELETE CASCADE,
  -- NULL until the first apply creates the member's row. SET NULL so a member may delete a released
  -- service it owns (D52); a live replica's delete is refused by the lock trigger.
  replica_service_id          uuid REFERENCES public.service_items (id) ON DELETE SET NULL,
  provenance                  text NOT NULL,
  desired_revision            bigint NOT NULL DEFAULT 1,
  applied_revision            bigint NOT NULL DEFAULT 0,
  applied_fingerprint         text,
  behind_since                timestamptz,
  attempts                    integer NOT NULL DEFAULT 0,
  next_attempt_at             timestamptz,
  lease_until                 timestamptz,
  last_error_code             text,
  last_error                  text,
  last_applied_at             timestamptz,
  released_at                 timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_service_replicas_provenance_valid
    CHECK (provenance IN ('created', 'adopted', 'migrated', 'reconnected')),
  CONSTRAINT collective_service_replicas_revisions_ordered
    CHECK (applied_revision >= 0 AND desired_revision >= applied_revision),
  CONSTRAINT collective_service_replicas_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT collective_service_replicas_error_code_valid
    CHECK (last_error_code IS NULL OR last_error_code IN ('slug_collision', 'unique_violation',
      'fk_violation', 'timeout', 'lock_timeout', 'membership_inactive', 'master_missing', 'unknown'))
);

CREATE UNIQUE INDEX IF NOT EXISTS collective_service_replicas_live_pair
  ON public.collective_service_replicas (collective_service_item_id, venue_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collective_service_replicas_service_unique
  ON public.collective_service_replicas (replica_service_id)
  WHERE replica_service_id IS NOT NULL AND released_at IS NULL;
CREATE INDEX IF NOT EXISTS collective_service_replicas_due
  ON public.collective_service_replicas (next_attempt_at, id)
  WHERE applied_revision < desired_revision AND released_at IS NULL;
CREATE INDEX IF NOT EXISTS collective_service_replicas_collective
  ON public.collective_service_replicas (collective_id, venue_id);

DROP TRIGGER IF EXISTS collective_service_replicas_updated_at ON public.collective_service_replicas;
CREATE TRIGGER collective_service_replicas_updated_at
  BEFORE UPDATE ON public.collective_service_replicas
  FOR EACH ROW EXECUTE PROCEDURE public.account_links_set_updated_at();

ALTER TABLE public.collective_service_replicas ENABLE ROW LEVEL SECURITY;  -- no policies: service role only
REVOKE ALL ON TABLE public.collective_service_replicas FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 2. One catalogue revision per collective, kept off venue_collectives so it is not a hot row.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.collective_catalogue_revisions (
  collective_id  uuid PRIMARY KEY REFERENCES public.venue_collectives (id) ON DELETE CASCADE,
  revision       bigint NOT NULL DEFAULT 1,
  bumped_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.collective_catalogue_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_catalogue_revisions FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. The engine's audit trail. Append-only, and no foreign key anywhere, venue columns included,
--    so history outlives every row it names. Venue names are denormalised for the same reason.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.collective_audit_events (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id                uuid NOT NULL,
  collective_name              text NOT NULL,
  event_type                   text NOT NULL,
  actor_type                   text NOT NULL,
  actor_venue_id               uuid,
  actor_venue_name             text,
  actor_user_id                uuid,
  actor_is_platform_superuser  boolean NOT NULL DEFAULT false,
  support_session_id           uuid,
  system_job                   text,
  client_header                text,
  target_venue_id              uuid,
  target_venue_name            text,
  item_id                      uuid,
  service_id                   uuid,
  replica_id                   uuid,
  calendar_id                  uuid,
  revision                     bigint,
  changes                      jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_audit_events_actor_type_valid CHECK (actor_type IN ('venue_user', 'system', 'support')),
  CONSTRAINT collective_audit_events_system_job_when_system CHECK (actor_type <> 'system' OR system_job IS NOT NULL),
  CONSTRAINT collective_audit_events_event_type_valid CHECK (event_type IN (
    'offering_added', 'offering_withdrawn', 'offering_reoffered',
    'master_changed', 'master_change_undone', 'replica_applied', 'replica_failed',
    'unexplained_drift_repaired', 'calendar_assigned', 'calendar_unassigned', 'values_changed',
    'member_invited', 'invitation_withdrawn', 'invitation_expired', 'member_joined', 'member_left',
    'member_removed', 'member_suspended', 'member_resumed', 'member_released',
    'host_transfer_requested', 'host_transfer_cancelled', 'host_transferred',
    'collective_paused', 'collective_resumed', 'collective_dissolved',
    'adoption_requested', 'adoption_answered', 'suggestion_made',
    'address_adoption_requested', 'address_adopted',
    'migration_applied', 'migration_rolled_back',
    'photo_copied', 'photo_copy_failed', 'payment_rule_downgraded'))
);
CREATE INDEX IF NOT EXISTS collective_audit_events_collective
  ON public.collective_audit_events (collective_id, created_at DESC);
CREATE INDEX IF NOT EXISTS collective_audit_events_target_venue
  ON public.collective_audit_events (target_venue_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.collective_audit_deny_update_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'collective_audit_events is append-only: % not allowed', TG_OP;
END;
$$;
REVOKE ALL ON FUNCTION public.collective_audit_deny_update_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS collective_audit_append_only ON public.collective_audit_events;
CREATE TRIGGER collective_audit_append_only
  BEFORE UPDATE OR DELETE ON public.collective_audit_events
  FOR EACH ROW EXECUTE PROCEDURE public.collective_audit_deny_update_delete();

ALTER TABLE public.collective_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_audit_events FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 4. Idempotent, resumable lifecycle jobs.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.collective_operations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_id    uuid NOT NULL,
  venue_id         uuid,
  kind             text NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'pending',
  progress         jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts         integer NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  next_attempt_at  timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collective_operations_kind_valid
    CHECK (kind IN ('join', 'release_followup', 'host_transfer', 'migrate', 'notice')),
  CONSTRAINT collective_operations_status_valid CHECK (status IN ('pending', 'running', 'done', 'failed')),
  CONSTRAINT collective_operations_attempts_nonneg CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS collective_operations_due
  ON public.collective_operations (next_attempt_at, id) WHERE status IN ('pending', 'running');

DROP TRIGGER IF EXISTS collective_operations_updated_at ON public.collective_operations;
CREATE TRIGGER collective_operations_updated_at
  BEFORE UPDATE ON public.collective_operations
  FOR EACH ROW EXECUTE PROCEDURE public.account_links_set_updated_at();

ALTER TABLE public.collective_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.collective_operations FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 5. Changed collective tables.
-- ===========================================================================
ALTER TABLE public.venue_collectives
  ADD COLUMN IF NOT EXISTS service_model text NOT NULL DEFAULT 'legacy_copies',
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS pending_host_venue_id uuid REFERENCES public.venues (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS host_transfer_at timestamptz,
  ADD COLUMN IF NOT EXISTS dissolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_collectives_service_model_valid') THEN
    ALTER TABLE public.venue_collectives
      ADD CONSTRAINT venue_collectives_service_model_valid
        CHECK (service_model IN ('legacy_copies', 'migrating', 'replicas'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_collectives_paused_reason_valid') THEN
    ALTER TABLE public.venue_collectives
      ADD CONSTRAINT venue_collectives_paused_reason_valid
        CHECK (paused_reason IS NULL OR paused_reason IN ('host_left', 'host_lapsed'));
  END IF;
END $$;
-- Conflicts with its own ON DELETE SET NULL on adopted_venue_id (20261210120000:44-47): deleting an
-- adopted venue would null the column and then fail this CHECK.
ALTER TABLE public.venue_collectives DROP CONSTRAINT IF EXISTS venue_collectives_adopt_requires_venue;

ALTER TABLE public.venue_collective_members
  ADD COLUMN IF NOT EXISTS consent_version text,
  ADD COLUMN IF NOT EXISTS consented_at timestamptz,
  ADD COLUMN IF NOT EXISTS consented_by_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS list_on_old_page boolean NOT NULL DEFAULT true;

ALTER TABLE public.collective_service_items
  ADD COLUMN IF NOT EXISTS master_service_id uuid REFERENCES public.service_items (id) ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'service';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collective_service_items_entity_type_valid') THEN
    ALTER TABLE public.collective_service_items
      ADD CONSTRAINT collective_service_items_entity_type_valid CHECK (entity_type IN ('service'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS collective_service_items_master_active
  ON public.collective_service_items (collective_id, master_service_id)
  WHERE status = 'active' AND master_service_id IS NOT NULL;

-- ===========================================================================
-- 6. Child identity mappings: ON DELETE NO ACTION with engine-managed cleanup (RT2-4).
-- ===========================================================================
ALTER TABLE public.service_variants ADD COLUMN IF NOT EXISTS replica_of_variant_id uuid
  REFERENCES public.service_variants (id) ON DELETE NO ACTION;
ALTER TABLE public.addon_groups
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_addon_group_id uuid REFERENCES public.addon_groups (id) ON DELETE NO ACTION;
ALTER TABLE public.addons ADD COLUMN IF NOT EXISTS replica_of_addon_id uuid
  REFERENCES public.addons (id) ON DELETE NO ACTION;
ALTER TABLE public.service_categories
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_category_id uuid REFERENCES public.service_categories (id) ON DELETE NO ACTION;
ALTER TABLE public.compliance_types
  ADD COLUMN IF NOT EXISTS managed_by_collective_id uuid,
  ADD COLUMN IF NOT EXISTS replica_of_compliance_type_id uuid REFERENCES public.compliance_types (id) ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS accepts_records_from_type_id uuid REFERENCES public.compliance_types (id) ON DELETE SET NULL;
ALTER TABLE public.compliance_type_versions ADD COLUMN IF NOT EXISTS replica_of_version_id uuid
  REFERENCES public.compliance_type_versions (id) ON DELETE NO ACTION;
ALTER TABLE public.service_compliance_requirements ADD COLUMN IF NOT EXISTS replica_of_requirement_id uuid
  REFERENCES public.service_compliance_requirements (id) ON DELETE NO ACTION;

-- Every new column of a registry table is classified in the same migration (DB-07 fails otherwise).
-- All eleven are identity mappings (Appendix F): the engine maps them, it never copies them.
INSERT INTO public.collective_column_classes (table_name, column_name, class, note) VALUES
  ('service_variants', 'replica_of_variant_id', 'identity', 'the master option this replica option follows'),
  ('addon_groups', 'managed_by_collective_id', 'identity', 'set while the collective manages this group'),
  ('addon_groups', 'replica_of_addon_group_id', 'identity', 'the master group this managed group follows'),
  ('addons', 'replica_of_addon_id', 'identity', 'the master option this managed option follows'),
  ('service_categories', 'managed_by_collective_id', 'identity', 'set while the collective manages this heading'),
  ('service_categories', 'replica_of_category_id', 'identity', 'the master heading this heading follows'),
  ('compliance_types', 'managed_by_collective_id', 'identity', 'set while the collective manages this form'),
  ('compliance_types', 'replica_of_compliance_type_id', 'identity', 'the master form this form follows'),
  ('compliance_types', 'accepts_records_from_type_id', 'identity', 'records filed under this type count; kept at release'),
  ('compliance_type_versions', 'replica_of_version_id', 'identity', 'the master version this version follows'),
  ('service_compliance_requirements', 'replica_of_requirement_id', 'identity', 'the master requirement this follows')
ON CONFLICT (table_name, column_name) DO NOTHING;

CREATE INDEX IF NOT EXISTS service_variants_replica_of
  ON public.service_variants (replica_of_variant_id) WHERE replica_of_variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS addon_groups_managed_by_collective
  ON public.addon_groups (managed_by_collective_id) WHERE managed_by_collective_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS addon_groups_replica_of
  ON public.addon_groups (replica_of_addon_group_id) WHERE replica_of_addon_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS addons_replica_of
  ON public.addons (replica_of_addon_id) WHERE replica_of_addon_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_categories_managed_by_collective
  ON public.service_categories (managed_by_collective_id) WHERE managed_by_collective_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_categories_replica_of
  ON public.service_categories (replica_of_category_id) WHERE replica_of_category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_types_managed_by_collective
  ON public.compliance_types (managed_by_collective_id) WHERE managed_by_collective_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_types_replica_of
  ON public.compliance_types (replica_of_compliance_type_id) WHERE replica_of_compliance_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS compliance_type_versions_replica_of
  ON public.compliance_type_versions (replica_of_version_id) WHERE replica_of_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS service_compliance_requirements_replica_of
  ON public.service_compliance_requirements (replica_of_requirement_id) WHERE replica_of_requirement_id IS NOT NULL;

-- ===========================================================================
-- 7. Cross-venue booking audit authorised by a collective rather than a link (RT2-12): widen the
--    existing table instead of adding a sixth.
-- ===========================================================================
ALTER TABLE public.account_link_audit_log ALTER COLUMN link_id DROP NOT NULL;
ALTER TABLE public.account_link_audit_log ADD COLUMN IF NOT EXISTS collective_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_link_audit_log_one_authority') THEN
    ALTER TABLE public.account_link_audit_log
      ADD CONSTRAINT account_link_audit_log_one_authority CHECK (num_nonnulls(link_id, collective_id) >= 1);
  END IF;
END $$;

-- ===========================================================================
-- 8. A calendar may only offer its own venue's service (invariant I13 made a constraint).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.calendar_service_assignments_venue_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.unified_calendars c
    JOIN public.service_items s ON s.id = NEW.service_item_id
    WHERE c.id = NEW.calendar_id AND c.venue_id = s.venue_id
  ) THEN
    RAISE EXCEPTION 'A calendar can only offer a service from its own venue'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.calendar_service_assignments_venue_consistency() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_csa_venue_consistency ON public.calendar_service_assignments;
CREATE TRIGGER trg_csa_venue_consistency
  BEFORE INSERT OR UPDATE OF calendar_id, service_item_id ON public.calendar_service_assignments
  FOR EACH ROW EXECUTE FUNCTION public.calendar_service_assignments_venue_consistency();

-- ===========================================================================
-- 9. Only the engine may move hosting of a replicas-model collective (RN005). Gated on the model, so
--    today's reconcileCollective host transfer keeps working until W7 (plan §8.2 hazard 2).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.venue_collectives_host_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.host_venue_id IS DISTINCT FROM OLD.host_venue_id
     AND OLD.service_model = 'replicas'
     AND coalesce(current_setting('resneo.collective_engine', true), '') <> 'on' THEN
    RAISE EXCEPTION 'COLLECTIVE_HOST_CHANGE_REFUSED' USING ERRCODE = 'RN005';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.venue_collectives_host_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_venue_collectives_host_guard ON public.venue_collectives;
CREATE TRIGGER trg_venue_collectives_host_guard
  BEFORE UPDATE OF host_venue_id ON public.venue_collectives
  FOR EACH ROW EXECUTE FUNCTION public.venue_collectives_host_guard();
