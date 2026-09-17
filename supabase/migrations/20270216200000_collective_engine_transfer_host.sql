-- Collective engine, part 10: host transfer (Docs/collective-one-venue-plan.md §6.7, the lifecycle's
-- "transfer pending to active", Appendix D `collective_transfer_host`; PRICE-10, T22).
--
-- STILL DARK: refuses anything but a replicas-model collective.
--
-- collective_transfer_host(collective, new host N, actor venue, actor user, now), under the exclusive
-- collective lock:
--   * refuses COLLECTIVE_LINKS_BEHIND unless every live link is current (applied = desired and the
--     fingerprints agree) and N has a live replica of every active offering;
--   * snapshots the bookings of every master and of N's replicas first (PRICE-10);
--   * per active offering, with M the master at the old host H and R N's replica: the offering's
--     master becomes R; M's options are mapped to R's and every other member's options re-pointed from
--     M's to R's; N's link becomes H's link, replica M, provenance adopted;
--   * the library swaps sides: N's managed headings, add-on groups and forms become N's own, the H
--     objects they followed become managed and follow N's, and other members' mappings move from H's
--     objects to N's;
--   * the collective gets host N, the pending transfer and any pause are cleared, host_transferred
--     (and collective_resumed when it was paused) are audited, every live link is made due, the
--     revision bumped and the N22 notice queued.
--
-- One deliberate difference from Appendix D: it does not assert that every fingerprint still matches
-- after the re-keying. The new host's venue-wide forms apply to every collective service from the
-- moment of the transfer (D10), so a link can rightly be behind afterwards; every live link is made
-- due and the next applies converge it (the route runs them inline, the cron catches the rest).
-- The actor is the system, the old host, or N itself when N was offered the hosting or the collective
-- is paused (a take-over). The route authorises; the function re-checks.

