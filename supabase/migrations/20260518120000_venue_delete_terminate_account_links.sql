-- Terminate account links before a venue row is removed (§6.6 venue_deleted).
-- Called from admin_hard_delete_venue so survivors can be notified from application code
-- and links are not silently CASCADE-deleted without a termination record.

CREATE OR REPLACE FUNCTION terminate_account_links_for_venue_deletion(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_name text;
  v_partners jsonb;
BEGIN
  IF p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue id required';
  END IF;

  SELECT name INTO v_deleted_name FROM venues WHERE id = p_venue_id;
  IF v_deleted_name IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH terminated AS (
    UPDATE account_links
    SET
      status = 'expired',
      termination_reason = 'venue_deleted',
      terminated_at = now(),
      pending_change = null,
      updated_at = now()
    WHERE (venue_low_id = p_venue_id OR venue_high_id = p_venue_id)
      AND status IN ('pending', 'accepted', 'suspended')
    RETURNING id, venue_low_id, venue_high_id
  )
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'link_id', t.id,
        'survivor_venue_id',
        CASE
          WHEN t.venue_low_id = p_venue_id THEN t.venue_high_id
          ELSE t.venue_low_id
        END,
        'deleted_venue_name', v_deleted_name
      )
    ),
    '[]'::jsonb
  )
  INTO v_partners
  FROM terminated t;

  RETURN v_partners;
END;
$$;

REVOKE ALL ON FUNCTION terminate_account_links_for_venue_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION terminate_account_links_for_venue_deletion(uuid) TO service_role;

COMMENT ON FUNCTION terminate_account_links_for_venue_deletion(uuid) IS
  'Expire live account_links touching a venue before hard-delete. Returns JSON array of {link_id, survivor_venue_id, deleted_venue_name} for partner notifications.';

-- Wire into the existing hard-delete RPC so every deletion path terminates links first.
CREATE OR REPLACE FUNCTION admin_hard_delete_venue(p_venue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  staff_ids uuid[];
  v_link_partners jsonb;
BEGIN
  IF p_venue_id IS NULL THEN
    RAISE EXCEPTION 'venue id required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM venues WHERE id = p_venue_id) THEN
    RAISE EXCEPTION 'venue not found: %', p_venue_id;
  END IF;

  v_link_partners := terminate_account_links_for_venue_deletion(p_venue_id);

  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO staff_ids FROM staff WHERE venue_id = p_venue_id;

  IF cardinality(staff_ids) > 0 THEN
    UPDATE practitioner_calendar_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE calendar_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE table_blocks SET created_by = NULL WHERE created_by = ANY (staff_ids);
    UPDATE booking_table_assignments SET assigned_by = NULL WHERE assigned_by = ANY (staff_ids);
    UPDATE table_statuses SET updated_by = NULL WHERE updated_by = ANY (staff_ids);
    UPDATE unified_calendars SET staff_id = NULL WHERE staff_id = ANY (staff_ids);
  END IF;

  UPDATE table_statuses ts
  SET booking_id = NULL
  FROM venue_tables vt
  WHERE ts.table_id = vt.id AND vt.venue_id = p_venue_id;

  ALTER TABLE events DISABLE TRIGGER events_append_only;
  DELETE FROM events e
  WHERE e.venue_id = p_venue_id
     OR e.booking_id IN (SELECT b.id FROM bookings b WHERE b.venue_id = p_venue_id);
  ALTER TABLE events ENABLE TRIGGER events_append_only;

  ALTER TABLE booking_table_assignments DISABLE TRIGGER trg_log_table_assignment;
  DELETE FROM booking_table_assignments
  WHERE booking_id IN (SELECT b.id FROM bookings b WHERE b.venue_id = p_venue_id);
  ALTER TABLE booking_table_assignments ENABLE TRIGGER trg_log_table_assignment;

  DELETE FROM bookings WHERE venue_id = p_venue_id;

  DELETE FROM venues WHERE id = p_venue_id;

  RETURN v_link_partners;
END;
$$;
