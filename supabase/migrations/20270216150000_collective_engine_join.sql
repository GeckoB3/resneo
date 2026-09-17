-- Collective engine, part 7: join (Docs/collective-one-venue-plan.md §6.7 "Accept (join)", the
-- lifecycle's "invited to active", Appendix D `collective_join_member`, Appendix E contract 6;
-- RT1-11, RT2-20, RT2-27, DL5, DL6, D41, PRICE-10).
--
-- STILL DARK: refuses anything but a replicas-model collective with COLLECTIVE_LEGACY_MODEL, so
-- today's accept route keeps its own path.
--
-- collective_join_member(member, consent_version, choices, actor venue, actor user, now):
--   * re-checks under the collective lock what the invite checked: the venue is in no other live
--     collective, shares the host's timezone, currency and booking model, and holds the full
--     account-link mesh (accepted, full details, create/edit/cancel, no calendar limit) with every
--     active member. Nothing is created or changed in account_links (D41, DL6). The route checks the
--     same conditions first and answers in plain words; a refusal here is a race and surfaces as 500.
--   * an invited row becomes active with joined_at and the consent; an active row (the adoption
--     answer route reusing the function) only has the choices given applied.
--   * for each active offering: "use mine" adopts the member's own service as the replica
--     (provenance adopted, options mapped, that service's bookings snapshotted first, PRICE-10); a
--     released link from an earlier membership whose service has not changed since the release is
--     reconnected (RT2-27); a changed one needs the member's answer (DL5), so without "use mine" it
--     gets a new link instead; otherwise a new link, created on the first apply. New links start
--     behind (RT1-11).
--   * form choices: "use existing" makes the member's form the managed target now, so the first apply
--     adopts it and the member's records keep counting; "use theirs" leaves the apply to create one.
--   * member-only services: "ask" records suggestion_made (the route sends N28); "park" writes
--     nothing, because parking is derived.
--   * member_joined and one adoption_answered per adoption are audited, the revision bumped, and
--     the join job queued ('join:' || member id).
--
-- collective_join_blocker(collective, venue) returns the first failing check's name, or NULL; the
-- invariant report reuses it.

CREATE OR REPLACE FUNCTION public.collective_join_blocker(p_collective_id uuid, p_venue_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_host public.venues%ROWTYPE;
  v_venue public.venues%ROWTYPE;
BEGIN
  SELECT h.* INTO v_host FROM public.venue_collectives c JOIN public.venues h ON h.id = c.host_venue_id
  WHERE c.id = p_collective_id;
  SELECT * INTO v_venue FROM public.venues WHERE id = p_venue_id;
  IF v_host.id IS NULL OR v_venue.id IS NULL THEN
    RETURN 'not_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.venue_collective_members m JOIN public.venue_collectives c ON c.id = m.collective_id
    WHERE m.venue_id = p_venue_id AND m.status = 'active' AND c.status = 'active' AND m.collective_id <> p_collective_id
  ) THEN
    RETURN 'exclusivity';
  END IF;
  IF coalesce(v_venue.timezone, 'Europe/London') IS DISTINCT FROM coalesce(v_host.timezone, 'Europe/London') THEN
    RETURN 'timezone';
  END IF;
  IF v_venue.currency IS DISTINCT FROM v_host.currency THEN
    RETURN 'currency';
  END IF;
  IF v_venue.booking_model IS DISTINCT FROM v_host.booking_model THEN
    RETURN 'booking_model';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.venue_collective_members m
    WHERE m.collective_id = p_collective_id AND m.status = 'active' AND m.venue_id <> p_venue_id
      AND NOT EXISTS (
        SELECT 1 FROM public.account_links al
        WHERE al.venue_low_id = LEAST(m.venue_id, p_venue_id)
          AND al.venue_high_id = GREATEST(m.venue_id, p_venue_id)
          AND al.status = 'accepted'
          AND al.low_grants_calendar = 'full_details' AND al.high_grants_calendar = 'full_details'
          AND al.low_grants_act = 'create_edit_cancel' AND al.high_grants_act = 'create_edit_cancel'
          AND al.low_grants_calendar_ids IS NULL AND al.high_grants_calendar_ids IS NULL
      )
  ) THEN
    RETURN 'mesh';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.collective_join_member_core(
  p_member_id uuid,
  p_consent_version text,
  p_choices jsonb,
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
  v_joining boolean;
  v_blocker text;
  v_item record;
  v_choice jsonb;
  v_mine public.service_items%ROWTYPE;
  v_link_id uuid;
  v_released record;
  v_provenance text;
  v_links jsonb := '[]'::jsonb;
  v_map jsonb;
  v_form jsonb;
  v_own jsonb;
  v_type public.compliance_types%ROWTYPE;
  v_op uuid;
BEGIN
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'collective_join_member: membership not found';
  END IF;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id;
  IF v_collective.service_model <> 'replicas' THEN
    RAISE EXCEPTION 'COLLECTIVE_LEGACY_MODEL: the collective is not on the replicas model';
  END IF;
  IF p_actor_venue_id IS NOT NULL AND p_actor_venue_id IS DISTINCT FROM v_member.venue_id THEN
    RAISE EXCEPTION 'collective_join_member: only the invited venue may accept';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('collective:' || v_member.collective_id::text, 0));
  SELECT * INTO v_member FROM public.venue_collective_members WHERE id = p_member_id FOR UPDATE;
  SELECT * INTO v_collective FROM public.venue_collectives WHERE id = v_member.collective_id;

  IF v_member.status NOT IN ('invited', 'active') THEN
    RAISE EXCEPTION 'collective_join_member: the invitation is no longer open';
  END IF;
  IF v_collective.status <> 'active' OR v_collective.paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'collective_join_member: the collective is not taking members';
  END IF;
  v_joining := v_member.status = 'invited';
  IF v_joining AND nullif(btrim(coalesce(p_consent_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'collective_join_member: consent is required (COLLECTIVE_CONSENT_REQUIRED is answered by the route)';
  END IF;

  IF v_joining THEN
    v_blocker := public.collective_join_blocker(v_member.collective_id, v_member.venue_id);
    IF v_blocker IS NOT NULL THEN
      RAISE EXCEPTION 'collective_join_member: the venue cannot join (%)', v_blocker;
    END IF;
  END IF;
  PERFORM public.collective_engine_test_point('after_membership_check');

  IF v_joining THEN
    UPDATE public.venue_collective_members
    SET status = 'active', joined_at = p_now, left_at = NULL, consent_version = p_consent_version,
        consented_at = p_now, consented_by_user_id = p_actor_user_id
    WHERE id = p_member_id;
  END IF;

  -- Offerings. The host has no links to its own masters.
  IF v_member.venue_id <> v_collective.host_venue_id THEN
    FOR v_item IN
      SELECT i.id, i.master_service_id FROM public.collective_service_items i
      WHERE i.collective_id = v_collective.id AND i.status = 'active' AND i.master_service_id IS NOT NULL
      ORDER BY i.id
    LOOP
      SELECT c INTO v_choice FROM jsonb_array_elements(coalesce(p_choices->'same_name_choices', '[]'::jsonb)) c
      WHERE c->>'item_id' = v_item.id::text LIMIT 1;

      SELECT id INTO v_link_id FROM public.collective_service_replicas
      WHERE collective_service_item_id = v_item.id AND venue_id = v_member.venue_id AND released_at IS NULL;

      IF v_choice->>'choice' = 'use_mine' THEN
        SELECT * INTO v_mine FROM public.service_items WHERE id = (v_choice->>'my_service_id')::uuid;
        IF v_mine.id IS NULL OR v_mine.venue_id <> v_member.venue_id THEN
          RAISE EXCEPTION 'collective_join_member: the service to use is not the venue''s own';
        END IF;
        IF EXISTS (SELECT 1 FROM public.collective_service_replicas
                   WHERE replica_service_id = v_mine.id AND released_at IS NULL AND id IS DISTINCT FROM v_link_id) THEN
          RAISE EXCEPTION 'collective_join_member: that service already follows another offering';
        END IF;
        IF v_link_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.collective_service_replicas
                                             WHERE id = v_link_id AND replica_service_id IS NOT NULL) THEN
          RAISE EXCEPTION 'collective_join_member: this offering already has a service at the venue';
        END IF;

        -- PRICE-10: the bookings keep the price they were made at before the apply converges it.
        UPDATE public.bookings b
        SET service_price_snapshot_pence = public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
        WHERE b.service_item_id = v_mine.id AND b.service_price_snapshot_pence IS NULL
          AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;

        -- Options: the member's option to the host's, where the host's belongs to the master.
        FOR v_map IN SELECT m FROM jsonb_array_elements(coalesce(v_choice->'option_map', '[]'::jsonb)) m LOOP
          UPDATE public.service_variants mv
          SET replica_of_variant_id = hv.id
          FROM public.service_variants hv
          WHERE mv.id = (v_map->>'my_variant_id')::uuid AND mv.service_item_id = v_mine.id
            AND hv.id = nullif(v_map->>'host_variant_id', '')::uuid AND hv.service_item_id = v_item.master_service_id;
        END LOOP;

        IF v_link_id IS NULL THEN
          INSERT INTO public.collective_service_replicas
            (collective_id, collective_service_item_id, member_id, venue_id, replica_service_id, provenance, behind_since)
          VALUES (v_collective.id, v_item.id, p_member_id, v_member.venue_id, v_mine.id, 'adopted', p_now)
          RETURNING id INTO v_link_id;
        ELSE
          UPDATE public.collective_service_replicas
          SET replica_service_id = v_mine.id, provenance = 'adopted', desired_revision = desired_revision + 1,
              behind_since = coalesce(behind_since, p_now)
          WHERE id = v_link_id;
        END IF;
        v_provenance := 'adopted';
        PERFORM public.collective_write_audit(
          v_collective.id, 'adoption_answered', p_actor_venue_id, p_actor_user_id,
          CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-join' END,
          v_member.venue_id, v_item.id, v_mine.id, v_link_id, NULL,
          jsonb_build_object('after', jsonb_build_object('choice', 'use_mine', 'my_service_id', v_mine.id,
                                                         'option_map', coalesce(v_choice->'option_map', '[]'::jsonb))),
          NULL, p_now);
      ELSIF v_link_id IS NOT NULL THEN
        v_provenance := NULL;  -- already live: an active membership re-running choices
      ELSE
        -- A released link from an earlier membership, reconnected only when its service is unchanged (DL5).
        SELECT l.id, l.replica_service_id, l.released_at, s.updated_at INTO v_released
        FROM public.collective_service_replicas l
        LEFT JOIN public.service_items s ON s.id = l.replica_service_id
        WHERE l.collective_service_item_id = v_item.id AND l.venue_id = v_member.venue_id AND l.released_at IS NOT NULL
        ORDER BY l.released_at DESC
        LIMIT 1;
        IF v_released.id IS NOT NULL AND v_released.replica_service_id IS NOT NULL
           AND v_released.updated_at <= v_released.released_at
           AND NOT EXISTS (SELECT 1 FROM public.collective_service_replicas
                           WHERE replica_service_id = v_released.replica_service_id AND released_at IS NULL) THEN
          UPDATE public.bookings b
          SET service_price_snapshot_pence = public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id)
          WHERE b.service_item_id = v_released.replica_service_id AND b.service_price_snapshot_pence IS NULL
            AND public.booking_service_price_pence(b.service_item_id, b.service_variant_id, b.calendar_id) IS NOT NULL;
          UPDATE public.collective_service_replicas
          SET released_at = NULL, provenance = 'reconnected', member_id = p_member_id,
              desired_revision = desired_revision + 1, applied_revision = 0, applied_fingerprint = NULL,
              behind_since = p_now, attempts = 0, next_attempt_at = NULL, lease_until = NULL,
              last_error_code = NULL, last_error = NULL
          WHERE id = v_released.id;
          v_link_id := v_released.id;
          v_provenance := 'reconnected';
        ELSE
          INSERT INTO public.collective_service_replicas
            (collective_id, collective_service_item_id, member_id, venue_id, provenance, behind_since)
          VALUES (v_collective.id, v_item.id, p_member_id, v_member.venue_id, 'created', p_now)
          RETURNING id INTO v_link_id;
          v_provenance := 'created';
        END IF;
      END IF;

      IF v_provenance IS NOT NULL THEN
        v_links := v_links || jsonb_build_object('link_id', v_link_id, 'item_id', v_item.id, 'provenance', v_provenance);
      END IF;
    END LOOP;
  END IF;

  -- Forms the member already holds become the managed target now.
  FOR v_form IN SELECT f FROM jsonb_array_elements(coalesce(p_choices->'form_choices', '[]'::jsonb)) f LOOP
    CONTINUE WHEN v_form->>'choice' IS DISTINCT FROM 'use_existing';
    SELECT * INTO v_type FROM public.compliance_types WHERE id = (v_form->>'my_type_id')::uuid;
    IF v_type.id IS NULL OR v_type.venue_id <> v_member.venue_id
       OR (v_type.managed_by_collective_id IS NOT NULL AND v_type.managed_by_collective_id <> v_collective.id) THEN
      RAISE EXCEPTION 'collective_join_member: the form to use is not the venue''s own';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.compliance_types
                   WHERE id = (v_form->>'host_type_id')::uuid AND venue_id = v_collective.host_venue_id) THEN
      RAISE EXCEPTION 'collective_join_member: the host form is not the host''s';
    END IF;
    UPDATE public.compliance_types
    SET managed_by_collective_id = v_collective.id,
        replica_of_compliance_type_id = (v_form->>'host_type_id')::uuid,
        accepts_records_from_type_id = coalesce(accepts_records_from_type_id, id),
        is_active = true, archived_at = NULL
    WHERE id = v_type.id;
    PERFORM public.collective_write_audit(
      v_collective.id, 'adoption_answered', p_actor_venue_id, p_actor_user_id,
      CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-join' END,
      v_member.venue_id, NULL, NULL, NULL, NULL,
      jsonb_build_object('after', jsonb_build_object('choice', 'use_existing', 'my_type_id', v_type.id,
                                                     'host_type_id', v_form->>'host_type_id')),
      NULL, p_now);
  END LOOP;

  -- Member-only services the member asks the host to add.
  FOR v_own IN SELECT o FROM jsonb_array_elements(coalesce(p_choices->'own_service_choices', '[]'::jsonb)) o LOOP
    CONTINUE WHEN v_own->>'choice' IS DISTINCT FROM 'ask';
    IF NOT EXISTS (SELECT 1 FROM public.service_items WHERE id = (v_own->>'service_id')::uuid AND venue_id = v_member.venue_id) THEN
      RAISE EXCEPTION 'collective_join_member: the service to suggest is not the venue''s own';
    END IF;
    PERFORM public.collective_write_audit(
      v_collective.id, 'suggestion_made', p_actor_venue_id, p_actor_user_id,
      CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-join' END,
      v_collective.host_venue_id, NULL, (v_own->>'service_id')::uuid, NULL, NULL,
      jsonb_build_object('after', jsonb_build_object('from_venue_id', v_member.venue_id, 'service_id', v_own->>'service_id')),
      NULL, p_now);
  END LOOP;

  IF v_joining THEN
    PERFORM public.collective_write_audit(
      v_collective.id, 'member_joined', p_actor_venue_id, p_actor_user_id,
      CASE WHEN p_actor_venue_id IS NULL AND p_actor_user_id IS NULL THEN 'collective-join' END,
      v_member.venue_id, NULL, NULL, NULL, NULL,
      jsonb_build_object('after', jsonb_build_object('consent_version', p_consent_version, 'choices', coalesce(p_choices, '{}'::jsonb),
                                                     'links', v_links)),
      NULL, p_now);
  END IF;
  PERFORM public.collective_bump_revision(v_collective.id, p_now);

  INSERT INTO public.collective_operations (collective_id, venue_id, kind, idempotency_key, progress)
  VALUES (v_collective.id, v_member.venue_id, 'join', 'join:' || p_member_id::text, jsonb_build_object('links', v_links))
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_op;
  IF v_op IS NULL THEN
    SELECT id INTO v_op FROM public.collective_operations WHERE idempotency_key = 'join:' || p_member_id::text;
  END IF;

  RETURN jsonb_build_object('links', v_links, 'operation_id', v_op);
END;
$$;

-- Entry point: the engine flag is on for exactly this call (20270215130000's header).
CREATE OR REPLACE FUNCTION public.collective_join_member(
  p_member_id uuid,
  p_consent_version text,
  p_choices jsonb,
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
  v_result := public.collective_join_member_core(p_member_id, p_consent_version, p_choices, p_actor_venue_id, p_actor_user_id, p_now);
  PERFORM public.collective_engine_leave(v_prev);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.collective_join_blocker(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_join_member_core(uuid, text, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.collective_join_member(uuid, text, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collective_join_blocker(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.collective_join_member(uuid, text, jsonb, uuid, uuid, timestamptz) TO service_role;