CREATE OR REPLACE FUNCTION public.collective_transfer_host_core(
  p_collective_id uuid,
  p_new_host_venue_id uuid,
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
  v_collective public.venue_collectives%ROWTYPE;
  v_old_host uuid;
  v_new_member public.venue_collective_members%ROWTYPE;
  v_old_member public.venue_collective_members%ROWTYPE;
  v_job text := CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-verify' END;
  v_item record;
  v_pair record;
  v_items integer := 0;
  v_rekeyed integer := 0;
  v_was_paused boolean;
BEGIN
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id;
  IF NOT FOUND OR v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || p_collective_id::text, 0));
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = p_collective_id FOR UPDATE;
  v_old_host := v_collective.host_venue_id;
  v_was_paused := v_collective.paused_at IS NOT NULL;

  IF v_collective.status <> 'active' THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: the collective is not active';
  END IF;
  IF p_new_host_venue_id = v_old_host THEN
    RAISE EXCEPTION 'collective_transfer_host: that venue already hosts the collective';
  END IF;
  IF NOT (p_actor_venue_id IS NULL
          OR p_actor_venue_id = v_old_host
          OR (p_actor_venue_id = p_new_host_venue_id
              AND (v_collective.pending_host_venue_id = p_new_host_venue_id OR v_was_paused))) THEN
    RAISE EXCEPTION 'COLLECTIVE_NOT_HOST: only the host, or the venue offered the hosting, may move it';
  END IF;

  SELECT * INTO v_new_member FROM public.venue_collective_members
  WHERE collective_id = p_collective_id AND venue_id = p_new_host_venue_id AND status = 'active';
  IF v_new_member.id IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_VENUE_NOT_MEMBER: the new host is not an active member';
  END IF;
  SELECT * INTO v_old_member FROM public.venue_collective_members
  WHERE collective_id = p_collective_id AND venue_id = v_old_host AND status = 'active';
  IF v_old_member.id IS NULL THEN
    RAISE EXCEPTION 'collective_transfer_host: the old host has no active membership to carry its services';
  END IF;

  -- Every live link current, and N ready for every active offering.
  PERFORM 1 FROM public.collective_service_replicas l
  WHERE l.collective_id = p_collective_id AND l.released_at IS NULL
  ORDER BY l.id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.collective_service_replicas l
    WHERE l.collective_id = p_collective_id AND l.released_at IS NULL
      AND (l.applied_revision < l.desired_revision OR l.replica_service_id IS NULL
           OR public.collective_replica_fingerprint(l.id) IS DISTINCT FROM public.collective_expected_fingerprint(l.id))
  ) OR EXISTS (
    SELECT 1 FROM public.collective_service_items i
    WHERE i.collective_id = p_collective_id AND i.status = 'active' AND i.master_service_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.collective_service_replicas l
                      WHERE l.collective_service_item_id = i.id AND l.venue_id = p_new_host_venue_id
                        AND l.released_at IS NULL AND l.replica_service_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'COLLECTIVE_LINKS_BEHIND: every member''s copy must be up to date before the hosting moves';
  END IF;
  PERFORM public.collective_engine_test_point('after_membership_check');

  -- PRICE-10: bookings keep the price they were made at.
  UPDATE public.bookings b
  SET service_price_snapshot_pence = public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
  WHERE b.service_price_snapshot_pence IS NULL
    AND b.service_item_id IN (
      SELECT i.master_service_id FROM public.collective_service_items i
      WHERE i.collective_id = p_collective_id AND i.status = 'active' AND i.master_service_id IS NOT NULL
      UNION
      SELECT l.replica_service_id FROM public.collective_service_replicas l
      WHERE l.collective_id = p_collective_id AND l.venue_id = p_new_host_venue_id AND l.released_at IS NULL)
    AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;

  -- Offerings, options and links.
  FOR v_item IN
    SELECT i.id, i.master_service_id AS m, l.id AS link_id, l.replica_service_id AS r
    FROM public.collective_service_items i
    JOIN public.collective_service_replicas l
      ON l.collective_service_item_id = i.id AND l.venue_id = p_new_host_venue_id AND l.released_at IS NULL
    WHERE i.collective_id = p_collective_id AND i.status = 'active' AND i.master_service_id IS NOT NULL
    ORDER BY i.id
  LOOP
    FOR v_pair IN
      SELECT rv.id AS rv, rv.replica_of_variant_id AS mv FROM public.service_variants rv
      WHERE rv.service_item_id = v_item.r AND rv.replica_of_variant_id IS NOT NULL
      ORDER BY rv.id
    LOOP
      UPDATE public.service_variants SET replica_of_variant_id = v_pair.rv
      WHERE replica_of_variant_id = v_pair.mv AND id <> v_pair.rv;
      UPDATE public.service_variants SET replica_of_variant_id = NULL WHERE id = v_pair.rv;
      UPDATE public.service_variants SET replica_of_variant_id = v_pair.rv WHERE id = v_pair.mv;
      v_rekeyed := v_rekeyed + 1;
    END LOOP;

    UPDATE public.service_compliance_requirements SET replica_of_requirement_id = NULL
    WHERE service_item_id IN (v_item.r, v_item.m) AND replica_of_requirement_id IS NOT NULL;

    UPDATE public.collective_service_items SET master_service_id = v_item.r, updated_at = p_now WHERE id = v_item.id;
    UPDATE public.collective_service_replicas
    SET venue_id = v_old_host, member_id = v_old_member.id, replica_service_id = v_item.m, provenance = 'adopted',
        desired_revision = desired_revision + 1, applied_fingerprint = NULL, behind_since = p_now,
        attempts = 0, next_attempt_at = NULL, lease_until = NULL, last_error_code = NULL, last_error = NULL
    WHERE id = v_item.link_id;
    v_items := v_items + 1;
  END LOOP;

  -- Headings: N's managed ones become N's own; the H headings they followed become managed.
  FOR v_pair IN
    SELECT id AS n_obj, replica_of_category_id AS h_obj FROM public.service_categories
    WHERE venue_id = p_new_host_venue_id AND managed_by_collective_id = p_collective_id AND replica_of_category_id IS NOT NULL
    ORDER BY id
  LOOP
    UPDATE public.service_categories SET replica_of_category_id = v_pair.n_obj
    WHERE replica_of_category_id = v_pair.h_obj AND id <> v_pair.n_obj;
    UPDATE public.service_categories SET managed_by_collective_id = NULL, replica_of_category_id = NULL WHERE id = v_pair.n_obj;
    UPDATE public.service_categories SET managed_by_collective_id = p_collective_id, replica_of_category_id = v_pair.n_obj WHERE id = v_pair.h_obj;
    v_rekeyed := v_rekeyed + 1;
  END LOOP;

  -- Add-on groups; option pointers are rewritten by the next apply, which matches by position.
  FOR v_pair IN
    SELECT id AS n_obj, replica_of_addon_group_id AS h_obj FROM public.addon_groups
    WHERE venue_id = p_new_host_venue_id AND managed_by_collective_id = p_collective_id AND replica_of_addon_group_id IS NOT NULL
    ORDER BY id
  LOOP
    UPDATE public.addons SET replica_of_addon_id = NULL WHERE addon_group_id IN (v_pair.n_obj, v_pair.h_obj);
    UPDATE public.addon_groups SET replica_of_addon_group_id = v_pair.n_obj
    WHERE replica_of_addon_group_id = v_pair.h_obj AND id <> v_pair.n_obj;
    UPDATE public.addon_groups SET managed_by_collective_id = NULL, replica_of_addon_group_id = NULL WHERE id = v_pair.n_obj;
    UPDATE public.addon_groups SET managed_by_collective_id = p_collective_id, replica_of_addon_group_id = v_pair.n_obj WHERE id = v_pair.h_obj;
    v_rekeyed := v_rekeyed + 1;
  END LOOP;

  -- Forms; H's form counts its own records, and its current version follows N's.
  FOR v_pair IN
    SELECT id AS n_obj, replica_of_compliance_type_id AS h_obj, current_version_id AS n_version FROM public.compliance_types
    WHERE venue_id = p_new_host_venue_id AND managed_by_collective_id = p_collective_id AND replica_of_compliance_type_id IS NOT NULL
    ORDER BY id
  LOOP
    UPDATE public.compliance_type_versions SET replica_of_version_id = NULL
    WHERE compliance_type_id IN (v_pair.n_obj, v_pair.h_obj) AND replica_of_version_id IS NOT NULL;
    UPDATE public.compliance_types SET replica_of_compliance_type_id = v_pair.n_obj
    WHERE replica_of_compliance_type_id = v_pair.h_obj AND id <> v_pair.n_obj;
    UPDATE public.compliance_types SET managed_by_collective_id = NULL, replica_of_compliance_type_id = NULL WHERE id = v_pair.n_obj;
    UPDATE public.compliance_types
    SET managed_by_collective_id = p_collective_id, replica_of_compliance_type_id = v_pair.n_obj,
        accepts_records_from_type_id = coalesce(accepts_records_from_type_id, id)
    WHERE id = v_pair.h_obj;
    UPDATE public.compliance_type_versions v SET replica_of_version_id = v_pair.n_version
    FROM public.compliance_types t
    WHERE t.id = v_pair.h_obj AND v.id = t.current_version_id AND v_pair.n_version IS NOT NULL;
    v_rekeyed := v_rekeyed + 1;
  END LOOP;

  UPDATE public.venue_collectives
  SET host_venue_id = p_new_host_venue_id, pending_host_venue_id = NULL, host_transfer_at = NULL,
      paused_at = NULL, paused_reason = NULL
  WHERE id = p_collective_id;

  -- Every live link re-applies against its (possibly new) master.
  UPDATE public.collective_service_replicas
  SET desired_revision = desired_revision + 1, behind_since = coalesce(behind_since, p_now)
  WHERE collective_id = p_collective_id AND released_at IS NULL AND venue_id <> v_old_host;

  PERFORM public.collective_write_audit(
    p_collective_id, 'host_transferred', p_actor_venue_id, p_actor_user_id, v_job, p_new_host_venue_id,
    NULL, NULL, NULL, NULL,
    jsonb_build_object('before', jsonb_build_object('host_venue_id', v_old_host),
                       'after', jsonb_build_object('host_venue_id', p_new_host_venue_id, 'items', v_items, 'rekeyed', v_rekeyed)),
    NULL, p_now);
  IF v_was_paused THEN
    PERFORM public.collective_write_audit(
      p_collective_id, 'collective_resumed', p_actor_venue_id, p_actor_user_id, v_job, p_new_host_venue_id,
      NULL, NULL, NULL, NULL, jsonb_build_object('after', jsonb_build_object('reason', 'host_transferred')), NULL, p_now);
  END IF;
  PERFORM public.collective_bump_revision(p_collective_id, p_now);
  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (p_collective_id, p_new_host_venue_id, 'notice',
          'transfer:' || p_collective_id::text || ':' || p_new_host_venue_id::text || ':' || extract(epoch FROM p_now)::bigint::text,
          jsonb_build_object('notice', 'N22', 'old_host_venue_id', v_old_host))
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('items', v_items, 'links_rekeyed', v_rekeyed);
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_transfer_host(
  p_collective_id uuid,
  p_new_host_venue_id uuid,
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
  v_result := public.collective_transfer_host_core(p_collective_id, p_new_host_venue_id, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_transfer_host_core(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_transfer_host(uuid, uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_transfer_host(uuid, uuid, uuid, uuid, timestamptz) TO service_role;
