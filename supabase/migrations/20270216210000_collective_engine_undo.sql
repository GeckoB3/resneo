-- Collective engine, part 11: undo a host's change (Docs/collective-one-venue-plan.md §6.4 "Undo", D50,
-- Appendix D `collective_undo_master_change`).
--
-- STILL DARK: undo reads a master_changed audit row, which only the host's replicas-model service
-- save writes, and nothing writes one yet.
--
-- collective_undo_master_change(audit event, actor venue, actor user, now), under the shared lock:
--   * the row must be master_changed, for a collective the actor hosts, written within the last 60
--     seconds (else COLLECTIVE_UNDO_EXPIRED, which the route answers as 410), and not already undone;
--   * it restores changes.before, which is the master-side projection the save captured:
--       - the service's host columns (the D29 flags stay false, as the projection holds them);
--       - options by id: each one in the snapshot gets its host columns and active state back; an
--         option added by the change is switched off, never deleted, because bookings may use it;
--       - which add-on groups the service links, and their order (groups that no longer exist are
--         skipped and reported);
--       - its form requirements: each form in the snapshot gets its terms back on the service's own
--         row (or a row is added when the form is not required at all now); a service row for a form
--         the snapshot did not require is removed;
--   * every live link of the offering is made due (the engine flag silences the dirty triggers),
--     master_change_undone is audited with the projection before and after and the undone event's
--     id, and the revision bumped.

