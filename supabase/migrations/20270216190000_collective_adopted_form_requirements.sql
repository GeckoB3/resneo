-- Collective engine, part 9b: a member's own requirements on a form the collective takes over (D57,
-- owner 2026-09-16), and two report corrections.
--
-- STILL DARK.
--
-- When the collective takes over a member's form (the apply adopting it by template or name, or the
-- member choosing "use existing" at join), the member's services may already require that form. The
-- owner's decision (D57): those requirements stay and stay editable, so the member's own services
-- keep their protection; only new requirements on the managed form are refused (RT1-13).
--
--   * compliance_types.managed_since records when the collective took the form over. A trigger keeps
--     it: set when managed_by_collective_id is first set, cleared when it is cleared (release).
--   * collective_lock_row lets an UPDATE through on a service requirement that existed before
--     managed_since and keeps its form and service; an INSERT, or an UPDATE that moves a requirement
--     onto the managed form, is still RN004.
--   * collective_invariant_report: I15 ignores requirements older than managed_since; I6 ignores
--     bookings of a service with no price, which have nothing to snapshot; I44 accepts calendar values
--     written through the engine by a venue that hosted at the time (an audited write), so a host
--     transfer does not turn the old host's writes into violations.

ALTER TABLE public.compliance_types ADD COLUMN IF NOT EXISTS managed_since timestamptz;

INSERT INTO public.collective_column_classes (table_name, column_name, class, note) VALUES
  ('compliance_types', 'managed_since', 'identity', 'when the collective took this form over (D57)')
ON CONFLICT (table_name, column_name) DO NOTHING;

UPDATE public.compliance_types SET managed_since = coalesce(updated_at, now())
WHERE managed_by_collective_id IS NOT NULL AND managed_since IS NULL;

CREATE OR REPLACE FUNCTION public.compliance_types_managed_since()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.managed_by_collective_id IS NULL THEN
    NEW.managed_since := NULL;
  ELSIF TG_OP = 'INSERT' OR OLD.managed_by_collective_id IS DISTINCT FROM NEW.managed_by_collective_id THEN
    NEW.managed_since := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.compliance_types_managed_since() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_compliance_types_managed_since ON public.compliance_types;
