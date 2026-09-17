-- W9: moving an existing collective from the older model to shared services (plan §7 and Appendix G,
-- D54, D21, D30; tests MIG-01 to MIG-06).
--
-- One collective at a time, driven by scripts/collective-replicas-migrate.mjs:
--
--   collective_migration_plan(collective, choices)   read only: the dry-run report the owner signs.
--   collective_migration_begin(collective, choices, actor user, now)
--       one transaction: every snapshot, the masters, service_model 'migrating', one replica link per
--       offering and member ('migrated', or none when the member has no copy), options mapped, missing
--       calendar assignments, the copies' sync columns cleared, and one migration_applied row per
--       member carrying the before-image. Nothing is sent and nothing is shown to members (D54).
--   (the script then runs collective_apply_replica per link, which writes the host's values)
--   collective_migration_finish(collective, actor user, now)
--       once every link has converged: service_model 'replicas', the owner's "add to page" choices
--       for member-only services, and the updated_at of every row the drain wrote (for rollback).
--   collective_migration_rollback(collective, restore_stale, actor user, now)
--       restores what begin recorded where the row is unchanged since the drain, releases the links,
--       and puts the collective back on 'legacy_copies'. Bookings are never touched.
--
-- The two rules at the head of §7: existing bookings are untouched (a missing price snapshot is the
-- only booking write), and the host's values apply to every service at the switch. Per-calendar
-- values, venue flags, account links and member-only services' active state are never written.

-- ---------------------------------------------------------------------------------------------
-- The plan (dry run). STABLE: reads only.
-- choices: { "needs_master": [{ "item_id", "choice": "create" | "skip" }],
--            "member_only":  [{ "service_id", "choice": "add_to_page" | "park" }] }
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_plan(
  p_collective_id uuid,
  p_choices jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_host_cols text[] := public.collective_registry_columns('service_items', ARRAY['host']);
  v_p1 jsonb; v_p2 jsonb; v_p3 jsonb; v_p4 jsonb; v_p5 jsonb;
  v_masters jsonb := '[]'::jsonb;
  v_page_copy jsonb := '[]'::jsonb;
  v_links jsonb := '[]'::jsonb;
  v_member_only jsonb := '[]'::jsonb;
  v_venues jsonb := '[]'::jsonb;
  v_item record;
  v_member record;
  v_master public.service_items%ROWTYPE;
  v_copy public.service_items%ROWTYPE;
  v_copy_id uuid;
  v_master_id uuid;
  v_created_from uuid;
  v_choice text;
  v_replaced jsonb;
  v_options jsonb;
  v_col text;
  v_differs text[];
  v_checks jsonb;
  v_assignments int;
  v_snapshots int;
BEGIN
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'collective_migration_plan: collective not found';
  END IF;

  -- P1 ambiguous master; P2 a member service backing two offerings; P3 form slug collisions;
  -- P4 copy options with future bookings and no master option by name or position; P5 no host source.
  SELECT jsonb_build_object('count', count(*), 'sample_ids', coalesce(jsonb_agg(item_id ORDER BY item_id) FILTER (WHERE true), '[]'))
  INTO v_p1 FROM (
    SELECT p.item_id FROM public.collective_service_providers p
    JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
    WHERE p.status = 'active' AND p.venue_id = v_collective.host_venue_id
    GROUP BY p.item_id HAVING count(DISTINCT p.source_service_id) > 1) x;
  SELECT jsonb_build_object('count', count(*), 'sample_ids', coalesce(jsonb_agg(source_service_id ORDER BY source_service_id), '[]'))
  INTO v_p2 FROM (
    SELECT p.source_service_id FROM public.collective_service_providers p
    JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
    WHERE p.status = 'active'
    GROUP BY p.source_service_id HAVING count(DISTINCT p.item_id) > 1) x;
  SELECT jsonb_build_object('count', count(*), 'sample_ids', coalesce(jsonb_agg(DISTINCT mt.id), '[]'))
  INTO v_p3
  FROM public.collective_service_items i
  JOIN public.collective_service_providers hp ON hp.item_id = i.id AND hp.status = 'active' AND hp.venue_id = v_collective.host_venue_id
  JOIN public.service_compliance_requirements q ON q.service_item_id = hp.source_service_id
  JOIN public.compliance_types ht ON ht.id = q.compliance_type_id
  JOIN public.venue_collective_members m ON m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> ht.venue_id
  JOIN public.compliance_types mt ON mt.venue_id = m.venue_id AND mt.slug = ht.slug
  WHERE i.collective_id = p_collective_id AND i.status = 'active'
    AND mt.library_template_slug IS DISTINCT FROM ht.library_template_slug;
  SELECT jsonb_build_object('count', count(*), 'sample_ids', coalesce(jsonb_agg(cv_id ORDER BY cv_id), '[]'))
  INTO v_p4 FROM (
    SELECT DISTINCT cv.id AS cv_id FROM public.service_variants cv
    JOIN public.collective_service_providers p ON p.source_service_id = cv.service_item_id AND p.status = 'active'
      AND p.venue_id <> v_collective.host_venue_id
    JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
    JOIN public.collective_service_providers hp ON hp.item_id = i.id AND hp.status = 'active' AND hp.venue_id = v_collective.host_venue_id
    WHERE EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_variant_id = cv.id
                  AND b.booking_date >= current_date AND b.status <> 'Cancelled')
      AND NOT EXISTS (SELECT 1 FROM public.service_variants mv WHERE mv.service_item_id = hp.source_service_id
                  AND (lower(btrim(mv.name)) = lower(btrim(cv.name)) OR mv.sort_order = cv.sort_order))) x;
  SELECT jsonb_build_object('count', count(*), 'sample_ids', coalesce(jsonb_agg(i.id ORDER BY i.id), '[]'))
  INTO v_p5 FROM public.collective_service_items i
  WHERE i.collective_id = p_collective_id AND i.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM public.collective_service_providers p
                    WHERE p.item_id = i.id AND p.status = 'active' AND p.venue_id = v_collective.host_venue_id);

  FOR v_item IN
    SELECT i.* FROM public.collective_service_items i
    WHERE i.collective_id = p_collective_id AND i.status = 'active'
    ORDER BY i.display_order, i.id
  LOOP
    SELECT min(p.source_service_id::text)::uuid INTO v_master_id FROM public.collective_service_providers p
    WHERE p.item_id = v_item.id AND p.status = 'active' AND p.venue_id = v_collective.host_venue_id;
    v_created_from := NULL;
    IF v_master_id IS NULL THEN
      SELECT c->>'choice' INTO v_choice FROM jsonb_array_elements(coalesce(p_choices->'needs_master', '[]'::jsonb)) c
      WHERE c->>'item_id' = v_item.id::text LIMIT 1;
      SELECT p.source_service_id INTO v_created_from FROM public.collective_service_providers p
      WHERE p.item_id = v_item.id AND p.status = 'active' ORDER BY p.created_at, p.id LIMIT 1;
      v_masters := v_masters || jsonb_build_object('item_id', v_item.id, 'name', v_item.name,
        'master_service_id', NULL, 'created_from_service_id', v_created_from,
        'choice', coalesce(v_choice, 'create'));
      CONTINUE WHEN coalesce(v_choice, 'create') = 'skip' OR v_created_from IS NULL;
      SELECT * INTO v_master FROM public.service_items WHERE id = v_created_from;
    ELSE
      v_masters := v_masters || jsonb_build_object('item_id', v_item.id, 'name', v_item.name,
        'master_service_id', v_master_id, 'created_from_service_id', NULL);
      SELECT * INTO v_master FROM public.service_items WHERE id = v_master_id;
    END IF;

    -- The page's own copy of the offering, which the master's wording replaces (D54).
    v_differs := ARRAY[]::text[];
    IF v_item.name IS DISTINCT FROM v_master.name THEN v_differs := v_differs || 'name'::text; END IF;
    IF v_item.description IS DISTINCT FROM v_master.description THEN v_differs := v_differs || 'description'::text; END IF;
    IF v_item.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.collective_service_categories cc JOIN public.service_categories hc ON hc.id = v_master.category_id
      WHERE cc.id = v_item.category_id AND lower(btrim(cc.name)) = lower(btrim(hc.name))) THEN
      v_differs := v_differs || 'heading'::text;
    END IF;
    IF array_length(v_differs, 1) > 0 THEN
      v_page_copy := v_page_copy || jsonb_build_object('item_id', v_item.id, 'differs', to_jsonb(v_differs));
    END IF;

    FOR v_member IN
      SELECT m.id, m.venue_id FROM public.venue_collective_members m
      WHERE m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> v_collective.host_venue_id
      ORDER BY m.venue_id
    LOOP
      SELECT min(p.source_service_id::text)::uuid INTO v_copy_id FROM public.collective_service_providers p
      WHERE p.item_id = v_item.id AND p.status = 'active' AND p.venue_id = v_member.venue_id;
      v_replaced := '[]'::jsonb;
      v_options := '[]'::jsonb;
      IF v_copy_id IS NOT NULL THEN
        SELECT * INTO v_copy FROM public.service_items WHERE id = v_copy_id;
        FOREACH v_col IN ARRAY v_host_cols LOOP
          IF (to_jsonb(v_copy) -> v_col) IS DISTINCT FROM (to_jsonb(v_master) -> v_col) THEN
            v_replaced := v_replaced || jsonb_build_object('column', v_col,
              'before', to_jsonb(v_copy) -> v_col, 'after', to_jsonb(v_master) -> v_col);
          END IF;
        END LOOP;
        IF v_copy.is_active IS DISTINCT FROM v_master.is_active THEN
          v_replaced := v_replaced || jsonb_build_object('column', 'is_active', 'before', v_copy.is_active, 'after', v_master.is_active);
        END IF;
        SELECT coalesce(jsonb_agg(o ORDER BY o->>'copy_variant_id'), '[]'::jsonb) INTO v_options
        FROM public.collective_migration_option_map(v_copy.id, v_master.id) o;
      END IF;
      v_links := v_links || jsonb_build_object('item_id', v_item.id, 'venue_id', v_member.venue_id,
        'copy_service_id', v_copy_id, 'replaced', v_replaced, 'options', v_options);
    END LOOP;
  END LOOP;

  -- Member-only services: active services at a member that back no offering (D2 as revised).
  SELECT coalesce(jsonb_agg(jsonb_build_object('venue_id', s.venue_id, 'service_id', s.id, 'name', s.name,
           'choice', coalesce((SELECT c->>'choice' FROM jsonb_array_elements(coalesce(p_choices->'member_only', '[]'::jsonb)) c
                               WHERE c->>'service_id' = s.id::text LIMIT 1), 'park'))
           ORDER BY s.venue_id, s.name, s.id), '[]'::jsonb)
  INTO v_member_only
  FROM public.service_items s
  JOIN public.venue_collective_members m ON m.venue_id = s.venue_id AND m.collective_id = p_collective_id AND m.status = 'active'
  WHERE s.is_active AND s.venue_id <> v_collective.host_venue_id
    AND NOT EXISTS (SELECT 1 FROM public.collective_service_providers p
                    JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
                    WHERE p.source_service_id = s.id AND p.status = 'active');

  -- What each venue will be able to offer guests, and whether it joins cleanly today.
  SELECT coalesce(jsonb_agg(jsonb_build_object('venue_id', v.id, 'name', v.name,
           'is_host', v.id = v_collective.host_venue_id,
           'stripe_charges_enabled', coalesce(v.stripe_charges_enabled, false),
           'forms_on', coalesce((v.feature_flags->>'compliance_records_enabled')::boolean, false),
           'blocker', CASE WHEN v.id = v_collective.host_venue_id THEN NULL
                           ELSE public.collective_join_blocker(p_collective_id, v.id) END)
           ORDER BY v.id), '[]'::jsonb)
  INTO v_venues
  FROM public.venue_collective_members m JOIN public.venues v ON v.id = m.venue_id
  WHERE m.collective_id = p_collective_id AND m.status = 'active';

  SELECT count(*) INTO v_assignments FROM public.collective_service_providers p
  JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
  WHERE p.status = 'active' AND p.practitioner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.calendar_service_assignments a
                    WHERE a.calendar_id = p.practitioner_id AND a.service_item_id = p.source_service_id);
  SELECT count(*) INTO v_snapshots FROM public.bookings b
  WHERE b.service_price_snapshot_pence IS NULL AND b.service_item_id IN (
    SELECT p.source_service_id FROM public.collective_service_providers p
    JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
    WHERE p.status = 'active');

  SELECT jsonb_build_object(
    'provider_overrides', (SELECT count(*) FROM public.collective_service_providers p
      JOIN public.collective_service_items i ON i.id = p.item_id AND i.collective_id = p_collective_id
      WHERE p.status = 'active' AND (p.price_pence_override IS NOT NULL OR p.duration_minutes_override IS NOT NULL)),
    'providers_not_approved', (SELECT count(*) FROM public.collective_service_providers p
      JOIN public.collective_service_items i ON i.id = p.item_id AND i.collective_id = p_collective_id
      WHERE p.status = 'active' AND p.approval_status <> 'approved'),
    'providers_all_calendars', (SELECT count(*) FROM public.collective_service_providers p
      JOIN public.collective_service_items i ON i.id = p.item_id AND i.collective_id = p_collective_id
      WHERE p.status = 'active' AND p.practitioner_id IS NULL),
    'inactive_copies', (SELECT count(DISTINCT s.id) FROM public.collective_service_providers p
      JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
      JOIN public.service_items s ON s.id = p.source_service_id
      WHERE p.status = 'active' AND NOT s.is_active),
    'staff_only_services', (SELECT count(*) FROM public.service_items s
      JOIN public.venue_collective_members m ON m.venue_id = s.venue_id AND m.collective_id = p_collective_id AND m.status = 'active'
      WHERE s.is_bookable_online = false),
    'adopted_address', v_collective.adopted_venue_id)
  INTO v_checks;

  RETURN jsonb_build_object(
    'collective', p_collective_id,
    'name', v_collective.name,
    'service_model', v_collective.service_model,
    'host_venue_id', v_collective.host_venue_id,
    'p1', v_p1, 'p2', v_p2, 'p3', v_p3, 'p4', v_p4, 'p5', v_p5,
    'checks', v_checks,
    'masters', v_masters,
    'page_copy', v_page_copy,
    'links', v_links,
    'member_only', v_member_only,
    'venues', v_venues,
    'assignments_to_create', v_assignments,
    'bookings_to_snapshot', v_snapshots);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Option mapping (Appendix G): exact normalised name, then remaining by sort position; the rest