CREATE OR REPLACE FUNCTION public.collective_undo_master_change_core(
  p_audit_event_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_event public.collective_audit_events%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_item public.collective_service_items%ROWTYPE;
  v_master uuid;
  v_before jsonb;
  v_any_link uuid;
  v_current jsonb;
  v_restored jsonb;
  v_cols text[];
  v_list text;
  v_obj jsonb;
  v_n integer;
  v_variants integer := 0;
  v_addon_links integer := 0;
  v_requirements integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_keys uuid[];
  v_bumped integer;
BEGIN
  SELECT * INTO v_event FROM public.collective_audit_events WHERE id = p_audit_event_id;
  IF NOT FOUND OR v_event.event_type <> 'master_changed' OR v_event.changes->'before' IS NULL THEN
    RAISE EXCEPTION 'collective_undo_master_change: not an undoable change';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || v_event.collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_event.collective_id;
  IF v_collective.status <> 'active' OR v_collective.service_model <> 'replicas'
     OR p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may undo a change';
  END IF;
  IF v_event.created_at < p_now - interval '60 seconds' THEN
    RAISE EXCEPTION 'COLLECTIVE_UNDO_EXPIRED: the change was made more than a minute ago';
  END IF;
  IF EXISTS (SELECT 1 FROM public.collective_audit_events e
             WHERE e.collective_id = v_event.collective_id AND e.event_type = 'master_change_undone'
               AND e.changes->>'undoes' = p_audit_event_id::text) THEN
    RAISE EXCEPTION 'collective_undo_master_change: that change was already undone';
  END IF;

  SELECT * INTO v_item FROM public.collective_service_items WHERE id = v_event.item_id AND collective_id = v_collective.id;
  v_master := coalesce(v_event.service_id, v_item.master_service_id);
  IF v_item.id IS NULL OR v_item.status <> 'active' OR v_item.master_service_id IS DISTINCT FROM v_master
     OR NOT EXISTS (SELECT 1 FROM public.service_items WHERE id = v_master AND venue_id = v_collective.host_venue_id) THEN
    RAISE EXCEPTION 'collective_undo_master_change: the service is no longer offered by this host';
  END IF;
  v_before := v_event.changes->'before';

  SELECT id INTO v_any_link FROM public.collective_service_replicas
  WHERE collective_service_item_id = v_item.id AND released_at IS NULL ORDER BY id LIMIT 1;
  IF v_any_link IS NOT NULL THEN
    v_current := public.collective_replica_projection(v_any_link, 'master');
  END IF;

  -- The service's host columns.
  IF v_before->'service' IS NOT NULL THEN
    SELECT array_agg(k ORDER BY k) INTO v_cols
    FROM jsonb_object_keys(v_before->'service') k
    WHERE k IN (SELECT unnest(public.collective_registry_columns('service_items', ARRAY['host']))) OR k = 'is_active';
    IF cardinality(v_cols) > 0 THEN
      SELECT string_agg(quote_ident(c), ', ') INTO v_list FROM unnest(v_cols) c;
      EXECUTE format(
        'UPDATE public.service_items s SET (%1$s) = (SELECT %1$s FROM jsonb_populate_record(NULL::public.service_items, $1)) WHERE s.id = $2',
        v_list)
        USING v_before->'service', v_master;
    END IF;
  END IF;

  -- Options by id; ones the change added are switched off.
  SELECT string_agg(quote_ident(c), ', ') INTO v_list
  FROM unnest(public.collective_registry_columns('service_variants', ARRAY['host']) || ARRAY['is_active']) c;
  FOR v_obj IN SELECT o FROM jsonb_array_elements(coalesce(v_before->'variants', '[]'::jsonb)) o LOOP
    EXECUTE format(
      'UPDATE public.service_variants v SET (%1$s) = (SELECT %1$s FROM jsonb_populate_record(NULL::public.service_variants, $1))
       WHERE v.id = $2 AND v.service_item_id = $3', v_list)
      USING v_obj - 'key', (v_obj->>'key')::uuid, v_master;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      v_skipped := v_skipped || jsonb_build_object('variant', v_obj->>'key');
    END IF;
    v_variants := v_variants + v_n;
  END LOOP;
  SELECT coalesce(array_agg((o->>'key')::uuid), ARRAY[]::uuid[]) INTO v_keys
  FROM jsonb_array_elements(coalesce(v_before->'variants', '[]'::jsonb)) o;
  UPDATE public.service_variants SET is_active = false
  WHERE service_item_id = v_master AND is_active AND NOT (id = ANY (v_keys));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_variants := v_variants + v_n;

  -- Add-on links and their order.
  SELECT coalesce(array_agg((g->>'key')::uuid), ARRAY[]::uuid[]) INTO v_keys
  FROM jsonb_array_elements(coalesce(v_before->'addon_groups', '[]'::jsonb)) g;
  DELETE FROM public.service_addon_groups WHERE service_item_id = v_master AND NOT (addon_group_id = ANY (v_keys));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_addon_links := v_addon_links + v_n;
  FOR v_obj IN SELECT g FROM jsonb_array_elements(coalesce(v_before->'addon_groups', '[]'::jsonb)) g LOOP
    IF NOT EXISTS (SELECT 1 FROM public.addon_groups WHERE id = (v_obj->>'key')::uuid AND venue_id = v_collective.host_venue_id) THEN
      v_skipped := v_skipped || jsonb_build_object('addon_group', v_obj->>'key');
      CONTINUE;
    END IF;
    INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id, sort_order)
    VALUES (v_collective.host_venue_id, v_master, (v_obj->>'key')::uuid, coalesce((v_obj->>'link_sort_order')::integer, 0))
    ON CONFLICT (service_item_id, addon_group_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
    WHERE public.service_addon_groups.sort_order IS DISTINCT FROM EXCLUDED.sort_order;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_addon_links := v_addon_links + v_n;
  END LOOP;

  -- Form requirements on the service's own rows.
  SELECT coalesce(array_agg((q->>'key')::uuid), ARRAY[]::uuid[]) INTO v_keys
  FROM jsonb_array_elements(coalesce(v_before->'requirements', '[]'::jsonb)) q;
  DELETE FROM public.service_compliance_requirements
  WHERE service_item_id = v_master AND scope = 'service' AND NOT (compliance_type_id = ANY (v_keys));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_requirements := v_requirements + v_n;
  FOR v_obj IN SELECT q FROM jsonb_array_elements(coalesce(v_before->'requirements', '[]'::jsonb)) q LOOP
    IF NOT EXISTS (SELECT 1 FROM public.compliance_types WHERE id = (v_obj->>'key')::uuid AND venue_id = v_collective.host_venue_id) THEN
      v_skipped := v_skipped || jsonb_build_object('form', v_obj->>'key');
      CONTINUE;
    END IF;
    UPDATE public.service_compliance_requirements
    SET enforcement = v_obj->>'enforcement', lock_period_hours = (v_obj->>'lock_period_hours')::integer,
        online_collection = v_obj->>'online_collection'
    WHERE service_item_id = v_master AND compliance_type_id = (v_obj->>'key')::uuid
      AND ROW(enforcement, lock_period_hours, online_collection)
          IS DISTINCT FROM ROW(v_obj->>'enforcement', (v_obj->>'lock_period_hours')::integer, v_obj->>'online_collection');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_requirements := v_requirements + v_n;
    IF NOT EXISTS (SELECT 1 FROM public.collective_master_requirements(v_master) m WHERE m.type_id = (v_obj->>'key')::uuid) THEN
      INSERT INTO public.service_compliance_requirements (venue_id, service_item_id, compliance_type_id, scope, enforcement,
        lock_period_hours, online_collection)
      VALUES (v_collective.host_venue_id, v_master, (v_obj->>'key')::uuid, 'service', v_obj->>'enforcement',
        (v_obj->>'lock_period_hours')::integer, v_obj->>'online_collection');
      v_requirements := v_requirements + 1;
    END IF;
  END LOOP;

  UPDATE public.collective_service_replicas
  SET desired_revision = desired_revision + 1, behind_since = coalesce(behind_since, p_now)
  WHERE collective_service_item_id = v_item.id AND released_at IS NULL;
  GET DIAGNOSTICS v_bumped = ROW_COUNT;

  IF v_any_link IS NOT NULL THEN
    v_restored := public.collective_replica_projection(v_any_link, 'master');
  END IF;
  PERFORM public.collective_write_audit(
    v_collective.id, 'master_change_undone', p_actor_venue_id, p_actor_user_id, NULL, v_collective.host_venue_id,
    v_item.id, v_master, NULL, NULL,
    jsonb_build_object('undoes', p_audit_event_id, 'before', v_current, 'after', v_restored, 'skipped', v_skipped),
    NULL, p_now);
  PERFORM public.collective_bump_revision(v_collective.id, p_now);

  RETURN jsonb_build_object(
    'restored', jsonb_build_object('service', v_before->'service' IS NOT NULL, 'variants', v_variants,
                                   'addon_links', v_addon_links, 'requirements', v_requirements),
    'skipped', v_skipped,
    'links_bumped', v_bumped);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_undo_master_change(
  p_audit_event_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev text := public.collective_engine_enter();
  v_result jsonb;
BEGIN
  v_result := public.collective_undo_master_change_core(p_audit_event_id, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_undo_master_change_core(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_undo_master_change(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_undo_master_change(uuid, uuid, uuid, timestamptz) TO service_role;
