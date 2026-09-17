-- Collective engine, part 4: the locks (Docs/collective-one-venue-plan.md §6.5, Appendix C.4 and D;
-- RT1-5, RT1-13).
--
-- STILL DARK: every lock is gated on a replicas-model collective, and none exists. On today's
-- legacy_copies collectives, and for every venue outside a collective, nothing here refuses anything.
--
-- While a member is in an active replicas-model collective, only the engine (the flag set by
-- collective_engine_enter) may change what the collective manages at that member:
--   RN001 COLLECTIVE_MANAGED_SERVICE        a replica service, its options and its managed heading;
--                                           re-pointing a calendar assignment to or from a replica
--   RN002 COLLECTIVE_OFFERED_SERVICE        deleting a master that has an active offering
--   RN003 COLLECTIVE_MANAGED_ADDON_GROUP    managed add-on groups, their options, a replica's links
--   RN004 COLLECTIVE_MANAGED_COMPLIANCE_TYPE managed forms, their versions, a replica's requirements
--
-- What stays open without the flag:
--   * a change confined to the member's own columns: the registry's venue and not_copied classes
--     (capacity_per_session, pre_appointment_instructions, a heading's sort_order, an option's
--     cost_to_business_pence, and so on); sort_order is open only where the registry says venue,
--     because add-on options are matched by position and a replica's option order is the host's;
--   * a replica's category_id becoming NULL, the one FK cascade (the next apply restores it);
--   * inserting and deleting calendar assignments, which are the member's choice (§6.7).
--
-- RT1-13: a member's own service may not link a managed add-on group (RN003) or require a managed
-- form (RN004). A member's venue-wide requirement for a managed form stays allowed: D10 lets member
-- venue-wide forms apply on top. The link tables also get the venue-consistency check that
-- invariants I13 and I15 only reported on (23514): the group or form, and the service, belong to the
-- row's venue. Staging had no inconsistent rows on 2026-09-15; the check applies to new writes only.
--
-- Deleting a member venue outright will meet RN001 once replicas exist; the release built next is
-- what admin_hard_delete_venue calls first (Appendix C, T22).

-- ===========================================================================
-- Predicates
-- ===========================================================================
-- A service is a locked replica: its link is not released, the membership is active (a suspended
-- member stays locked), and the collective is active (a paused one stays locked) on the replicas model.
CREATE OR REPLACE FUNCTION public.collective_replica_service_locked(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_service_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.collective_service_replicas l
    JOIN public.venue_collective_members m ON m.id = l.member_id
    JOIN public.venue_collectives c ON c.id = l.collective_id
    WHERE l.replica_service_id = p_service_id
      AND l.released_at IS NULL
      AND m.status = 'active'
      AND c.status = 'active'
      AND c.service_model = 'replicas'
  );
$$;

-- An object managed by a collective at a venue is locked while that venue's membership is live.
CREATE OR REPLACE FUNCTION public.collective_managed_locked(p_collective_id uuid, p_venue_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_collective_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.venue_collective_members m
    JOIN public.venue_collectives c ON c.id = m.collective_id
    WHERE m.collective_id = p_collective_id
      AND m.venue_id = p_venue_id
      AND m.status = 'active'
      AND c.status = 'active'
      AND c.service_model = 'replicas'
  );
$$;

-- Is this row (as jsonb) a locked replica, a locked replica's child, or a locked managed object?
CREATE OR REPLACE FUNCTION public.collective_row_locked(p_table text, p_row jsonb)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_group public.addon_groups%ROWTYPE;
  v_type public.compliance_types%ROWTYPE;