-- are kept inactive with no mapping when they have future bookings, and switched off otherwise.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_option_map(p_copy_id uuid, p_master_id uuid)
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cv record;
  v_used uuid[] := ARRAY[]::uuid[];
  v_match uuid;
  v_rule text;
  v_pending record;
  v_unmatched jsonb := '[]'::jsonb;
BEGIN
  FOR v_cv IN SELECT * FROM public.service_variants WHERE service_item_id = p_copy_id ORDER BY sort_order, id LOOP
    SELECT mv.id INTO v_match FROM public.service_variants mv
    WHERE mv.service_item_id = p_master_id AND lower(btrim(mv.name)) = lower(btrim(v_cv.name)) AND NOT (mv.id = ANY (v_used))
    ORDER BY mv.sort_order, mv.id LIMIT 1;
    IF v_match IS NOT NULL THEN
      v_used := v_used || v_match;
      RETURN NEXT jsonb_build_object('copy_variant_id', v_cv.id, 'master_variant_id', v_match, 'rule', 'name',
        'has_bookings', EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_variant_id = v_cv.id
                                AND b.booking_date >= current_date AND b.status <> 'Cancelled'));
    ELSE
      v_unmatched := v_unmatched || jsonb_build_object('id', v_cv.id, 'sort_order', v_cv.sort_order);
    END IF;
  END LOOP;
  FOR v_pending IN SELECT (u->>'id')::uuid AS id, (u->>'sort_order')::int AS sort_order FROM jsonb_array_elements(v_unmatched) u LOOP
    SELECT mv.id INTO v_match FROM public.service_variants mv
    WHERE mv.service_item_id = p_master_id AND mv.sort_order = v_pending.sort_order AND NOT (mv.id = ANY (v_used))
    ORDER BY mv.id LIMIT 1;
    IF v_match IS NOT NULL THEN
      v_used := v_used || v_match;
      v_rule := 'position';
    ELSE
      v_rule := CASE WHEN EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_variant_id = v_pending.id
                                  AND b.booking_date >= current_date AND b.status <> 'Cancelled')
                     THEN 'kept_inactive' ELSE 'switched_off' END;
    END IF;
    RETURN NEXT jsonb_build_object('copy_variant_id', v_pending.id, 'master_variant_id', v_match, 'rule', v_rule,
      'has_bookings', EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_variant_id = v_pending.id
                              AND b.booking_date >= current_date AND b.status <> 'Cancelled'));
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Begin: everything up to the drain, in one transaction.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_begin_core(
  p_collective_id uuid,
  p_choices jsonb,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_plan jsonb;
  v_master jsonb;
  v_link jsonb;
  v_master_id uuid;
  v_member record;
  v_link_id uuid;
  v_links jsonb := '[]'::jsonb;
  v_cols text[];
  v_list text;
  v_opt jsonb;
  v_copies uuid[];
  v_before jsonb;
  v_created_masters jsonb := '[]'::jsonb;
  v_snapshots int := 0;
  v_items_before jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'legacy_copies' THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: the collective is already %', v_collective.service_model;
  END IF;

  v_plan := public.collective_migration_plan(p_collective_id, p_choices);
  IF (v_plan->'p1'->>'count')::int > 0 OR (v_plan->'p2'->>'count')::int > 0 OR (v_plan->'p3'->>'count')::int > 0 THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: resolve P1 to P3 first (%, %, %)',
      v_plan->'p1'->>'count', v_plan->'p2'->>'count', v_plan->'p3'->>'count';
  END IF;

  -- Snapshots first (PRICE-10): every booking on a master or copy keeps the price it was made at.
  UPDATE public.bookings b
  SET service_price_snapshot_pence = public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
  WHERE b.service_price_snapshot_pence IS NULL
    AND b.service_item_id IN (
      SELECT p.source_service_id FROM public.collective_service_providers p
      JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
      WHERE p.status = 'active')
    AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'status', i.status,
           'master_service_id', i.master_service_id) ORDER BY i.id), '[]'::jsonb)
  INTO v_items_before
  FROM public.collective_service_items i WHERE i.collective_id = p_collective_id AND i.status = 'active';

  -- Masters: the host's source, or (D36) a host service created from the earliest provider's.
  v_cols := public.collective_registry_columns('service_items', ARRAY['host', 'venue']);
  SELECT string_agg(pg_catalog.quote_ident(c), ', ') INTO v_list FROM unnest(v_cols) c;
  FOR v_master IN SELECT m FROM jsonb_array_elements(v_plan->'masters') m LOOP
    v_master_id := nullif(v_master->>'master_service_id', '')::uuid;
    IF v_master_id IS NULL THEN
      CONTINUE WHEN v_master->>'choice' = 'skip' OR v_master->>'created_from_service_id' IS NULL;
      EXECUTE format(
        'INSERT INTO public.service_items (venue_id, is_active, %1$s) SELECT $1, true, %1$s FROM public.service_items WHERE id = $2 RETURNING id',
        v_list)
      INTO v_master_id USING v_collective.host_venue_id, (v_master->>'created_from_service_id')::uuid;
      EXECUTE format(
        'INSERT INTO public.service_variants (venue_id, service_item_id, is_active, %1$s) '
        'SELECT $1, $2, is_active, %1$s FROM public.service_variants WHERE service_item_id = $3 ORDER BY sort_order, id',
        (SELECT string_agg(pg_catalog.quote_ident(c), ', ')
         FROM unnest(public.collective_registry_columns('service_variants', ARRAY['host'])) c))
      USING v_collective.host_venue_id, v_master_id, (v_master->>'created_from_service_id')::uuid;
      v_created_masters := v_created_masters || jsonb_build_object('item_id', v_master->>'item_id', 'service_id', v_master_id);
    END IF;
    -- The master's wording is the page's from the switch (D54).
    UPDATE public.collective_service_items i SET master_service_id = v_master_id, name = s.name
    FROM public.service_items s
    WHERE i.id = (v_master->>'item_id')::uuid AND s.id = v_master_id;
  END LOOP;
  -- An offering the owner chose to skip is taken off the page: nothing can serve it.
  UPDATE public.collective_service_items SET status = 'archived'
  WHERE collective_id = p_collective_id AND status = 'active' AND master_service_id IS NULL;

  UPDATE public.venue_collectives SET service_model = 'migrating' WHERE id = p_collective_id;

  -- Missing calendar assignments for providers (I4).
  INSERT INTO public.calendar_service_assignments (calendar_id, service_item_id)
  SELECT DISTINCT p.practitioner_id, p.source_service_id
  FROM public.collective_service_providers p
  JOIN public.collective_service_items i ON i.id = p.item_id AND i.status = 'active' AND i.collective_id = p_collective_id
  JOIN public.unified_calendars uc ON uc.id = p.practitioner_id AND uc.venue_id = p.venue_id
  WHERE p.status = 'active' AND p.practitioner_id IS NOT NULL
  ON CONFLICT (calendar_id, service_item_id) DO NOTHING;

  -- Links, with each member's before-image recorded first.
  FOR v_member IN
    SELECT m.id, m.venue_id FROM public.venue_collective_members m
    WHERE m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> v_collective.host_venue_id
    ORDER BY m.venue_id
  LOOP
    SELECT coalesce(array_agg(DISTINCT (l->>'copy_service_id')::uuid), ARRAY[]::uuid[]) INTO v_copies
    FROM jsonb_array_elements(v_plan->'links') l
    WHERE l->>'venue_id' = v_member.venue_id::text AND l->>'copy_service_id' IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.collective_service_items i
                  WHERE i.id = (l->>'item_id')::uuid AND i.status = 'active');

    SELECT jsonb_build_object(
      'copies', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.service_items s WHERE s.id = ANY (v_copies)), '[]'),
      'variants', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.service_variants v WHERE v.service_item_id = ANY (v_copies)), '[]'),
      'addon_links', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.service_addon_groups a WHERE a.service_item_id = ANY (v_copies)), '[]'),
      'requirements', coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.service_compliance_requirements q WHERE q.service_item_id = ANY (v_copies)), '[]'),
      'providers', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.collective_service_providers p
                             JOIN public.collective_service_items i ON i.id = p.item_id AND i.collective_id = p_collective_id
                             WHERE p.venue_id = v_member.venue_id), '[]'))
    INTO v_before;

    PERFORM public.collective_write_audit(
      p_collective_id, 'migration_applied', NULL, p_actor_user_id,
      CASE WHEN p_actor_user_id IS NULL THEN 'collective-migrate' END,
      v_member.venue_id, NULL, NULL, NULL, NULL,
      jsonb_build_object('before', v_before, 'after', jsonb_build_object('service_model', 'migrating')),
      NULL, p_now);

    FOR v_link IN
      SELECT l FROM jsonb_array_elements(v_plan->'links') l
      WHERE l->>'venue_id' = v_member.venue_id::text
        AND EXISTS (SELECT 1 FROM public.collective_service_items i
                    WHERE i.id = (l->>'item_id')::uuid AND i.status = 'active')
      ORDER BY l->>'item_id'
    LOOP
      IF v_link->>'copy_service_id' IS NOT NULL THEN
        -- The copy's options point at the master's, before any apply (PRICE-10).
        FOR v_opt IN SELECT o FROM jsonb_array_elements(v_link->'options') o LOOP
          IF v_opt->>'master_variant_id' IS NOT NULL THEN
            UPDATE public.service_variants SET replica_of_variant_id = (v_opt->>'master_variant_id')::uuid
            WHERE id = (v_opt->>'copy_variant_id')::uuid;
          ELSE
            UPDATE public.service_variants SET is_active = false, replica_of_variant_id = NULL
            WHERE id = (v_opt->>'copy_variant_id')::uuid;
          END IF;
        END LOOP;
        UPDATE public.service_items
        SET synced_from_service_id = NULL, sync_state = 'independent', synced_at = NULL
        WHERE id = (v_link->>'copy_service_id')::uuid;
      END IF;

      INSERT INTO public.collective_service_replicas
        (collective_id, collective_service_item_id, member_id, venue_id, replica_service_id, provenance, behind_since)
      VALUES (p_collective_id, (v_link->>'item_id')::uuid, v_member.id, v_member.venue_id,
              nullif(v_link->>'copy_service_id', '')::uuid, 'migrated', p_now)
      RETURNING id INTO v_link_id;
      v_links := v_links || jsonb_build_object('link_id', v_link_id, 'item_id', v_link->>'item_id',
                                               'venue_id', v_member.venue_id);
    END LOOP;
  END LOOP;

  -- The host's masters: sync columns cleared too, recorded for rollback.
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'synced_from_service_id', s.synced_from_service_id,
           'sync_state', s.sync_state, 'synced_at', s.synced_at,
           'staff_may_customize_name', s.staff_may_customize_name,
           'staff_may_customize_description', s.staff_may_customize_description)), '[]'::jsonb)
  INTO v_before
  FROM public.service_items s
  WHERE s.id IN (SELECT master_service_id FROM public.collective_service_items
                 WHERE collective_id = p_collective_id AND status = 'active');
  -- D29: one name and description everywhere for an offered service, as an offer sets.
  UPDATE public.service_items
  SET synced_from_service_id = NULL, sync_state = 'independent', synced_at = NULL,
      staff_may_customize_name = false, staff_may_customize_description = false
  WHERE id IN (SELECT master_service_id FROM public.collective_service_items
               WHERE collective_id = p_collective_id AND status = 'active')
    AND (synced_from_service_id IS NOT NULL OR sync_state <> 'independent' OR synced_at IS NOT NULL
         OR staff_may_customize_name OR staff_may_customize_description);
  PERFORM public.collective_write_audit(
    p_collective_id, 'migration_applied', NULL, p_actor_user_id,
    CASE WHEN p_actor_user_id IS NULL THEN 'collective-migrate' END,
    v_collective.host_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('masters', v_before, 'created_masters', v_created_masters),
                       'after', jsonb_build_object('service_model', 'migrating')),
    NULL, p_now);

  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  INSERT INTO public.collective_operations (collective_id, kind, idempotency_key, status, progress)
  VALUES (p_collective_id, 'migrate', 'migrate:' || p_collective_id::text, 'running',
          jsonb_build_object('phase', 'draining', 'choices', coalesce(p_choices, '{}'::jsonb),
                             'links', v_links, 'created_masters', v_created_masters,
                             'items_before', v_items_before, 'started_at', p_now))
  ON CONFLICT (idempotency_key) DO UPDATE
  SET status = 'running', progress = EXCLUDED.progress, last_error = NULL;

  RETURN jsonb_build_object('links', v_links, 'bookings_snapshotted', v_snapshots,
                            'created_masters', v_created_masters);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Finish: the switch, once every link has converged.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_finish_core(
  p_collective_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_op public.collective_operations%ROWTYPE;
  v_behind int;
  v_choice jsonb;
  v_service public.service_items%ROWTYPE;
  v_added jsonb;
  v_adds jsonb := '[]'::jsonb;
  v_after jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model <> 'migrating' THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: the collective is not migrating';
  END IF;
  SELECT * INTO v_op FROM public.collective_operations WHERE idempotency_key = 'migrate:' || p_collective_id::text;

  SELECT count(*) INTO v_behind FROM public.collective_service_replicas
  WHERE collective_id = p_collective_id AND released_at IS NULL
    AND (applied_revision < desired_revision OR replica_service_id IS NULL);
  IF v_behind > 0 THEN
    RAISE EXCEPTION 'COLLECTIVE_LINKS_BEHIND: % links have not converged yet', v_behind;
  END IF;

  -- The updated_at of every row the drain wrote, so a rollback can tell a member's later edit apart.
  SELECT jsonb_build_object(
    'services', coalesce(jsonb_object_agg(s.id, s.updated_at), '{}'::jsonb))
  INTO v_after
  FROM public.collective_service_replicas r JOIN public.service_items s ON s.id = r.replica_service_id
  WHERE r.collective_id = p_collective_id AND r.released_at IS NULL;

  UPDATE public.venue_collectives SET service_model = 'replicas' WHERE id = p_collective_id;

  -- Member-only services the owner chose to add: copied to a host master and adopted as its replica,
  -- so the member's service, calendars and bookings stay as they are. No notice is sent (D54).
  FOR v_choice IN
    SELECT c FROM jsonb_array_elements(coalesce(v_op.progress->'choices'->'member_only', '[]'::jsonb)) c
    WHERE c->>'choice' = 'add_to_page'
  LOOP
    SELECT * INTO v_service FROM public.service_items WHERE id = (v_choice->>'service_id')::uuid;
    CONTINUE WHEN v_service.id IS NULL OR NOT v_service.is_active;
    v_added := public.collective_add_from_venue_core(p_collective_id, v_service.venue_id, v_service.id,
                                                     v_collective.host_venue_id, NULL, p_now);
    PERFORM public.collective_answer_adoption_core(p_collective_id, (v_added->>'item_id')::uuid, v_service.venue_id,
      'use_mine',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('my_variant_id', mv.id, 'host_variant_id', hv.id)), '[]'::jsonb)
       FROM public.service_variants mv
       JOIN public.service_variants hv ON hv.service_item_id = (v_added->>'master_service_id')::uuid
         AND lower(btrim(hv.name)) = lower(btrim(mv.name))
       WHERE mv.service_item_id = v_service.id),
      NULL, NULL, p_now);
    DELETE FROM public.collective_operations
    WHERE collective_id = p_collective_id AND kind = 'notice' AND status = 'pending'
      AND idempotency_key LIKE 'adopt:' || (v_added->>'item_id') || ':%';
    v_adds := v_adds || jsonb_build_object('service_id', v_service.id, 'item_id', v_added->>'item_id',
                                           'master_service_id', v_added->>'master_service_id');
  END LOOP;

  PERFORM public.collective_write_audit(
    p_collective_id, 'migration_applied', NULL, p_actor_user_id,
    CASE WHEN p_actor_user_id IS NULL THEN 'collective-migrate' END,
    v_collective.host_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('service_model', 'replicas', 'added_to_page', v_adds)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  UPDATE public.collective_operations
  SET status = 'done',
      progress = progress || jsonb_build_object('phase', 'done', 'after_updated_at', v_after,
                                                'added_to_page', v_adds, 'finished_at', p_now)
  WHERE idempotency_key = 'migrate:' || p_collective_id::text;

  RETURN jsonb_build_object('service_model', 'replicas', 'added_to_page', v_adds);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Rollback: what begin recorded, where the row is unchanged since the drain (the freshness rule).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_rollback_core(
  p_collective_id uuid,
  p_restore_stale uuid[],
  p_actor_user_id uuid,
  p_now timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_op public.collective_operations%ROWTYPE;
  v_event record;
  v_row jsonb;
  v_host_cols text[] := public.collective_registry_columns('service_items', ARRAY['host']);
  v_variant_cols text[] := public.collective_registry_columns('service_variants', ARRAY['host']);
  v_cols text;
  v_src text;
  v_recorded timestamptz;
  v_current timestamptz;
  v_skipped jsonb := '[]'::jsonb;
  v_restored int := 0;
  v_copy_ids uuid[];
  v_masters jsonb;
  v_link record;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  IF NOT FOUND OR v_collective.service_model NOT IN ('migrating', 'replicas') THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: the collective has not been migrated';
  END IF;
  SELECT * INTO v_op FROM public.collective_operations WHERE idempotency_key = 'migrate:' || p_collective_id::text;
  IF v_op.id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_MIGRATION_REFUSED: no migration was recorded for this collective';
  END IF;

  SELECT string_agg(pg_catalog.quote_ident(c), ', ') INTO v_cols FROM unnest(v_host_cols) c;
  SELECT string_agg('b.' || pg_catalog.quote_ident(c), ', ') INTO v_src FROM unnest(v_host_cols) c;

  -- Every copy the migration recorded; anything else a link holds was made by the migration.
  SELECT coalesce(array_agg((c->>'id')::uuid), ARRAY[]::uuid[]) INTO v_copy_ids
  FROM public.collective_audit_events e, jsonb_array_elements(e.changes->'before'->'copies') c
  WHERE e.collective_id = p_collective_id AND e.event_type = 'migration_applied'
    AND e.created_at >= (v_op.progress->>'started_at')::timestamptz;

  -- Links released first, so the locks lift; then the markers go, as a release does.
  FOR v_link IN
    SELECT DISTINCT r.venue_id, r.replica_service_id FROM public.collective_service_replicas r
    WHERE r.collective_id = p_collective_id AND r.released_at IS NULL
  LOOP
    IF v_link.replica_service_id IS NOT NULL AND NOT (v_link.replica_service_id = ANY (v_copy_ids)) THEN
      -- A service the switch created at a member: switched off, unless a guest has booked it since.
      UPDATE public.service_items s SET is_active = false
      WHERE s.id = v_link.replica_service_id
        AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_item_id = s.id);
    END IF;
  END LOOP;
  UPDATE public.service_variants v SET replica_of_variant_id = NULL
  FROM public.collective_service_replicas r
  WHERE r.collective_id = p_collective_id AND r.released_at IS NULL AND v.service_item_id = r.replica_service_id
    AND NOT (v.service_item_id = ANY (v_copy_ids));
  UPDATE public.service_compliance_requirements q SET replica_of_requirement_id = NULL
  FROM public.collective_service_replicas r
  WHERE r.collective_id = p_collective_id AND r.released_at IS NULL AND q.service_item_id = r.replica_service_id
    AND NOT (q.service_item_id = ANY (v_copy_ids));
  UPDATE public.collective_service_replicas
  SET released_at = p_now, lease_until = NULL
  WHERE collective_id = p_collective_id AND released_at IS NULL;

  -- Add-on groups, forms and headings the switch made: the member's own again, and forms archived
  -- (never deleted, a record may point at them).
  UPDATE public.addons a SET replica_of_addon_id = NULL
  FROM public.addon_groups g
  WHERE g.id = a.addon_group_id AND g.managed_by_collective_id = p_collective_id AND a.replica_of_addon_id IS NOT NULL;
  UPDATE public.addon_groups SET managed_by_collective_id = NULL, replica_of_addon_group_id = NULL, is_active = false
  WHERE managed_by_collective_id = p_collective_id;
  UPDATE public.compliance_type_versions v SET replica_of_version_id = NULL
  FROM public.compliance_types t
  WHERE t.id = v.compliance_type_id AND t.managed_by_collective_id = p_collective_id AND v.replica_of_version_id IS NOT NULL;
  UPDATE public.compliance_types
  SET managed_by_collective_id = NULL, replica_of_compliance_type_id = NULL,
      is_active = false, archived_at = coalesce(archived_at, p_now)
  WHERE managed_by_collective_id = p_collective_id;
  UPDATE public.service_categories SET managed_by_collective_id = NULL, replica_of_category_id = NULL
  WHERE managed_by_collective_id = p_collective_id;

  -- The latest begin's before-image per venue.
  FOR v_event IN
    SELECT DISTINCT ON (e.target_venue_id) e.target_venue_id, e.changes
    FROM public.collective_audit_events e
    WHERE e.collective_id = p_collective_id AND e.event_type = 'migration_applied'
      AND e.changes->'before' IS NOT NULL AND e.changes->'before' ? 'copies'
      AND e.created_at >= (v_op.progress->>'started_at')::timestamptz
    ORDER BY e.target_venue_id, e.created_at DESC
  LOOP
    FOR v_row IN SELECT c FROM jsonb_array_elements(v_event.changes->'before'->'copies') c LOOP
      v_recorded := nullif(v_op.progress->'after_updated_at'->'services'->>(v_row->>'id'), '')::timestamptz;
      SELECT updated_at INTO v_current FROM public.service_items WHERE id = (v_row->>'id')::uuid;
      IF v_current IS NULL THEN
        CONTINUE;
      END IF;
      IF v_recorded IS NOT NULL AND v_current IS DISTINCT FROM v_recorded
         AND NOT ((v_row->>'id')::uuid = ANY (coalesce(p_restore_stale, ARRAY[]::uuid[]))) THEN
        v_skipped := v_skipped || jsonb_build_object('service_id', v_row->>'id', 'reason', 'edited since the switch');
        CONTINUE;
      END IF;
      EXECUTE format(
        'UPDATE public.service_items s SET (%s, category_id, is_active, synced_from_service_id, sync_state, synced_at) =
           (SELECT %s, b.category_id, b.is_active, b.synced_from_service_id, b.sync_state, b.synced_at
            FROM jsonb_populate_record(NULL::public.service_items, $1) b)
         WHERE s.id = $2', v_cols, v_src)
      USING v_row, (v_row->>'id')::uuid;
      v_restored := v_restored + 1;

      -- Options: the recorded rows come back; ones the drain added are switched off.
      UPDATE public.service_variants SET is_active = false, replica_of_variant_id = NULL
      WHERE service_item_id = (v_row->>'id')::uuid
        AND id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(v_event.changes->'before'->'variants') x);
      EXECUTE format(
        'UPDATE public.service_variants v SET (%s, is_active, replica_of_variant_id) =
           (SELECT %s, b.is_active, b.replica_of_variant_id FROM jsonb_populate_record(NULL::public.service_variants, x) b)
         FROM jsonb_array_elements($1) x
         WHERE v.id = (x->>''id'')::uuid AND v.service_item_id = $2',
        (SELECT string_agg(pg_catalog.quote_ident(c), ', ') FROM unnest(v_variant_cols) c),
        (SELECT string_agg('b.' || pg_catalog.quote_ident(c), ', ') FROM unnest(v_variant_cols) c))
      USING v_event.changes->'before'->'variants', (v_row->>'id')::uuid;

      -- Add-on links and form requirements, as they were.
      DELETE FROM public.service_addon_groups WHERE service_item_id = (v_row->>'id')::uuid;
      INSERT INTO public.service_addon_groups
      SELECT (jsonb_populate_record(NULL::public.service_addon_groups, x)).*
      FROM jsonb_array_elements(v_event.changes->'before'->'addon_links') x
      WHERE (x->>'service_item_id')::uuid = (v_row->>'id')::uuid
        AND EXISTS (SELECT 1 FROM public.addon_groups g WHERE g.id = (x->>'addon_group_id')::uuid);
      DELETE FROM public.service_compliance_requirements WHERE service_item_id = (v_row->>'id')::uuid;
      INSERT INTO public.service_compliance_requirements
      SELECT (jsonb_populate_record(NULL::public.service_compliance_requirements, x)).*
      FROM jsonb_array_elements(v_event.changes->'before'->'requirements') x
      WHERE (x->>'service_item_id')::uuid = (v_row->>'id')::uuid
        AND EXISTS (SELECT 1 FROM public.compliance_types t WHERE t.id = (x->>'compliance_type_id')::uuid);
    END LOOP;
  END LOOP;

  -- Masters: sync columns back; masters the migration created switched off (they have no bookings).
  SELECT e.changes->'before' INTO v_masters
  FROM public.collective_audit_events e
  WHERE e.collective_id = p_collective_id AND e.event_type = 'migration_applied'
    AND e.target_venue_id = v_collective.host_venue_id AND e.changes->'before' ? 'masters'
  ORDER BY e.created_at DESC LIMIT 1;
  UPDATE public.service_items s
  SET synced_from_service_id = (m->>'synced_from_service_id')::uuid, sync_state = m->>'sync_state',
      synced_at = (m->>'synced_at')::timestamptz
  FROM jsonb_array_elements(coalesce(v_masters->'masters', '[]'::jsonb)) m
  WHERE s.id = (m->>'id')::uuid;
  UPDATE public.service_items s
  SET staff_may_customize_name = (m->>'staff_may_customize_name')::boolean,
      staff_may_customize_description = (m->>'staff_may_customize_description')::boolean
  FROM jsonb_array_elements(coalesce(v_masters->'masters', '[]'::jsonb)) m
  WHERE s.id = (m->>'id')::uuid AND m ? 'staff_may_customize_name';
  UPDATE public.service_items s SET is_active = false
  FROM jsonb_array_elements(coalesce(v_masters->'created_masters', '[]'::jsonb)) c
  WHERE s.id = (c->>'service_id')::uuid
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_item_id = s.id);

  -- Offerings added at the switch archived, with the host copies made for them switched off.
  UPDATE public.service_items s SET is_active = false
  FROM jsonb_array_elements(coalesce(v_op.progress->'added_to_page', '[]'::jsonb)) a
  WHERE s.id = (a->>'master_service_id')::uuid
    AND NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.service_item_id = s.id);
  UPDATE public.collective_service_items i SET status = 'archived'
  FROM jsonb_array_elements(coalesce(v_op.progress->'added_to_page', '[]'::jsonb)) a
  WHERE i.id = (a->>'item_id')::uuid;
  -- The offerings as they were: names, masters (none on the older model) and skipped ones back on.
  UPDATE public.collective_service_items i
  SET name = b->>'name', status = b->>'status', master_service_id = nullif(b->>'master_service_id', '')::uuid
  FROM jsonb_array_elements(coalesce(v_op.progress->'items_before', '[]'::jsonb)) b
  WHERE i.id = (b->>'id')::uuid;

  UPDATE public.venue_collectives SET service_model = 'legacy_copies' WHERE id = p_collective_id;

  PERFORM public.collective_write_audit(
    p_collective_id, 'migration_rolled_back', NULL, p_actor_user_id,
    CASE WHEN p_actor_user_id IS NULL THEN 'collective-migrate' END,
    v_collective.host_venue_id, NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('service_model', 'legacy_copies', 'restored', v_restored,
                                                   'skipped', v_skipped)),
    NULL, p_now);

  UPDATE public.collective_operations
  SET status = 'done',
      progress = progress || jsonb_build_object('phase', 'rolled_back', 'rolled_back_at', p_now, 'skipped', v_skipped)
  WHERE id = v_op.id;

  RETURN jsonb_build_object('service_model', 'legacy_copies', 'restored', v_restored, 'skipped', v_skipped);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Entry points: the engine flag is on for exactly the call.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.collective_migration_begin(
  p_collective_id uuid,
  p_choices jsonb DEFAULT '{}'::jsonb,
  p_actor_user_id uuid DEFAULT NULL,
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
  v_result := public.collective_migration_begin_core(p_collective_id, coalesce(p_choices, '{}'::jsonb), p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_migration_finish(
  p_collective_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
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
  v_result := public.collective_migration_finish_core(p_collective_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_migration_rollback(
  p_collective_id uuid,
  p_restore_stale uuid[] DEFAULT NULL,
  p_actor_user_id uuid DEFAULT NULL,
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
  v_result := public.collective_migration_rollback_core(p_collective_id, p_restore_stale, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_migration_plan(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_option_map(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_begin_core(uuid, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_finish_core(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_rollback_core(uuid, uuid[], uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_begin(uuid, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_finish(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_migration_rollback(uuid, uuid[], uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_migration_plan(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_migration_begin(uuid, jsonb, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_migration_finish(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_migration_rollback(uuid, uuid[], uuid, timestamptz) TO service_role;
