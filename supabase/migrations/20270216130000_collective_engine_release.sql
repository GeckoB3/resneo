-- Collective engine, part 5: the release (Docs/collective-one-venue-plan.md §6.7 "Leave, removal",
-- the lifecycle's "The release", Appendix D `collective_release_member`; RT1-4, RT2-9, D41, D52).
--
-- STILL DARK: the release acts only on a migrating or replicas-model collective. On today's
-- legacy_copies collectives it returns at once, before taking any lock, so the existing leave and
-- remove routes behave exactly as they did.
--
-- When a membership stops being active, in one transaction:
--   * the member's replica links get released_at (kept: a re-join reconnects them) and the locks lift;
--   * the member's managed headings, add-on groups and forms become its own, and every replica_of_*
--     pointer at the venue for this collective is cleared; accepts_records_from_type_id is kept;
--   * every released service stays exactly as it is (D52), active or retired;
--   * released services that take payment are set to no online payment when the venue cannot take
--     charges (RT2-9), each audited as payment_rule_downgraded with the old rule;
--   * the collective's adoption of this venue's address is cleared;
--   * legacy provider rows for the membership are marked removed;
--   * two member_released audit rows, a revision bump, and one release_followup job for the work
--     after commit (photos, review checklist, notices).
-- No account_links row is ever written (D41).
--
-- The host's own membership ending (a link change) pauses the collective instead of releasing
-- anything; the members stay locked and in step. Dissolve, built later, releases the host with
-- reason 'dissolved'.
--
-- The function is idempotent: a membership already released returns zeros and writes nothing. It
-- runs from the new status trigger whenever a writer other than the engine moves a membership out
-- of active, and engine lifecycle functions call it directly.

CREATE OR REPLACE FUNCTION public.collective_release_member_core(
  p_member_id uuid,
  p_reason text,
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
  v_member public.venue_collective_members%ROWTYPE;
  v_collective public.venue_collectives%ROWTYPE;
  v_job text := CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-release' END;
  v_status_changed boolean := false;
  v_released integer := 0;
  v_services uuid[];
  v_downgraded uuid[] := ARRAY[]::uuid[];
  v_unparked uuid[];
  v_other integer := 0;
  v_n integer;
  v_op uuid;
  r record;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('left', 'removed', 'link_ended', 'suspended_expired', 'dissolved', 'venue_deleted') THEN
    RAISE EXCEPTION 'collective_release_member: unknown reason %', p_reason;
  END IF;

  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('links_released', 0, 'unparked', '[]'::jsonb, 'downgraded', '[]'::jsonb, 'operation_id', NULL);
  END IF;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id;
  IF NOT FOUND OR v_collective.service_model NOT IN ('migrating', 'replicas') THEN
    RETURN jsonb_build_object('links_released', 0, 'unparked', '[]'::jsonb, 'downgraded', '[]'::jsonb,
                              'operation_id', NULL, 'skipped', 'legacy_model');
  END IF;

  -- Exclusive collective lock, then re-read under it.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('collective:' || v_member.collective_id::text, 0));
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id FOR UPDATE;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id FOR UPDATE;

  -- The host leaving outside a dissolve pauses the collective; nothing is released.
  IF v_member.venue_id = v_collective.host_venue_id AND p_reason <> 'dissolved' THEN
    IF v_collective.status = 'active' AND v_collective.paused_at IS NULL THEN
      UPDATE public.venue_collectives SET paused_at = p_now, paused_reason = 'host_left' WHERE id = v_collective.id;
      PERFORM public.collective_write_audit(
        v_collective.id, 'collective_paused', p_actor_venue_id, p_actor_user_id, v_job, v_member.venue_id,
        NULL, NULL, NULL, NULL, jsonb_build_object('after', jsonb_build_object('paused_reason', 'host_left', 'reason', p_reason)),
        NULL, p_now);
      PERFORM public.collective_bump_revision(v_collective.id, p_now);
      INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
      VALUES (v_collective.id, v_member.venue_id, 'notice', 'pause:' || p_member_id::text,
              jsonb_build_object('notice', 'N23', 'reason', p_reason))
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('links_released', 0, 'unparked', '[]'::jsonb, 'downgraded', '[]'::jsonb,
                              'operation_id', NULL, 'paused', true);
  END IF;

  -- (1) status and left_at, unless the writer that fired the trigger already moved it.
  IF v_member.status = 'active' THEN
    UPDATE public.venue_collective_members
    SET status = CASE WHEN p_reason IN ('left', 'dissolved') THEN 'left' ELSE 'removed' END,
        left_at = coalesce(left_at, p_now)
    WHERE id = p_member_id;
    v_status_changed := true;
  ELSIF v_member.left_at IS NULL THEN
    UPDATE public.venue_collective_members SET left_at = p_now WHERE id = p_member_id;
  END IF;

  -- (2) release the live links; the locks lift by absence.
  UPDATE public.collective_service_replicas
  SET released_at = p_now, lease_until = NULL
  WHERE member_id = p_member_id AND released_at IS NULL;
  GET DIAGNOSTICS v_released = ROW_COUNT;

  SELECT coalesce(array_agg(replica_service_id ORDER BY replica_service_id), ARRAY[]::uuid[]) INTO v_services
  FROM public.collective_service_replicas
  WHERE member_id = p_member_id AND replica_service_id IS NOT NULL;

  -- (3) the library becomes the member's own; children before their parents lose the marker.
  UPDATE public.service_variants SET replica_of_variant_id = NULL
  WHERE service_item_id = ANY (v_services) AND replica_of_variant_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.service_compliance_requirements SET replica_of_requirement_id = NULL
  WHERE service_item_id = ANY (v_services) AND replica_of_requirement_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.addons a SET replica_of_addon_id = NULL
  FROM public.addon_groups g
  WHERE g.id = a.addon_group_id AND g.venue_id = v_member.venue_id AND g.managed_by_collective_id = v_collective.id
    AND a.replica_of_addon_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.addon_groups SET managed_by_collective_id = NULL, replica_of_addon_group_id = NULL
  WHERE venue_id = v_member.venue_id AND managed_by_collective_id = v_collective.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.compliance_type_versions v SET replica_of_version_id = NULL
  FROM public.compliance_types t
  WHERE t.id = v.compliance_type_id AND t.venue_id = v_member.venue_id AND t.managed_by_collective_id = v_collective.id
    AND v.replica_of_version_id IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.compliance_types SET managed_by_collective_id = NULL, replica_of_compliance_type_id = NULL
  WHERE venue_id = v_member.venue_id AND managed_by_collective_id = v_collective.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;
  UPDATE public.service_categories SET managed_by_collective_id = NULL, replica_of_category_id = NULL
  WHERE venue_id = v_member.venue_id AND managed_by_collective_id = v_collective.id;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;

  -- (4) the address is no longer adopted from a venue that left.
  IF v_collective.adopted_venue_id = v_member.venue_id THEN
    UPDATE public.venue_collectives SET slug_strategy = 'dedicated', adopted_venue_id = NULL WHERE id = v_collective.id;
    v_other := v_other + 1;
  END IF;

  -- (5) RT2-9: a released paid service is never left at checkout-failing terms.
  IF NOT coalesce((SELECT stripe_charges_enabled FROM public.venues WHERE id = v_member.venue_id), false) THEN
    FOR r IN
      SELECT id, payment_requirement::text AS payment_requirement, deposit_pence
      FROM public.service_items
      WHERE id = ANY (v_services) AND payment_requirement <> 'none'
      ORDER BY id
    LOOP
      UPDATE public.service_items SET payment_requirement = 'none' WHERE id = r.id;
      PERFORM public.collective_write_audit(
        v_collective.id, 'payment_rule_downgraded', p_actor_venue_id, p_actor_user_id, v_job, v_member.venue_id,
        NULL, r.id, NULL, NULL,
        jsonb_build_object('before', jsonb_build_object('payment_requirement', r.payment_requirement, 'deposit_pence', r.deposit_pence),
                           'after', jsonb_build_object('payment_requirement', 'none')),
        NULL, p_now);
      v_downgraded := v_downgraded || r.id;
    END LOOP;
  END IF;

  -- (6) legacy provider rows, while that table exists.
  UPDATE public.collective_service_providers SET status = 'removed'
  WHERE member_id = p_member_id AND status <> 'removed';
  GET DIAGNOSTICS v_n = ROW_COUNT; v_other := v_other + v_n;

  IF NOT v_status_changed AND v_released = 0 AND v_other = 0 AND cardinality(v_downgraded) = 0 THEN
    RETURN jsonb_build_object('links_released', 0, 'unparked', '[]'::jsonb, 'downgraded', '[]'::jsonb,
                              'operation_id', (SELECT id FROM public.collective_operations WHERE idempotency_key = 'release:' || p_member_id::text));
  END IF;

  -- The member's services that were not on the page, now bookable on its own page (DL3).
  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_unparked
  FROM public.service_items
  WHERE venue_id = v_member.venue_id AND is_active AND NOT (id = ANY (v_services));

  -- (7) audit both sides, bump, queue the follow-up.
  PERFORM public.collective_write_audit(
    v_collective.id, 'member_released', p_actor_venue_id, p_actor_user_id, v_job, v_member.venue_id,
    NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('reason', p_reason, 'side', 'member', 'links_released', v_released,
                                                   'services', to_jsonb(v_services), 'downgraded', to_jsonb(v_downgraded),
                                                   'unparked', to_jsonb(v_unparked))),
    NULL, p_now);
  PERFORM public.collective_write_audit(
    v_collective.id, 'member_released', p_actor_venue_id, p_actor_user_id, v_job, v_collective.host_venue_id,
    NULL, NULL, NULL, NULL,
    jsonb_build_object('after', jsonb_build_object('reason', p_reason, 'side', 'host', 'member_venue_id', v_member.venue_id,
                                                   'links_released', v_released)),
    NULL, p_now);
  PERFORM public.collective_bump_revision(v_collective.id, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (v_collective.id, v_member.venue_id, 'release_followup', 'release:' || p_member_id::text,
          jsonb_build_object('reason', p_reason, 'services', to_jsonb(v_services)))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_op;
  IF v_op IS NULL THEN
    SELECT id INTO v_op FROM public.collective_operations WHERE idempotency_key = 'release:' || p_member_id::text;
  END IF;

  RETURN jsonb_build_object('links_released', v_released, 'unparked', to_jsonb(v_unparked),
                            'downgraded', to_jsonb(v_downgraded), 'operation_id', v_op);
END;
$$;

-- Entry point: the engine flag is on for exactly this call (20270215130000's header).
CREATE OR REPLACE FUNCTION public.collective_release_member(
  p_member_id uuid,
  p_reason text,
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
  v_result := public.collective_release_member_core(p_member_id, p_reason, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

-- ===========================================================================
-- A membership leaving active through any writer other than the engine runs the release (RT1-4).
-- Under the flag, the engine function that made the write runs it itself.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.collective_member_status_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('resneo.collective_engine', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM public.collective_release_member(NEW.id, CASE NEW.status WHEN 'left' THEN 'left' ELSE 'removed' END, NULL, NULL, now());
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_venue_collective_members_status_release ON public.venue_collective_members;
CREATE TRIGGER trg_venue_collective_members_status_release
  AFTER UPDATE OF status ON public.venue_collective_members
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status <> 'active')
  EXECUTE FUNCTION public.collective_member_status_release();

REVOKE ALL ON FUNCTION public.collective_release_member_core(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_release_member(uuid, text, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_member_status_release() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_release_member(uuid, text, uuid, uuid, timestamptz) TO service_role;
