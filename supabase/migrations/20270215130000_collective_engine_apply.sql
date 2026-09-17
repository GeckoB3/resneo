-- Collective engine, part 1: projection, fingerprint, claim, apply, offer and withdraw, and the dirty
-- triggers for services, options and headings (Docs/collective-one-venue-plan.md §6.4, Appendix D).
--
-- STILL DARK. Everything here acts only on a collective with `service_model = 'replicas'`, and no
-- collective is on that model: the triggers exit at once for every existing venue, and nothing in
-- the application calls these functions yet.
--
-- Scope of this part: a replica's service row, its heading and its options. Add-on groups, forms and
-- requirements, the lock triggers, release, join, dissolve, transfer and undo follow in later parts;
-- the projection covers exactly what the apply writes, so the fingerprints agree part by part.
--
-- Conventions (Appendix D): SECURITY DEFINER, `SET search_path = ''` with every relation qualified,
-- writers take `SET lock_timeout = '2s'`, all revoked from client roles and granted to service_role only.
--
-- THE ENGINE FLAG IS SET AT RUN TIME, NOT IN THE FUNCTION DEFINITION. Appendix D writes
-- `SET resneo.collective_engine = 'on'` as a function-level clause, which Postgres restores on exit.
-- Hosted Supabase refuses that clause to the migration role ("permission denied to set parameter",
-- 42501, staging 2026-09-15): attaching a custom setting to a function needs a superuser. So each
-- engine entry point is a thin wrapper: it remembers the flag, turns it on with set_config(.., true),
-- calls the body (`*_core`), and puts the previous value back. If the body raises, the transaction
-- (or the caller's savepoint) rolls back, and a rollback restores the setting too, so the flag
-- cannot outlive the call either way. `src/lib/testing/migration-function-settings.test.ts` refuses the clause.

-- ===========================================================================
-- Helpers
-- ===========================================================================

-- The registry's columns of the given classes that the table actually has, in column order.
CREATE OR REPLACE FUNCTION public.collective_registry_columns(p_table text, p_classes text[])
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(a.attname::text ORDER BY a.attnum), ARRAY[]::text[])
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN public.collective_column_classes k ON k.table_name = c.relname AND k.column_name = a.attname
  WHERE n.nspname = 'public' AND c.relname = p_table AND a.attnum > 0 AND NOT a.attisdropped
    AND k.class = ANY (p_classes);
$$;

-- Turn the engine flag on for the rest of the call, returning what it was.
CREATE OR REPLACE FUNCTION public.collective_engine_enter()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prev text := coalesce(current_setting('resneo.collective_engine', true), '');
BEGIN
  PERFORM pg_catalog.set_config('resneo.collective_engine', 'on', true);
  RETURN v_prev;
END;
$$;

