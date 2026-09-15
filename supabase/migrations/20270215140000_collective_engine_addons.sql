-- Collective engine, part 2: add-on groups (Docs/collective-one-venue-plan.md §6.4 item 4, Appendix D).
--
-- STILL DARK: acts only on a replicas-model collective, and none exists.
--
-- The apply now also writes, for each add-on group linked to the master service, one managed group
-- at the member (per member, collective and master group), its options updated in place by position
-- (a host that re-saves its options causes no id churn at the member), and links the member's service
-- to exactly those managed groups. The projection gains the same `addon_groups` section, so the
-- fingerprints still agree. Deleting a master group or option releases the member pointers first,
-- and new statement-level dirty triggers bump the links when a master's groups, options or links
-- change. A member's own groups are never touched, except that its replica service links only to
-- managed groups.
--
-- The projection and apply body are replaced whole (CREATE OR REPLACE); the entry-point wrapper and
-- its grants from 20270215130000 are unchanged.

CREATE OR REPLACE FUNCTION public.collective_replica_projection(p_link_id uuid, p_side text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_link public.collective_service_replicas%ROWTYPE;
  v_master uuid;
  v_offering_active boolean;
  v_service_id uuid;
  v_host_cols text[];
  v_variant_cols text[];
  v_pairs text;
  v_service jsonb;
  v_heading jsonb;
  v_variants jsonb;
  v_active boolean;
  v_groups jsonb;
BEGIN
  SELECT * INTO v_link FROM public.collective_service_replicas WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT i.master_service_id, i.status = 'active' INTO v_master, v_offering_active
  FROM public.collective_service_items i WHERE i.id = v_link.collective_service_item_id;

  v_service_id := CASE WHEN p_side = 'master' THEN v_master ELSE v_link.replica_service_id END;
  IF v_service_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_host_cols := public.collective_registry_columns('service_items', ARRAY['host']);
  SELECT string_agg(
           format('%L, %s', col,
             CASE WHEN p_side = 'master' AND col IN ('staff_may_customize_name', 'staff_may_customize_description')
                  THEN 'false' ELSE 's.' || quote_ident(col) END),
           ', ')
    INTO v_pairs FROM unnest(v_host_cols) AS col;
  EXECUTE format('SELECT jsonb_build_object(%s), s.is_active FROM public.service_items s WHERE s.id = $1', v_pairs)
    INTO v_service, v_active USING v_service_id;
  IF v_service IS NULL THEN
    RETURN NULL;
  END IF;
  v_service := v_service || jsonb_build_object(
    'is_active', CASE WHEN p_side = 'master' THEN coalesce(v_active, false) AND coalesce(v_offering_active, false)
                      ELSE coalesce(v_active, false) END);

  SELECT jsonb_build_object('name', c.name) INTO v_heading
  FROM public.service_items s JOIN public.service_categories c ON c.id = s.category_id
  WHERE s.id = v_service_id;

  v_variant_cols := public.collective_registry_columns('service_variants', ARRAY['host']);
  SELECT string_agg(format('%L, v.%s', col, quote_ident(col)), ', ') INTO v_pairs FROM unnest(v_variant_cols) AS col;
  IF p_side = 'master' THEN
    EXECUTE format(
      'SELECT jsonb_agg(jsonb_build_object(''key'', v.id, ''is_active'', v.is_active, %s) ORDER BY v.id::text)
       FROM public.service_variants v WHERE v.service_item_id = $1', v_pairs)
      INTO v_variants USING v_service_id;
  ELSE
    EXECUTE format(
      'SELECT jsonb_agg(jsonb_build_object(''key'', v.replica_of_variant_id, ''is_active'', v.is_active, %s)
                        ORDER BY v.replica_of_variant_id::text)
       FROM public.service_variants v WHERE v.service_item_id = $1 AND v.replica_of_variant_id IS NOT NULL', v_pairs)
      INTO v_variants USING v_service_id;
  END IF;

  -- Add-on groups linked to the service, keyed by the master group; options by position among the
  -- group's options that are not archived, ordered (sort_order, name, id).
  SELECT jsonb_agg(
           jsonb_build_object(
             'key', CASE WHEN p_side = 'master' THEN g.id ELSE g.replica_of_addon_group_id END,
             'link_sort_order', sag.sort_order,
             'group', jsonb_build_object(
               'name', g.name, 'prompt_to_client', g.prompt_to_client, 'description', g.description,
               'selection_type', g.selection_type, 'min_select', g.min_select, 'max_select', g.max_select,
               'hidden_from_online', g.hidden_from_online, 'is_active', g.is_active),
             'options', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'position', o.position, 'name', o.name, 'description', o.description,
                        'additional_price_pence', o.additional_price_pence,
                        'additional_duration_minutes', o.additional_duration_minutes,
                        'is_active', o.is_active) ORDER BY o.position)
               FROM (
                 SELECT a.*, row_number() OVER (ORDER BY a.sort_order, a.name, a.id) AS position
                 FROM public.addons a WHERE a.addon_group_id = g.id AND a.archived_at IS NULL
               ) o), '[]'::jsonb))
           ORDER BY (CASE WHEN p_side = 'master' THEN g.id ELSE g.replica_of_addon_group_id END)::text)
    INTO v_groups
  FROM public.service_addon_groups sag
  JOIN public.addon_groups g ON g.id = sag.addon_group_id
  WHERE sag.service_item_id = v_service_id
    AND (p_side = 'master' OR (g.replica_of_addon_group_id IS NOT NULL AND g.managed_by_collective_id = v_link.collective_id));

  RETURN jsonb_build_object(
    'service', v_service,
    'heading', v_heading,
    'variants', coalesce(v_variants, '[]'::jsonb),
    'addon_groups', coalesce(v_groups, '[]'::jsonb)
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.collective_apply_replica_core(
  p_link_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_job text DEFAULT NULL,
  p_now timestamptz DEFAULT now(),
  p_support_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_link public.collective_service_replicas%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_member public.venue_collective_members%ROWTYPE;
  v_item public.collective_service_items%ROWTYPE;
  v_master public.service_items%ROWTYPE;
  v_target bigint;
  v_replica uuid;
  v_active boolean;
  v_host_cols text[];
  v_venue_cols text[];
  v_variant_cols text[];
  v_cols text;
  v_src text;
  v_dst text;
  v_n integer;
  v_writes jsonb := jsonb_build_object('service_items', 0, 'service_categories', 0, 'service_variants', 0,
                                       'addon_groups', 0, 'addons', 0, 'service_addon_groups', 0);
  v_mg record;
  v_group uuid;
  v_group_ids uuid[] := ARRAY[]::uuid[];
  v_mo record;
  v_ro uuid;
  v_member_opts uuid[];
  v_heading uuid;
  v_master_heading public.service_categories%ROWTYPE;
  v_mv record;
  v_rv uuid;
  v_backoff integer;
  v_code text;
  v_total integer;
  v_fingerprint text;
BEGIN
  SELECT * INTO v_link FROM public.collective_service_replicas WHERE id = p_link_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'link_id', p_link_id, 'error_code', 'master_missing', 'error', 'link not found');
  END IF;

  -- (1) the collective lock, then (2) the link row.
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || v_link.collective_id::text, 0));
  SELECT * INTO v_link FROM public.collective_service_replicas WHERE id = p_link_id FOR UPDATE;

  -- (3) re-check under the lock.
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_link.collective_id;
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = v_link.member_id;
  IF v_link.released_at IS NOT NULL OR v_member.status IS DISTINCT FROM 'active' OR v_member.suspended_at IS NOT NULL
     OR v_collective.status IS DISTINCT FROM 'active' OR v_collective.service_model NOT IN ('migrating', 'replicas') THEN
    RETURN jsonb_build_object('ok', false, 'link_id', p_link_id, 'error_code', 'membership_inactive',
      'error', 'the membership or collective is not live');
  END IF;

  -- (4) the revision this apply converges to.
  v_target := v_link.desired_revision;

  -- (5) the master and the offering, without row locks (§6.4 item 4).
  SELECT * INTO v_item FROM public.collective_service_items WHERE id = v_link.collective_service_item_id;
  SELECT * INTO v_master FROM public.service_items WHERE id = v_item.master_service_id;
  IF v_master.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'link_id', p_link_id, 'error_code', 'master_missing',
      'error', 'the offering has no master service');
  END IF;
  PERFORM public.collective_engine_test_point('after_master_read');

  v_active := coalesce(v_master.is_active, false) AND v_item.status = 'active';
  v_host_cols := public.collective_registry_columns('service_items', ARRAY['host']);
  v_venue_cols := public.collective_registry_columns('service_items', ARRAY['venue']);
  v_variant_cols := public.collective_registry_columns('service_variants', ARRAY['host']);

  -- (6) converge, in a block so a failure rolls back only this apply's writes.
  BEGIN
    -- Heading: mapped by id, created once, renamed in place. A member heading of the same name
    -- that the collective does not yet manage is adopted rather than duplicated (names are unique
    -- per venue).
    v_heading := NULL;
    IF v_master.category_id IS NOT NULL THEN
      SELECT * INTO v_master_heading FROM public.service_categories WHERE id = v_master.category_id;
      SELECT c.id INTO v_heading FROM public.service_categories c
      WHERE c.venue_id = v_link.venue_id AND c.replica_of_category_id = v_master.category_id
        AND c.managed_by_collective_id = v_link.collective_id;
      IF v_heading IS NULL THEN
        SELECT c.id INTO v_heading FROM public.service_categories c
        WHERE c.venue_id = v_link.venue_id AND lower(btrim(c.name)) = lower(btrim(v_master_heading.name))
          AND c.managed_by_collective_id IS NULL;
        IF v_heading IS NOT NULL THEN
          UPDATE public.service_categories
          SET managed_by_collective_id = v_link.collective_id, replica_of_category_id = v_master.category_id
          WHERE id = v_heading;
        ELSE
          INSERT INTO public.service_categories (venue_id, name, sort_order, managed_by_collective_id, replica_of_category_id)
          VALUES (v_link.venue_id, v_master_heading.name, v_master_heading.sort_order, v_link.collective_id, v_master.category_id)
          RETURNING id INTO v_heading;
        END IF;
        v_writes := jsonb_set(v_writes, '{service_categories}', to_jsonb((v_writes->>'service_categories')::int + 1));
      ELSE
        UPDATE public.service_categories SET name = v_master_heading.name
        WHERE id = v_heading AND name IS DISTINCT FROM v_master_heading.name;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_writes := jsonb_set(v_writes, '{service_categories}', to_jsonb((v_writes->>'service_categories')::int + v_n));
      END IF;
    END IF;

    -- The service row. D29: a replica of an offered service never lets its staff rename or
    -- re-describe it, whatever the master holds.
    SELECT string_agg(quote_ident(col), ', ') INTO v_cols FROM unnest(v_host_cols) AS col;
    SELECT string_agg(
             CASE WHEN col IN ('staff_may_customize_name', 'staff_may_customize_description') THEN 'false'
                  ELSE 'm.' || quote_ident(col) END, ', ')
      INTO v_src FROM unnest(v_host_cols) AS col;

    v_replica := v_link.replica_service_id;
    IF v_replica IS NULL THEN
      -- Created: host columns, venue columns seeded once from the master.
      IF array_length(v_venue_cols, 1) > 0 THEN
        v_cols := v_cols || ', ' || (SELECT string_agg(quote_ident(col), ', ') FROM unnest(v_venue_cols) AS col);
        v_src := v_src || ', ' || (SELECT string_agg('m.' || quote_ident(col), ', ') FROM unnest(v_venue_cols) AS col);
      END IF;
      EXECUTE format(
        'INSERT INTO public.service_items (venue_id, category_id, is_active, %s)
         SELECT $1, $2, $3, %s FROM public.service_items m WHERE m.id = $4 RETURNING id', v_cols, v_src)
        INTO v_replica USING v_link.venue_id, v_heading, v_active, v_master.id;
      UPDATE public.collective_service_replicas SET replica_service_id = v_replica WHERE id = p_link_id;
      v_writes := jsonb_set(v_writes, '{service_items}', to_jsonb((v_writes->>'service_items')::int + 1));
    ELSE
      SELECT string_agg('r.' || quote_ident(col), ', ') INTO v_dst FROM unnest(v_host_cols) AS col;
      EXECUTE format(
        'UPDATE public.service_items r SET (%s, category_id, is_active) =
           (SELECT %s, $2, $3 FROM public.service_items m WHERE m.id = $1)
         WHERE r.id = $4 AND EXISTS (
           SELECT 1 FROM public.service_items m
           WHERE m.id = $1 AND ROW(%s, r.category_id, r.is_active) IS DISTINCT FROM ROW(%s, $2::uuid, $3::boolean))',
        v_cols, v_src, v_dst, v_src)
        USING v_master.id, v_heading, v_active, v_replica;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_writes := jsonb_set(v_writes, '{service_items}', to_jsonb((v_writes->>'service_items')::int + v_n));
    END IF;

    -- Options: upserted by replica_of_variant_id; one whose master option is gone is deactivated,
    -- never deleted, because bookings reference it.
    SELECT string_agg(quote_ident(col), ', ') INTO v_cols FROM unnest(v_variant_cols) AS col;
    SELECT string_agg('m.' || quote_ident(col), ', ') INTO v_src FROM unnest(v_variant_cols) AS col;
    SELECT string_agg('r.' || quote_ident(col), ', ') INTO v_dst FROM unnest(v_variant_cols) AS col;
    FOR v_mv IN SELECT id, is_active FROM public.service_variants WHERE service_item_id = v_master.id ORDER BY id LOOP
      SELECT id INTO v_rv FROM public.service_variants
      WHERE service_item_id = v_replica AND replica_of_variant_id = v_mv.id;
      IF v_rv IS NULL THEN
        EXECUTE format(
          'INSERT INTO public.service_variants (venue_id, service_item_id, replica_of_variant_id, is_active, %s)
           SELECT $1, $2, m.id, m.is_active, %s FROM public.service_variants m WHERE m.id = $3', v_cols, v_src)
          USING v_link.venue_id, v_replica, v_mv.id;
        v_writes := jsonb_set(v_writes, '{service_variants}', to_jsonb((v_writes->>'service_variants')::int + 1));
      ELSE
        EXECUTE format(
          'UPDATE public.service_variants r SET (%s, is_active) = (SELECT %s, m.is_active FROM public.service_variants m WHERE m.id = $1)
           WHERE r.id = $2 AND EXISTS (
             SELECT 1 FROM public.service_variants m
             WHERE m.id = $1 AND ROW(%s, r.is_active) IS DISTINCT FROM ROW(%s, m.is_active))',
          v_cols, v_src, v_dst, v_src)
          USING v_mv.id, v_rv;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_writes := jsonb_set(v_writes, '{service_variants}', to_jsonb((v_writes->>'service_variants')::int + v_n));
      END IF;
    END LOOP;
    UPDATE public.service_variants r SET is_active = false, replica_of_variant_id = NULL
    WHERE r.service_item_id = v_replica AND r.replica_of_variant_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.service_variants m
                      WHERE m.id = r.replica_of_variant_id AND m.service_item_id = v_master.id);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_writes := jsonb_set(v_writes, '{service_variants}', to_jsonb((v_writes->>'service_variants')::int + v_n));

    -- Add-on groups: one managed group per (member, collective, master group), host columns kept in
    -- step and sort_order seeded once; options updated in place by position, so a host re-saving its
    -- options causes no id churn at the member; the replica linked to exactly the managed groups.
    FOR v_mg IN
      SELECT g.*, sag.sort_order AS link_sort_order
      FROM public.service_addon_groups sag JOIN public.addon_groups g ON g.id = sag.addon_group_id
      WHERE sag.service_item_id = v_master.id
      ORDER BY g.id
    LOOP
      SELECT id INTO v_group FROM public.addon_groups
      WHERE venue_id = v_link.venue_id AND managed_by_collective_id = v_link.collective_id
        AND replica_of_addon_group_id = v_mg.id;
      IF v_group IS NULL THEN
        INSERT INTO public.addon_groups (venue_id, name, prompt_to_client, description, selection_type, min_select,
          max_select, hidden_from_online, is_active, sort_order, managed_by_collective_id, replica_of_addon_group_id)
        VALUES (v_link.venue_id, v_mg.name, v_mg.prompt_to_client, v_mg.description, v_mg.selection_type, v_mg.min_select,
          v_mg.max_select, v_mg.hidden_from_online, v_mg.is_active, v_mg.sort_order, v_link.collective_id, v_mg.id)
        RETURNING id INTO v_group;
        v_writes := jsonb_set(v_writes, '{addon_groups}', to_jsonb((v_writes->>'addon_groups')::int + 1));
      ELSE
        UPDATE public.addon_groups r
        SET name = v_mg.name, prompt_to_client = v_mg.prompt_to_client, description = v_mg.description,
            selection_type = v_mg.selection_type, min_select = v_mg.min_select, max_select = v_mg.max_select,
            hidden_from_online = v_mg.hidden_from_online, is_active = v_mg.is_active
        WHERE r.id = v_group
          AND ROW(r.name, r.prompt_to_client, r.description, r.selection_type, r.min_select, r.max_select,
                  r.hidden_from_online, r.is_active)
              IS DISTINCT FROM
              ROW(v_mg.name, v_mg.prompt_to_client, v_mg.description, v_mg.selection_type, v_mg.min_select,
                  v_mg.max_select, v_mg.hidden_from_online, v_mg.is_active);
        GET DIAGNOSTICS v_n = ROW_COUNT;
        v_writes := jsonb_set(v_writes, '{addon_groups}', to_jsonb((v_writes->>'addon_groups')::int + v_n));
      END IF;
      v_group_ids := v_group_ids || v_group;

      -- Options by position. The member's positions are taken once, before any update moves them.
      SELECT coalesce(array_agg(a.id ORDER BY a.sort_order, a.name, a.id), ARRAY[]::uuid[]) INTO v_member_opts
      FROM public.addons a WHERE a.addon_group_id = v_group AND a.archived_at IS NULL;
      FOR v_mo IN
        SELECT m.*, row_number() OVER (ORDER BY m.sort_order, m.name, m.id) AS position
        FROM public.addons m WHERE m.addon_group_id = v_mg.id AND m.archived_at IS NULL
        ORDER BY position
      LOOP
        v_ro := v_member_opts[v_mo.position];
        IF v_ro IS NULL THEN
          INSERT INTO public.addons (addon_group_id, venue_id, name, description, additional_price_pence,
            additional_duration_minutes, is_active, sort_order, replica_of_addon_id)
          VALUES (v_group, v_link.venue_id, v_mo.name, v_mo.description, v_mo.additional_price_pence,
            v_mo.additional_duration_minutes, v_mo.is_active, v_mo.sort_order, v_mo.id);
          v_writes := jsonb_set(v_writes, '{addons}', to_jsonb((v_writes->>'addons')::int + 1));
        ELSE
          UPDATE public.addons r
          SET name = v_mo.name, description = v_mo.description, additional_price_pence = v_mo.additional_price_pence,
              additional_duration_minutes = v_mo.additional_duration_minutes, is_active = v_mo.is_active,
              sort_order = v_mo.sort_order, replica_of_addon_id = v_mo.id
          WHERE r.id = v_ro
            AND ROW(r.name, r.description, r.additional_price_pence, r.additional_duration_minutes, r.is_active,
                    r.sort_order, r.replica_of_addon_id)
                IS DISTINCT FROM
                ROW(v_mo.name, v_mo.description, v_mo.additional_price_pence, v_mo.additional_duration_minutes,
                    v_mo.is_active, v_mo.sort_order, v_mo.id);
          GET DIAGNOSTICS v_n = ROW_COUNT;
          v_writes := jsonb_set(v_writes, '{addons}', to_jsonb((v_writes->>'addons')::int + v_n));
        END IF;
      END LOOP;
      -- Positions the master no longer has: archived, never deleted (bookings snapshot them).
      UPDATE public.addons a SET archived_at = p_now, replica_of_addon_id = NULL
      WHERE a.id = ANY (v_member_opts[
        (SELECT count(*) FROM public.addons m WHERE m.addon_group_id = v_mg.id AND m.archived_at IS NULL)::int + 1 :
        cardinality(v_member_opts)]);
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_writes := jsonb_set(v_writes, '{addons}', to_jsonb((v_writes->>'addons')::int + v_n));

      -- The link, with the host's link order.
      INSERT INTO public.service_addon_groups (venue_id, service_item_id, addon_group_id, sort_order)
      VALUES (v_link.venue_id, v_replica, v_group, v_mg.link_sort_order)
      ON CONFLICT (service_item_id, addon_group_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
      WHERE public.service_addon_groups.sort_order IS DISTINCT FROM EXCLUDED.sort_order;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_writes := jsonb_set(v_writes, '{service_addon_groups}', to_jsonb((v_writes->>'service_addon_groups')::int + v_n));
    END LOOP;

    -- The replica is linked to exactly the managed groups of its master's links.
    DELETE FROM public.service_addon_groups
    WHERE service_item_id = v_replica AND NOT (addon_group_id = ANY (v_group_ids));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_writes := jsonb_set(v_writes, '{service_addon_groups}', to_jsonb((v_writes->>'service_addon_groups')::int + v_n));

  EXCEPTION WHEN OTHERS THEN
    -- (7) the block's writes are rolled back; record the failure and back off.
    v_code := CASE SQLSTATE
      WHEN '23505' THEN 'unique_violation'
      WHEN '23503' THEN 'fk_violation'
      WHEN '55P03' THEN 'lock_timeout'
      WHEN '57014' THEN 'timeout'
      ELSE 'unknown' END;
    v_backoff := (ARRAY[1, 5, 30, 120, 360])[LEAST(v_link.attempts + 1, 5)];
    UPDATE public.collective_service_replicas
    SET attempts = attempts + 1,
        last_error_code = v_code,
        last_error = left(SQLERRM, 500),
        next_attempt_at = p_now + make_interval(mins => v_backoff),
        behind_since = coalesce(behind_since, p_now),
        lease_until = NULL
    WHERE id = p_link_id;
    PERFORM public.collective_write_audit(
      v_link.collective_id, 'replica_failed', p_actor_venue_id, p_actor_user_id, p_job, v_link.venue_id,
      v_link.collective_service_item_id, v_master.id, p_link_id, v_target,
      jsonb_build_object('error_code', v_code, 'error', left(SQLERRM, 500), 'attempts', v_link.attempts + 1),
      p_support_session_id, p_now);
    RETURN jsonb_build_object('ok', false, 'link_id', p_link_id, 'error_code', v_code, 'error', SQLERRM);
  END;

  -- (8) success.
  v_fingerprint := public.collective_replica_fingerprint(p_link_id);
  UPDATE public.collective_service_replicas
  SET applied_fingerprint = v_fingerprint,
      applied_revision = v_target,
      behind_since = CASE WHEN v_target = desired_revision THEN NULL ELSE behind_since END,
      attempts = 0,
      next_attempt_at = NULL,
      last_error_code = NULL,
      last_error = NULL,
      lease_until = NULL,
      last_applied_at = p_now
  WHERE id = p_link_id;

  SELECT sum(value::int) INTO v_total FROM jsonb_each_text(v_writes);
  IF v_total > 0 THEN
    PERFORM public.collective_write_audit(
      v_link.collective_id, 'replica_applied', p_actor_venue_id, p_actor_user_id, p_job, v_link.venue_id,
      v_link.collective_service_item_id, v_replica, p_link_id, v_target,
      jsonb_build_object('writes', v_writes), p_support_session_id, p_now);
    PERFORM public.collective_bump_revision(v_link.collective_id, p_now);
  END IF;

  RETURN jsonb_build_object('ok', true, 'link_id', p_link_id, 'applied_revision', v_target, 'writes', v_writes);
END;
$$;


-- ===========================================================================
-- Deleting a master add-on group or option releases replica pointers (RT2-4), as options do.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_release_child_pointers(p_table text, p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev text := public.collective_engine_enter();
BEGIN
  IF p_table = 'service_variants' THEN
    UPDATE public.service_variants SET replica_of_variant_id = NULL, is_active = false
    WHERE replica_of_variant_id = p_id;
  ELSIF p_table = 'service_categories' THEN
    UPDATE public.service_categories SET replica_of_category_id = NULL, managed_by_collective_id = NULL
    WHERE replica_of_category_id = p_id;
  ELSIF p_table = 'addon_groups' THEN
    UPDATE public.addon_groups SET replica_of_addon_group_id = NULL, managed_by_collective_id = NULL
    WHERE replica_of_addon_group_id = p_id;
  ELSIF p_table = 'addons' THEN
    UPDATE public.addons SET replica_of_addon_id = NULL WHERE replica_of_addon_id = p_id;
  END IF;
  PERFORM public.collective_engine_leave(v_prev);
END;
$$;

DROP TRIGGER IF EXISTS trg_collective_release_addon_group_pointers ON public.addon_groups;
CREATE TRIGGER trg_collective_release_addon_group_pointers
  BEFORE DELETE ON public.addon_groups
  FOR EACH ROW EXECUTE FUNCTION public.collective_before_delete_master_child();
DROP TRIGGER IF EXISTS trg_collective_release_addon_pointers ON public.addons;
CREATE TRIGGER trg_collective_release_addon_pointers
  BEFORE DELETE ON public.addons
  FOR EACH ROW EXECUTE FUNCTION public.collective_before_delete_master_child();

-- ===========================================================================
-- Dirty triggers for add-ons: a master's links, its groups or their options changed.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_dirty_service_addon_groups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_masters uuid[];
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.service_item_id) INTO v_masters FROM old_rows o
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = o.service_item_id AND i.status = 'active');
  ELSE
    SELECT array_agg(DISTINCT n.service_item_id) INTO v_masters FROM new_rows n
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = n.service_item_id AND i.status = 'active');
  END IF;
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