BEGIN
  IF p_row IS NULL THEN
    RETURN false;
  END IF;
  CASE p_table
    WHEN 'service_items' THEN
      RETURN public.collective_replica_service_locked((p_row->>'id')::uuid);
    WHEN 'service_variants', 'service_addon_groups', 'service_compliance_requirements' THEN
      RETURN public.collective_replica_service_locked((p_row->>'service_item_id')::uuid);
    WHEN 'service_categories', 'addon_groups', 'compliance_types' THEN
      RETURN public.collective_managed_locked((p_row->>'managed_by_collective_id')::uuid, (p_row->>'venue_id')::uuid);
    WHEN 'addons' THEN
      SELECT * INTO v_group FROM public.addon_groups WHERE id = (p_row->>'addon_group_id')::uuid;
      RETURN FOUND AND public.collective_managed_locked(v_group.managed_by_collective_id, v_group.venue_id);
    WHEN 'compliance_type_versions' THEN
      SELECT * INTO v_type FROM public.compliance_types WHERE id = (p_row->>'compliance_type_id')::uuid;
      RETURN FOUND AND public.collective_managed_locked(v_type.managed_by_collective_id, v_type.venue_id);
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- Is an update confined to the member's own columns? Every changed column must be classed venue or
-- not_copied in the registry; an unclassified column is refused, so a new column is locked by default.
CREATE OR REPLACE FUNCTION public.collective_diff_is_venue_only(p_table text, p_old jsonb, p_new jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM jsonb_each(p_new) n
    WHERE n.value IS DISTINCT FROM (p_old -> n.key)
      AND NOT EXISTS (
        SELECT 1 FROM public.collective_column_classes k
        WHERE k.table_name = p_table AND k.column_name = n.key AND k.class IN ('venue', 'not_copied')
      )
  );
$$;

-- RN002 looks offerings up by master on every service delete.
CREATE INDEX IF NOT EXISTS collective_service_items_master_service
  ON public.collective_service_items (master_service_id)
  WHERE status = 'active' AND master_service_id IS NOT NULL;