-- Put the flag back as it was before the call.
CREATE OR REPLACE FUNCTION public.collective_engine_leave(p_prev text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.set_config('resneo.collective_engine', coalesce(p_prev, ''), true);
END;
$$;

-- A named pause point for concurrency tests; a no-op in every real database.
CREATE OR REPLACE FUNCTION public.collective_engine_test_point(p_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_bump_revision(p_collective_id uuid, p_now timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.collective_catalogue_revisions (collective_id, bumped_at) VALUES (p_collective_id, p_now)
  ON CONFLICT (collective_id)
  DO UPDATE SET revision = public.collective_catalogue_revisions.revision + 1, bumped_at = p_now;
$$;

-- One audit row, with the actor classified the same way everywhere.
CREATE OR REPLACE FUNCTION public.collective_write_audit(
  p_collective_id uuid,
  p_event_type text,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_job text,
  p_target_venue_id uuid,
  p_item_id uuid,
  p_service_id uuid,
  p_replica_id uuid,
  p_revision bigint,
  p_changes jsonb,
  p_support_session_id uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_actor_type text;
BEGIN
  v_actor_type := CASE
    WHEN p_support_session_id IS NOT NULL THEN 'support'
    WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'system'
    ELSE 'venue_user'
  END;
  INSERT INTO public.collective_audit_events (
    collective_id, collective_name, event_type, actor_type, actor_venue_id, actor_venue_name,
    actor_user_id, support_session_id, system_job, target_venue_id, target_venue_name,
    item_id, service_id, replica_id, revision, changes, created_at
  )
  SELECT
    p_collective_id,
    coalesce((SELECT c.name FROM public.venue_collectives c WHERE c.id = p_collective_id), ''),
    p_event_type,
    v_actor_type,
    p_actor_venue_id,
    (SELECT v.name FROM public.venues v WHERE v.id = p_actor_venue_id),
    p_actor_user_id,
    p_support_session_id,
    CASE WHEN v_actor_type = 'system' THEN coalesce(p_job, 'inline') ELSE p_job END,
    p_target_venue_id,
    (SELECT v.name FROM public.venues v WHERE v.id = p_target_venue_id),
    p_item_id, p_service_id, p_replica_id, p_revision, p_changes, p_now
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ===========================================================================
-- Projection and fingerprints (Appendix D)
-- ===========================================================================

-- One side of a replica link as a document: the service's host columns and derived is_active, its
-- heading, and its options, keyed by master-side ids on both sides. Identity, venue and not_copied
-- columns never appear, so a member's own edits to venue columns are not drift.
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

  RETURN jsonb_build_object(
    'service', v_service,
    'heading', v_heading,
    'variants', coalesce(v_variants, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_replica_fingerprint(p_link_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT md5(public.collective_replica_projection(p_link_id, 'replica')::text) $$;

CREATE OR REPLACE FUNCTION public.collective_expected_fingerprint(p_link_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$ SELECT md5(public.collective_replica_projection(p_link_id, 'master')::text) $$;

-- ===========================================================================
-- Claim (the cron takes leases in its own transaction)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_claim_due_links(
  p_limit integer DEFAULT 50,
  p_lease interval DEFAULT interval '2 minutes',
  p_now timestamptz DEFAULT now()
)
RETURNS SETOF uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
  UPDATE public.collective_service_replicas SET lease_until = p_now + p_lease
  WHERE id IN (
    SELECT id FROM public.collective_service_replicas
    WHERE applied_revision < desired_revision AND released_at IS NULL
      AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)
      AND (lease_until IS NULL OR lease_until < p_now)
    ORDER BY id
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id;
$$;

-- ===========================================================================
-- Apply
-- ===========================================================================
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
  v_writes jsonb := jsonb_build_object('service_items', 0, 'service_categories', 0, 'service_variants', 0);
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


-- Entry point: the engine flag is on for exactly this call (see the header).
CREATE OR REPLACE FUNCTION public.collective_apply_replica(
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
AS $$
DECLARE
  v_prev text := public.collective_engine_enter();
  v_result jsonb;
BEGIN
  v_result := public.collective_apply_replica_core(p_link_id, p_actor_venue_id, p_actor_user_id, p_job, p_now, p_support_session_id);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

-- ===========================================================================
-- Offer and withdraw
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_offer_service_core(
  p_collective_id uuid,
  p_master_service_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_collective public.venue_collectives%ROWTYPE;
  v_master public.service_items%ROWTYPE;
  v_item_id uuid;
  v_reoffered boolean := false;
  v_member record;
  v_link_id uuid;
  v_links jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));

  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may offer a service';
  END IF;
  SELECT * INTO v_master FROM public.service_items WHERE id = p_master_service_id;
  IF NOT FOUND OR v_master.venue_id <> v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE: the service is not the host''s';
  END IF;
  PERFORM public.collective_engine_test_point('after_membership_check');

  SELECT id INTO v_item_id FROM public.collective_service_items
  WHERE collective_id = p_collective_id AND master_service_id = p_master_service_id AND status = 'active';
  IF v_item_id IS NULL THEN
    SELECT id INTO v_item_id FROM public.collective_service_items
    WHERE collective_id = p_collective_id AND master_service_id = p_master_service_id
    ORDER BY created_at DESC LIMIT 1;
    IF v_item_id IS NOT NULL THEN
      UPDATE public.collective_service_items SET status = 'active', updated_at = p_now WHERE id = v_item_id;
      v_reoffered := true;
    ELSE
      INSERT INTO public.collective_service_items (collective_id, name, status, master_service_id)
      VALUES (p_collective_id, v_master.name, 'active', p_master_service_id)
      RETURNING id INTO v_item_id;
    END IF;
  END IF;

  -- D29: one name and description everywhere for an offered service.
  UPDATE public.service_items
  SET staff_may_customize_name = false, staff_may_customize_description = false
  WHERE id = p_master_service_id AND (staff_may_customize_name OR staff_may_customize_description);
  IF FOUND THEN
    PERFORM public.collective_write_audit(p_collective_id, 'master_changed', p_actor_venue_id, p_actor_user_id,
      NULL, v_collective.host_venue_id, v_item_id, p_master_service_id, NULL, NULL,
      jsonb_build_object('before', jsonb_build_object('staff_may_customize_name', v_master.staff_may_customize_name,
                                                      'staff_may_customize_description', v_master.staff_may_customize_description),
                         'after', jsonb_build_object('staff_may_customize_name', false, 'staff_may_customize_description', false)),
      NULL, p_now);
  END IF;

  FOR v_member IN
    SELECT m.id, m.venue_id, v.name AS venue_name
    FROM public.venue_collective_members m JOIN public.venues v ON v.id = m.venue_id
    WHERE m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> v_collective.host_venue_id
    ORDER BY m.id
  LOOP
    SELECT id INTO v_link_id FROM public.collective_service_replicas
    WHERE collective_service_item_id = v_item_id AND venue_id = v_member.venue_id AND released_at IS NULL;
    IF v_link_id IS NULL THEN
      SELECT id INTO v_link_id FROM public.collective_service_replicas
      WHERE collective_service_item_id = v_item_id AND venue_id = v_member.venue_id AND released_at IS NOT NULL
      ORDER BY released_at DESC LIMIT 1;
      IF v_link_id IS NOT NULL THEN
        UPDATE public.collective_service_replicas
        SET released_at = NULL, provenance = 'reconnected', member_id = v_member.id,
            desired_revision = desired_revision + 1, applied_revision = 0, applied_fingerprint = NULL,
            behind_since = p_now, attempts = 0, next_attempt_at = NULL, lease_until = NULL
        WHERE id = v_link_id;
      ELSE
        INSERT INTO public.collective_service_replicas
          (collective_id, collective_service_item_id, member_id, venue_id, provenance, behind_since)
        VALUES (p_collective_id, v_item_id, v_member.id, v_member.venue_id, 'created', p_now)
        RETURNING id INTO v_link_id;
      END IF;
    END IF;
    v_links := v_links || jsonb_build_object('link_id', v_link_id, 'venue_id', v_member.venue_id, 'venue_name', v_member.venue_name);
  END LOOP;

  PERFORM public.collective_write_audit(p_collective_id, CASE WHEN v_reoffered THEN 'offering_reoffered' ELSE 'offering_added' END,
    p_actor_venue_id, p_actor_user_id, NULL, v_collective.host_venue_id, v_item_id, p_master_service_id, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('master_service_id', p_master_service_id, 'links', v_links)), NULL, p_now);
  PERFORM public.collective_bump_revision(p_collective_id, p_now);

  RETURN jsonb_build_object('item_id', v_item_id, 'reoffered', v_reoffered, 'links', v_links);
END;
$$;


-- Entry point: the engine flag is on for exactly this call (see the header).
CREATE OR REPLACE FUNCTION public.collective_offer_service(
  p_collective_id uuid,
  p_master_service_id uuid,
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
  v_result := public.collective_offer_service_core(p_collective_id, p_master_service_id, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_withdraw_service_core(
  p_item_id uuid,
  p_actor_venue_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_item public.collective_service_items%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_retired jsonb;
BEGIN
  SELECT * INTO v_item FROM public.collective_service_items WHERE id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: offering not found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || v_item.collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_item.collective_id;
  IF p_actor_venue_id IS DISTINCT FROM v_collective.host_venue_id THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host may withdraw a service';
  END IF;

  UPDATE public.collective_service_items SET status = 'archived', updated_at = p_now WHERE id = p_item_id;

  -- Every live link re-applies, which retires the replica (inactive); assignments are kept (D13).
  WITH l AS (
    SELECT id FROM public.collective_service_replicas
    WHERE collective_service_item_id = p_item_id AND released_at IS NULL
    ORDER BY id FOR UPDATE
  )
  UPDATE public.collective_service_replicas r
  SET desired_revision = r.desired_revision + 1, behind_since = coalesce(r.behind_since, p_now)
  FROM l WHERE r.id = l.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object('venue_id', r.venue_id, 'replica_service_id', r.replica_service_id) ORDER BY r.id), '[]'::jsonb)
    INTO v_retired
  FROM public.collective_service_replicas r
  WHERE r.collective_service_item_id = p_item_id AND r.released_at IS NULL;

  PERFORM public.collective_write_audit(v_item.collective_id, 'offering_withdrawn', p_actor_venue_id, p_actor_user_id,
    NULL, v_collective.host_venue_id, p_item_id, v_item.master_service_id, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('status', v_item.status)), NULL, p_now);
  PERFORM public.collective_bump_revision(v_item.collective_id, p_now);

  RETURN jsonb_build_object('item_id', p_item_id, 'retired', v_retired);
END;
$$;


-- Entry point: the engine flag is on for exactly this call (see the header).
CREATE OR REPLACE FUNCTION public.collective_withdraw_service(
  p_item_id uuid,
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
  v_result := public.collective_withdraw_service_core(p_item_id, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

-- ===========================================================================
-- Dirty triggers: a host write to a master, its options or its heading bumps every live link of the
-- offering, in the writer's own transaction, taking link rows in id order and never touching the
-- master again (§6.4 item 4). They skip under the engine flag (the engine bumps explicitly) and do
-- nothing for any venue without a live replicas-model offering.
-- ===========================================================================

-- Bump the live links of the given masters, in id order.
CREATE OR REPLACE FUNCTION public.collective_bump_links_for_masters(p_master_ids uuid[], p_now timestamptz DEFAULT now())
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH l AS (
    SELECT r.id
    FROM public.collective_service_replicas r
    JOIN public.collective_service_items i ON i.id = r.collective_service_item_id
    JOIN public.venue_collectives c ON c.id = r.collective_id
    WHERE r.released_at IS NULL
      AND i.status = 'active'
      AND i.master_service_id = ANY (p_master_ids)
      AND c.status = 'active' AND c.service_model IN ('migrating', 'replicas')
    ORDER BY r.id
    FOR UPDATE OF r
  )
  UPDATE public.collective_service_replicas r
  SET desired_revision = r.desired_revision + 1, behind_since = coalesce(r.behind_since, p_now)
  FROM l WHERE r.id = l.id;
$$;

CREATE OR REPLACE FUNCTION public.collective_dirty_service_items()
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
  -- An UPDATE that changes only presentation (sort_order) or bookkeeping (updated_at) is skipped.
  SELECT array_agg(DISTINCT n.id) INTO v_masters
  FROM new_rows n JOIN old_rows o ON o.id = n.id
  WHERE (to_jsonb(n) - 'sort_order' - 'updated_at') IS DISTINCT FROM (to_jsonb(o) - 'sort_order' - 'updated_at')
    AND EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = n.id AND i.status = 'active');
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_dirty_service_variants()
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
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.service_item_id) INTO v_masters FROM new_rows n
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = n.service_item_id AND i.status = 'active');
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.service_item_id) INTO v_masters FROM old_rows o
    WHERE EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = o.service_item_id AND i.status = 'active');
  ELSE
    SELECT array_agg(DISTINCT n.service_item_id) INTO v_masters
    FROM new_rows n JOIN old_rows o ON o.id = n.id
    WHERE (to_jsonb(n) - 'updated_at') IS DISTINCT FROM (to_jsonb(o) - 'updated_at')
      AND EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = n.service_item_id AND i.status = 'active');
  END IF;
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_dirty_service_categories()
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
  -- A renamed heading re-applies every offered master filed under it; the order alone does not.
  SELECT array_agg(DISTINCT s.id) INTO v_masters
  FROM new_rows n JOIN old_rows o ON o.id = n.id
  JOIN public.service_items s ON s.category_id = n.id
  WHERE n.name IS DISTINCT FROM o.name
    AND EXISTS (SELECT 1 FROM public.collective_service_items i WHERE i.master_service_id = s.id AND i.status = 'active');
  IF v_masters IS NOT NULL THEN
    PERFORM public.collective_bump_links_for_masters(v_masters);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_collective_dirty_service_items_upd ON public.service_items;
CREATE TRIGGER trg_collective_dirty_service_items_upd
  AFTER UPDATE ON public.service_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_items();

DROP TRIGGER IF EXISTS trg_collective_dirty_service_variants_ins ON public.service_variants;
CREATE TRIGGER trg_collective_dirty_service_variants_ins
  AFTER INSERT ON public.service_variants
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_variants();
DROP TRIGGER IF EXISTS trg_collective_dirty_service_variants_upd ON public.service_variants;
CREATE TRIGGER trg_collective_dirty_service_variants_upd
  AFTER UPDATE ON public.service_variants
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_variants();
DROP TRIGGER IF EXISTS trg_collective_dirty_service_variants_del ON public.service_variants;
CREATE TRIGGER trg_collective_dirty_service_variants_del
  AFTER DELETE ON public.service_variants
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_variants();

DROP TRIGGER IF EXISTS trg_collective_dirty_service_categories_upd ON public.service_categories;
CREATE TRIGGER trg_collective_dirty_service_categories_upd
  AFTER UPDATE ON public.service_categories
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.collective_dirty_service_categories();

-- ===========================================================================
-- Deleting a master option or heading that replicas still point at (RT2-4). The replica pointers
-- are ON DELETE NO ACTION, so without this the host could not delete them at all. The replica
-- option is deactivated, never deleted (bookings reference it); a managed heading goes back to
-- being the member's own. The dirty triggers then re-apply the offering.
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
  END IF;
  PERFORM public.collective_engine_leave(v_prev);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_before_delete_master_child()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.collective_release_child_pointers(TG_TABLE_NAME, OLD.id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_collective_release_variant_pointers ON public.service_variants;
CREATE TRIGGER trg_collective_release_variant_pointers
  BEFORE DELETE ON public.service_variants
  FOR EACH ROW EXECUTE FUNCTION public.collective_before_delete_master_child();
DROP TRIGGER IF EXISTS trg_collective_release_category_pointers ON public.service_categories;
CREATE TRIGGER trg_collective_release_category_pointers
  BEFORE DELETE ON public.service_categories
  FOR EACH ROW EXECUTE FUNCTION public.collective_before_delete_master_child();

-- ===========================================================================
-- Grants: service role only.
-- ===========================================================================
REVOKE ALL ON FUNCTION public.collective_registry_columns(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_engine_enter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_engine_leave(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_apply_replica_core(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_offer_service_core(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_withdraw_service_core(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_engine_test_point(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_bump_revision(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_write_audit(uuid, text, uuid, uuid, text, uuid, uuid, uuid, uuid, bigint, jsonb, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_replica_projection(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_replica_fingerprint(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_expected_fingerprint(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_claim_due_links(integer, interval, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_apply_replica(uuid, uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_offer_service(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_withdraw_service(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_bump_links_for_masters(uuid[], timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_release_child_pointers(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dirty_service_items() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dirty_service_variants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_dirty_service_categories() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_before_delete_master_child() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.collective_replica_projection(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_replica_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_expected_fingerprint(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_claim_due_links(integer, interval, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_apply_replica(uuid, uuid, uuid, text, timestamptz, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_offer_service(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_withdraw_service(uuid, uuid, uuid, timestamptz) TO service_role;