-- Groups and options map to the masters that link the group.
CREATE OR REPLACE FUNCTION public.collective_dirty_addon_groups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_masters uuid[];
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT sag.service_item_id) INTO v_masters
  FROM new_rows n JOIN old_rows o ON o.id = n.id
  JOIN public.service_addon_groups sag ON sag.addon_group_id = n.id
  WHERE (to_jsonb(n) - 'updated_at' - 'sort_order') IS DISTINCT FROM (to_jsonb(o) - 'updated_at' - 'sort_order')
    AND EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = sag.service_item_id AND i.status = 'active');
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_dirty_addons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_masters uuid[];
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT sag.service_item_id) INTO v_masters
    FROM old_rows o JOIN public.service_addon_groups sag ON sag.addon_group_id = o.addon_group_id
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = sag.service_item_id AND i.status = 'active');
  ELSIF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT sag.service_item_id) INTO v_masters
    FROM new_rows n JOIN public.service_addon_groups sag ON sag.addon_group_id = n.addon_group_id
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = sag.service_item_id AND i.status = 'active');
  ELSE
    SELECT array_agg(DISTINCT sag.service_item_id) INTO v_masters
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    JOIN public.service_addon_groups sag ON sag.addon_group_id = n.addon_group_id
    WHERE (to_jsonb(n) - 'updated_at') IS DISTINCT FROM (to_jsonb(o) - 'updated_at')
      AND EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = sag.service_item_id AND i.status = 'active');
  END IF;
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_collective_dirty_service_addon_groups_ins ON public.service_addon_groups;
CREATE TRIGGER trg_collective_dirty_service_addon_groups_ins AFTER INSERT ON public.service_addon_groups
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_addon_groups();
DROP TRIGGER IF EXISTS trg_collective_dirty_service_addon_groups_upd ON public.service_addon_groups;
CREATE TRIGGER trg_collective_dirty_service_addon_groups_upd AFTER UPDATE ON public.service_addon_groups
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_addon_groups();
DROP TRIGGER IF EXISTS trg_collective_dirty_service_addon_groups_del ON public.service_addon_groups;
CREATE TRIGGER trg_collective_dirty_service_addon_groups_del AFTER DELETE ON public.service_addon_groups
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_addon_groups();