-- ===========================================================================
-- The lock trigger, shared by the nine registry tables.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_lock_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_compare jsonb;
  v_state text;
  v_code text;
  v_group public.addon_groups%ROWTYPE;
  v_type public.compliance_types%ROWTYPE;
  v_service_venue uuid;
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  v_state := CASE
    WHEN TG_TABLE_NAME IN ('service_items', 'service_variants', 'service_categories') THEN 'RN001'
    WHEN TG_TABLE_NAME IN ('addon_groups', 'addons', 'service_addon_groups') THEN 'RN003'
    ELSE 'RN004' END;
  v_code := CASE v_state
    WHEN 'RN001' THEN 'COLLECTIVE_MANAGED_SERVICE'
    WHEN 'RN003' THEN 'COLLECTIVE_MANAGED_ADDON_GROUP'
    ELSE 'COLLECTIVE_MANAGED_COMPLIANCE_TYPE' END;

  -- RT1-5: the master of an active offering cannot be deleted outside the engine.
  IF TG_TABLE_NAME = 'service_items' AND TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.collective_service_items i
    JOIN public.venue_collectives c ON c.id = i.collective_id
    WHERE i.master_service_id = OLD.id AND i.status = 'active'
      AND c.status = 'active' AND c.service_model IN ('migrating', 'replicas')
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERED_SERVICE: this service is offered on a collective page; withdraw it first'
      USING ERRCODE = 'RN002';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF public.collective_row_locked(TG_TABLE_NAME, v_old) OR public.collective_row_locked(TG_TABLE_NAME, v_new) THEN
      v_compare := v_new;
      -- The one FK cascade: a heading deleted under a replica sets category_id to NULL.
      IF TG_TABLE_NAME = 'service_items' AND v_new->'category_id' = 'null'::jsonb THEN
        v_compare := v_compare || jsonb_build_object('category_id', v_old->'category_id');
      END IF;
      IF NOT public.collective_diff_is_venue_only(TG_TABLE_NAME, v_old, v_compare) THEN
        RAISE EXCEPTION '%: the collective manages this; only its host can change it', v_code
          USING ERRCODE = v_state;
      END IF;
    END IF;
  ELSIF public.collective_row_locked(TG_TABLE_NAME, coalesce(v_new, v_old)) THEN
    RAISE EXCEPTION '%: the collective manages this; only its host can change it', v_code
      USING ERRCODE = v_state;
  END IF;

  -- RT1-13 and the venue-consistency check, on the two link tables.
  IF TG_OP <> 'DELETE' AND TG_TABLE_NAME = 'service_addon_groups' THEN
    SELECT * INTO v_group FROM public.addon_groups WHERE id = NEW.addon_group_id;
    IF NEW.service_item_id IS NOT NULL THEN
      SELECT venue_id INTO v_service_venue FROM public.service_items WHERE id = NEW.service_item_id;
    END IF;
    IF v_group.venue_id IS DISTINCT FROM NEW.venue_id
       OR (NEW.service_item_id IS NOT NULL AND v_service_venue IS DISTINCT FROM NEW.venue_id) THEN
      RAISE EXCEPTION 'an add-on group can only be linked to a service at its own venue' USING ERRCODE = '23514';
    END IF;
    IF public.collective_managed_locked(v_group.managed_by_collective_id, v_group.venue_id) THEN
      RAISE EXCEPTION 'COLLECTIVE_MANAGED_ADDON_GROUP: this add-on group belongs to the collective; it can only be on the collective''s services'
        USING ERRCODE = 'RN003';
    END IF;
  ELSIF TG_OP <> 'DELETE' AND TG_TABLE_NAME = 'service_compliance_requirements' THEN
    SELECT * INTO v_type FROM public.compliance_types WHERE id = NEW.compliance_type_id;
    IF NEW.service_item_id IS NOT NULL THEN
      SELECT venue_id INTO v_service_venue FROM public.service_items WHERE id = NEW.service_item_id;
    END IF;
    IF v_type.venue_id IS DISTINCT FROM NEW.venue_id
       OR (NEW.service_item_id IS NOT NULL AND v_service_venue IS DISTINCT FROM NEW.venue_id) THEN
      RAISE EXCEPTION 'a form can only be required by a service at its own venue' USING ERRCODE = '23514';
    END IF;
    IF NEW.scope = 'service' AND public.collective_managed_locked(v_type.managed_by_collective_id, v_type.venue_id) THEN
      RAISE EXCEPTION 'COLLECTIVE_MANAGED_COMPLIANCE_TYPE: this form belongs to the collective; it can only be required by the collective''s services'
        USING ERRCODE = 'RN004';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_items', 'service_variants', 'service_categories', 'addon_groups', 'addons',
                           'service_addon_groups', 'compliance_types', 'compliance_type_versions',
                           'service_compliance_requirements']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_collective_lock_' || t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.collective_lock_row()', 'trg_collective_lock_' || t, t);
  END LOOP;
END $$;

-- ===========================================================================
-- calendar_service_assignments: only service_item_id is guarded; a row cannot be re-pointed to or
-- from a locked replica. Inserting and deleting a venue's own rows stays open (§6.7, R10).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_lock_csa_service()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.service_item_id IS DISTINCT FROM OLD.service_item_id
     AND (public.collective_replica_service_locked(OLD.service_item_id)
          OR public.collective_replica_service_locked(NEW.service_item_id)) THEN
    RAISE EXCEPTION 'COLLECTIVE_MANAGED_SERVICE: a calendar''s collective service cannot be swapped for another'
      USING ERRCODE = 'RN001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_collective_lock_calendar_service_assignments ON public.calendar_service_assignments;
CREATE TRIGGER trg_collective_lock_calendar_service_assignments
  BEFORE UPDATE OF service_item_id ON public.calendar_service_assignments
  FOR EACH ROW EXECUTE FUNCTION public.collective_lock_csa_service();

-- ===========================================================================
-- Grants: service role only (triggers need none).
-- ===========================================================================
REVOKE ALL ON FUNCTION public.collective_replica_service_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_managed_locked(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_row_locked(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_diff_is_venue_only(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_lock_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_lock_csa_service() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_replica_service_locked(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_managed_locked(uuid, uuid) TO service_role;