CREATE TRIGGER trg_compliance_types_managed_since
  BEFORE INSERT OR UPDATE OF managed_by_collective_id ON public.compliance_types
  FOR EACH ROW EXECUTE FUNCTION public.compliance_types_managed_since();

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
    -- A requirement the member already had before the collective took the form over stays the
    -- member's to edit (D57); a new one, or one moved onto the managed form, is refused.
    IF NEW.scope = 'service' AND public.collective_managed_locked(v_type.managed_by_collective_id, v_type.venue_id)
       AND NOT (TG_OP = 'UPDATE'
                AND OLD.compliance_type_id = NEW.compliance_type_id
                AND OLD.service_item_id IS NOT DISTINCT FROM NEW.service_item_id
                AND v_type.managed_since IS NOT NULL
                AND OLD.created_at < v_type.managed_since) THEN
      RAISE EXCEPTION 'COLLECTIVE_MANAGED_COMPLIANCE_TYPE: this form belongs to the collective; it can only be required by the collective''s services'
        USING ERRCODE = 'RN004';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_invariant_report(
  p_since timestamptz DEFAULT NULL,
  p_collective_id uuid DEFAULT NULL
)
RETURNS TABLE (invariant text, violations bigint, sample_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  v_venues uuid[];
BEGIN
  IF p_collective_id IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT m.venue_id), ARRAY[]::uuid[]) INTO v_venues
    FROM public.venue_collective_members m WHERE m.collective_id = p_collective_id;
  END IF;

  -- I1 active offering with a missing master, or a master not at the host.
  RETURN QUERY SELECT 'I1'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT i.id FROM public.collective_service_items i
    JOIN public.venue_collectives c ON c.id = i.collective_id
    LEFT JOIN public.service_items s ON s.id = i.master_service_id
    WHERE c.status = 'active' AND c.service_model = 'replicas' AND i.status = 'active'
      AND (s.id IS NULL OR s.venue_id <> c.host_venue_id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I2 active offering x active member without a link, or without a replica after 15 minutes.
  RETURN QUERY SELECT 'I2'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT i.id FROM public.collective_service_items i
    JOIN public.venue_collectives c ON c.id = i.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
    JOIN public.venue_collective_members m ON m.collective_id = c.id AND m.status = 'active' AND m.venue_id <> c.host_venue_id
    LEFT JOIN public.collective_service_replicas r
      ON r.collective_service_item_id = i.id AND r.venue_id = m.venue_id AND r.released_at IS NULL
    WHERE i.status = 'active'
      AND (r.id IS NULL OR (r.replica_service_id IS NULL AND r.created_at < now() - interval '15 minutes'))
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I3 unexplained drift: a link marked current whose fingerprint differs from the expected one.
  RETURN QUERY SELECT 'I3'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r
    JOIN public.venue_collectives c ON c.id = r.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
    WHERE r.released_at IS NULL AND r.replica_service_id IS NOT NULL AND r.applied_revision = r.desired_revision
      AND public.collective_replica_fingerprint(r.id) IS DISTINCT FROM public.collective_expected_fingerprint(r.id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I3b ordinary lag over 15 minutes.
  RETURN QUERY SELECT 'I3b'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r
    WHERE r.released_at IS NULL AND r.applied_revision < r.desired_revision AND r.behind_since < now() - interval '15 minutes'
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)) x;

  -- I5 live link outside an active membership of an active replicas collective, or at the host.
  RETURN QUERY SELECT 'I5'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r
    JOIN public.venue_collectives c ON c.id = r.collective_id
    LEFT JOIN public.venue_collective_members m ON m.id = r.member_id
    WHERE r.released_at IS NULL
      AND (c.status <> 'active' OR c.service_model <> 'replicas' OR m.id IS NULL OR m.status <> 'active'
           OR m.venue_id <> r.venue_id OR r.venue_id = c.host_venue_id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I6 appointment booking without a price snapshot (cancelled ones only since p_since).
  RETURN QUERY SELECT 'I6'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT b.id FROM public.bookings b
    WHERE b.service_item_id IS NOT NULL AND b.service_price_snapshot_pence IS NULL
      AND (b.status::text <> 'Cancelled' OR b.created_at >= v_since)
      -- A service with no price has nothing to snapshot (four such bookings on staging, 2026-09-16).
      AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL
      AND (p_collective_id IS NULL OR b.venue_id = ANY (v_venues))) x;

  -- I7 venue with two live memberships or two live hostings.
  RETURN QUERY SELECT 'I7'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT m.venue_id AS id FROM public.venue_collective_members m
    JOIN public.venue_collectives c ON c.id = m.collective_id AND c.status = 'active'
    WHERE m.status = 'active' GROUP BY m.venue_id HAVING count(*) > 1
    UNION ALL
    SELECT c.host_venue_id FROM public.venue_collectives c WHERE c.status = 'active'
    GROUP BY c.host_venue_id HAVING count(*) > 1) x
  WHERE p_collective_id IS NULL OR x.id = ANY (v_venues);

  -- I8 live replica at the wrong venue, or also an active master.
  RETURN QUERY SELECT 'I8'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r JOIN public.service_items s ON s.id = r.replica_service_id
    WHERE r.released_at IS NULL
      AND (s.venue_id <> r.venue_id OR EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = s.id AND i.status = 'active'))
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)) x;

  -- I10 replica mappings not pointing at the current master's children: options, requirements,
  -- managed groups, managed forms.
  RETURN QUERY SELECT 'I10'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT rv.id FROM public.service_variants rv
    JOIN public.collective_service_replicas r ON r.replica_service_id = rv.service_item_id AND r.released_at IS NULL
    JOIN public.collective_service_items i ON i.id = r.collective_service_item_id
    LEFT JOIN public.service_variants mv ON mv.id = rv.replica_of_variant_id
    WHERE rv.replica_of_variant_id IS NOT NULL AND rv.is_active
      AND (mv.id IS NULL OR mv.service_item_id IS DISTINCT FROM i.master_service_id)
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)
    UNION ALL
    SELECT q.id FROM public.service_compliance_requirements q
    JOIN public.collective_service_replicas r ON r.replica_service_id = q.service_item_id AND r.released_at IS NULL
    JOIN public.collective_service_items i ON i.id = r.collective_service_item_id
    JOIN public.compliance_types t ON t.id = q.compliance_type_id
    WHERE (t.replica_of_compliance_type_id IS NULL OR t.managed_by_collective_id IS DISTINCT FROM r.collective_id
           OR NOT EXISTS (SELECT 1 FROM public.collective_master_requirements(i.master_service_id) mr WHERE mr.type_id = t.replica_of_compliance_type_id))
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)
    UNION ALL
    SELECT g.id FROM public.addon_groups g
    LEFT JOIN public.addon_groups mg ON mg.id = g.replica_of_addon_group_id
    JOIN public.venue_collectives c ON c.id = g.managed_by_collective_id
    WHERE g.managed_by_collective_id IS NOT NULL AND (mg.id IS NULL OR mg.venue_id <> c.host_venue_id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)
    UNION ALL
    SELECT t.id FROM public.compliance_types t
    LEFT JOIN public.compliance_types mt ON mt.id = t.replica_of_compliance_type_id
    JOIN public.venue_collectives c ON c.id = t.managed_by_collective_id
    WHERE t.managed_by_collective_id IS NOT NULL AND (mt.id IS NULL OR mt.venue_id <> c.host_venue_id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I11 future booking on an inactive replica option whose master option is active.
  RETURN QUERY SELECT 'I11'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT b.id FROM public.bookings b
    JOIN public.service_variants v ON v.id = b.service_variant_id AND NOT v.is_active
    JOIN public.service_variants mv ON mv.id = v.replica_of_variant_id AND mv.is_active
    WHERE b.booking_date >= current_date AND b.status::text IN ('Pending', 'Booked', 'Confirmed')
      AND (p_collective_id IS NULL OR b.venue_id = ANY (v_venues))) x;

  -- I12 two managed forms from one template at a venue, or a managed form not counting the
  -- member's own same-template form's records.
  RETURN QUERY SELECT 'I12'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT min(t.id::text)::uuid AS id FROM public.compliance_types t
    WHERE t.managed_by_collective_id IS NOT NULL AND t.archived_at IS NULL AND t.library_template_slug IS NOT NULL
      AND (p_collective_id IS NULL OR t.managed_by_collective_id = p_collective_id)
    GROUP BY t.venue_id, t.managed_by_collective_id, t.library_template_slug HAVING count(*) > 1
    UNION ALL
    SELECT mt.id FROM public.compliance_types mt
    JOIN public.compliance_types ot ON ot.venue_id = mt.venue_id AND ot.id <> mt.id
      AND ot.managed_by_collective_id IS NULL AND ot.library_template_slug = mt.library_template_slug
    WHERE mt.managed_by_collective_id IS NOT NULL AND mt.archived_at IS NULL
      AND mt.accepts_records_from_type_id IS DISTINCT FROM ot.id
      AND (p_collective_id IS NULL OR mt.managed_by_collective_id = p_collective_id)) x;

  -- I13 calendar offering another venue's service.
  RETURN QUERY SELECT 'I13'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT a.id FROM public.calendar_service_assignments a
    JOIN public.unified_calendars uc ON uc.id = a.calendar_id
    JOIN public.service_items s ON s.id = a.service_item_id
    WHERE uc.venue_id <> s.venue_id AND (p_collective_id IS NULL OR uc.venue_id = ANY (v_venues))) x;

  -- I14 cross-venue children: group links, requirements, options.
  RETURN QUERY SELECT 'I14'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT sag.id FROM public.service_addon_groups sag
    JOIN public.service_items s ON s.id = sag.service_item_id JOIN public.addon_groups g ON g.id = sag.addon_group_id
    WHERE s.venue_id <> g.venue_id AND (p_collective_id IS NULL OR s.venue_id = ANY (v_venues))
    UNION ALL
    SELECT q.id FROM public.service_compliance_requirements q JOIN public.compliance_types t ON t.id = q.compliance_type_id
    WHERE q.venue_id <> t.venue_id AND (p_collective_id IS NULL OR q.venue_id = ANY (v_venues))
    UNION ALL
    SELECT v.id FROM public.service_variants v JOIN public.service_items s ON s.id = v.service_item_id
    WHERE v.venue_id <> s.venue_id AND (p_collective_id IS NULL OR v.venue_id = ANY (v_venues))) x;

  -- I15 a member's own service using a managed add-on group or a managed form (see the header).
  RETURN QUERY SELECT 'I15'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT sag.id FROM public.service_addon_groups sag JOIN public.addon_groups g ON g.id = sag.addon_group_id
    WHERE g.managed_by_collective_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.collective_service_replicas r
                      WHERE r.replica_service_id = sag.service_item_id AND r.collective_id = g.managed_by_collective_id AND r.released_at IS NULL)
      AND (p_collective_id IS NULL OR g.managed_by_collective_id = p_collective_id)
    UNION ALL
    SELECT q.id FROM public.service_compliance_requirements q JOIN public.compliance_types t ON t.id = q.compliance_type_id
    WHERE t.managed_by_collective_id IS NOT NULL AND q.scope = 'service'
      AND (t.managed_since IS NULL OR q.created_at >= t.managed_since)  -- D57: older requirements stay
      AND NOT EXISTS (SELECT 1 FROM public.collective_service_replicas r
                      WHERE r.replica_service_id = q.service_item_id AND r.collective_id = t.managed_by_collective_id AND r.released_at IS NULL)
      AND (p_collective_id IS NULL OR t.managed_by_collective_id = p_collective_id)) x;

  -- I16 booking owned by a venue other than its calendar's or its service's (since p_since).
  RETURN QUERY SELECT 'I16'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT b.id FROM public.bookings b
    JOIN public.unified_calendars uc ON uc.id = b.calendar_id
    LEFT JOIN public.service_items s ON s.id = b.service_item_id
    WHERE b.created_at >= v_since AND (uc.venue_id <> b.venue_id OR s.venue_id <> b.venue_id)
      AND (p_collective_id IS NULL OR b.venue_id = ANY (v_venues))) x;

  -- I21 live replica with forms at a member whose forms are off (reported, not gated; the
  -- FEATURE_FLAG_COMPLIANCE_RECORDS_ENABLED environment override is the caller's to check).
  RETURN QUERY SELECT 'I21'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r JOIN public.venues v ON v.id = r.venue_id
    WHERE r.released_at IS NULL
      AND EXISTS (SELECT 1 FROM public.service_compliance_requirements q WHERE q.service_item_id = r.replica_service_id)
      AND coalesce((v.feature_flags->>'compliance_records_enabled')::boolean, false) = false
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)) x;

  -- I22 lifecycle job stuck for an hour.
  RETURN QUERY SELECT 'I22'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT o.id FROM public.collective_operations o
    WHERE o.status IN ('pending', 'running') AND coalesce(o.lease_until, o.updated_at) < now() - interval '1 hour'
      AND (p_collective_id IS NULL OR o.collective_id = p_collective_id)) x;

  -- I23 live replica still carrying legacy sync state.
  RETURN QUERY SELECT 'I23'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r JOIN public.service_items s ON s.id = r.replica_service_id
    WHERE r.released_at IS NULL AND (s.sync_state = 'linked' OR s.synced_from_service_id IS NOT NULL)
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)) x;

  -- I24 client privileges on the engine tables or their sequences.
  RETURN QUERY SELECT 'I24'::text, count(*)::bigint, NULL::uuid[] FROM (
    SELECT g.relation_name FROM public.audit_client_table_grants() g
    WHERE g.relation_name IN ('collective_service_replicas', 'collective_audit_events', 'collective_operations',
                              'collective_catalogue_revisions', 'collective_column_classes')
      AND (cardinality(g.table_privileges) > 0 OR cardinality(g.column_select_columns) > 0)
    UNION ALL
    SELECT c.relname::text FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) rl(role)
    WHERE n.nspname = 'public' AND c.relkind = 'S' AND c.relname LIKE 'collective\_%'
      AND pg_catalog.has_sequence_privilege(rl.role, c.oid, 'USAGE,SELECT,UPDATE')) x;

  -- I30 member left or removed since p_since with no release audit row.
  RETURN QUERY SELECT 'I30'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT m.id FROM public.venue_collective_members m
    JOIN public.venue_collectives c ON c.id = m.collective_id AND c.service_model = 'replicas'
    WHERE m.status IN ('left', 'removed') AND m.joined_at IS NOT NULL AND m.updated_at >= v_since
      AND m.venue_id <> c.host_venue_id
      AND NOT EXISTS (SELECT 1 FROM public.collective_audit_events e
                      WHERE e.collective_id = m.collective_id AND e.target_venue_id = m.venue_id AND e.event_type = 'member_released')
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I32 active replica option without a mapping on a current live link.
  RETURN QUERY SELECT 'I32'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT rv.id FROM public.service_variants rv
    JOIN public.collective_service_replicas r ON r.replica_service_id = rv.service_item_id
      AND r.released_at IS NULL AND r.applied_revision = r.desired_revision
    WHERE rv.is_active AND rv.replica_of_variant_id IS NULL
      AND (p_collective_id IS NULL OR r.collective_id = p_collective_id)) x;

  -- I33 live replica of an active offering with no calendar at its own venue offering it.
  RETURN QUERY SELECT 'I33'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT r.id FROM public.collective_service_replicas r
    JOIN public.collective_service_items i ON i.id = r.collective_service_item_id AND i.status = 'active'
    JOIN public.venue_collectives c ON c.id = r.collective_id AND c.status = 'active' AND c.service_model = 'replicas'
    WHERE r.released_at IS NULL AND r.replica_service_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.calendar_service_assignments a JOIN public.unified_calendars uc ON uc.id = a.calendar_id
                      WHERE a.service_item_id = r.replica_service_id AND uc.venue_id = r.venue_id)
      AND (p_collective_id IS NULL OR c.id = p_collective_id)) x;

  -- I34 service filed under another venue's heading.
  RETURN QUERY SELECT 'I34'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT s.id FROM public.service_items s JOIN public.service_categories h ON h.id = s.category_id
    WHERE s.venue_id <> h.venue_id AND (p_collective_id IS NULL OR s.venue_id = ANY (v_venues))) x;

  -- I35 add-on option at a different venue from its group.
  RETURN QUERY SELECT 'I35'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT a.id FROM public.addons a JOIN public.addon_groups g ON g.id = a.addon_group_id
    WHERE a.venue_id <> g.venue_id AND (p_collective_id IS NULL OR a.venue_id = ANY (v_venues))) x;

  -- I36 form version at a different venue from its form, or a form whose current version belongs to
  -- another form.
  RETURN QUERY SELECT 'I36'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT v.id FROM public.compliance_type_versions v JOIN public.compliance_types t ON t.id = v.compliance_type_id
    WHERE v.venue_id <> t.venue_id AND (p_collective_id IS NULL OR v.venue_id = ANY (v_venues))
    UNION ALL
    SELECT t.id FROM public.compliance_types t JOIN public.compliance_type_versions v ON v.id = t.current_version_id
    WHERE v.compliance_type_id <> t.id AND (p_collective_id IS NULL OR t.venue_id = ANY (v_venues))) x;

  -- I39 booking attributed to a collective its venue never joined (since p_since).
  RETURN QUERY SELECT 'I39'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT b.id FROM public.bookings b
    WHERE b.collective_id IS NOT NULL AND b.created_at >= v_since
      AND NOT EXISTS (SELECT 1 FROM public.venue_collective_members m
                      WHERE m.collective_id = b.collective_id AND m.venue_id = b.venue_id
                        AND (m.status = 'active' OR m.joined_at IS NOT NULL))
      AND (p_collective_id IS NULL OR b.collective_id = p_collective_id)) x;

  -- I40 booking whose guest belongs to a different venue (since p_since).
  RETURN QUERY SELECT 'I40'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT b.id FROM public.bookings b JOIN public.guests g ON g.id = b.guest_id
    WHERE g.venue_id <> b.venue_id AND b.created_at >= v_since
      AND (p_collective_id IS NULL OR b.venue_id = ANY (v_venues))) x;

  -- I43 venue live in one collective while invited to another.
  RETURN QUERY SELECT 'I43'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT inv.id FROM public.venue_collective_members inv
    JOIN public.venue_collective_members live ON live.venue_id = inv.venue_id AND live.status = 'active'
      AND live.collective_id <> inv.collective_id
    JOIN public.venue_collectives lc ON lc.id = live.collective_id AND lc.status = 'active'
    WHERE inv.status = 'invited'
      AND (p_collective_id IS NULL OR inv.collective_id = p_collective_id OR live.collective_id = p_collective_id)) x;

  -- I44 calendar values last written by a venue that is neither the calendar's nor a host of a
  -- collective the calendar's venue belongs to.
  RETURN QUERY SELECT 'I44'::text, count(*)::bigint, (array_agg(x.id ORDER BY x.id))[1:20] FROM (
    SELECT a.id FROM public.calendar_service_assignments a JOIN public.unified_calendars uc ON uc.id = a.calendar_id
    WHERE a.updated_by_venue_id IS NOT NULL AND a.updated_by_venue_id <> uc.venue_id
      AND NOT EXISTS (SELECT 1 FROM public.venue_collective_members m JOIN public.venue_collectives c ON c.id = m.collective_id
                      WHERE m.venue_id = uc.venue_id AND c.host_venue_id = a.updated_by_venue_id)
      -- A host that has since handed over hosting wrote through the engine, which audited it.
      AND NOT EXISTS (SELECT 1 FROM public.collective_audit_events e
                      WHERE e.actor_venue_id = a.updated_by_venue_id AND e.target_venue_id = uc.venue_id
                        AND e.event_type IN ('calendar_assigned', 'values_changed'))
      AND (p_collective_id IS NULL OR uc.venue_id = ANY (v_venues))) x;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_lock_row() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_invariant_report(timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_invariant_report(timestamptz, uuid) TO service_role;