DROP TRIGGER IF EXISTS trg_collective_dirty_addon_groups_upd ON public.addon_groups;
CREATE TRIGGER trg_collective_dirty_addon_groups_upd AFTER UPDATE ON public.addon_groups
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_addon_groups();

DROP TRIGGER IF EXISTS trg_collective_dirty_addons_ins ON public.addons;
CREATE TRIGGER trg_collective_dirty_addons_ins AFTER INSERT ON public.addons
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_addons();
DROP TRIGGER IF EXISTS trg_collective_dirty_addons_upd ON public.addons;
CREATE TRIGGER trg_collective_dirty_addons_upd AFTER UPDATE ON public.addons
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_addons();
DROP TRIGGER IF EXISTS trg_collective_dirty_addons_del ON public.addons;
CREATE TRIGGER trg_collective_dirty_addons_del AFTER DELETE ON public.addons
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_addons();

REVOKE ALL ON FUNCTION public.collective_dirty_service_addon_groups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dirty_addon_groups() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dirty_addons() FROM PUBLIC, anon, authenticated;
-- CREATE OR REPLACE keeps the grants the two replaced functions already had (service role only).
REVOKE ALL ON FUNCTION public.collective_replica_projection(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_apply_replica_core(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_release_child_pointers(text, uuid) FROM PUBLIC, anon, authenticated;
