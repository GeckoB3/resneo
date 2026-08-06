-- Linked-account audit log: stop retaining client PII in booking snapshots.
--
-- `account_link_audit_log` is append-only, visible to BOTH venues, and explicitly
-- "retained after link termination" (see the table comment). The booking triggers
-- wrote `to_jsonb(NEW)` / `to_jsonb(OLD)` into before_state/after_state, and two
-- application call sites passed the whole booking row. Because `bookings` carries
-- guest_first_name, guest_last_name, guest_email, guest_phone, special_requests,
-- dietary_notes, occasion and internal_notes, every audit row was a permanent copy
-- of the client's identity, contact details and free text (dietary notes being
-- special-category data), still readable by the other venue after the link was
-- revoked.
--
-- The audit's purpose is "who did what to which booking". It already carries
-- resource_id, so anyone with a *current* legitimate reason can resolve the
-- booking through the normal access path, which applies the PII grant. The
-- snapshot only needs to answer "what changed".
--
-- Enforcement sits on the audit table rather than in each writer, so the trigger,
-- both application call sites, and any future writer are all covered by one rule.

-- -----------------------------------------------------------------------------
-- Allow-listed projection of a booking row for audit purposes.
--
-- Deliberately an allow-list, not a deny-list: a PII column added to `bookings`
-- later is excluded by default. For a permanent, append-only, cross-venue store,
-- a new field must fail closed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.linked_audit_booking_snapshot(state jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN state IS NULL OR jsonb_typeof(state) <> 'object' THEN state
    ELSE (
      SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb)
      FROM jsonb_each(state)
      WHERE key IN (
        'id',
        'venue_id',
        'booking_date',
        'booking_time',
        'booking_end_time',
        'estimated_end_time',
        'status',
        'party_size',
        'booking_model',
        'source',
        'practitioner_id',
        'calendar_id',
        'appointment_service_id',
        'service_item_id',
        'service_variant_id',
        'experience_event_id',
        'class_instance_id',
        'resource_id',
        'event_session_id',
        'group_booking_id',
        'deposit_status',
        'deposit_amount_pence',
        'cancellation_deadline',
        'created_at',
        'updated_at'
      )
    )
  END;
$$;

COMMENT ON FUNCTION public.linked_audit_booking_snapshot(jsonb) IS
  'Allow-listed operational projection of a booking row for account_link_audit_log. Excludes all client identity and free-text fields by default.';

-- -----------------------------------------------------------------------------
-- Choke point: redact on the way into the audit table, whatever the writer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redact_link_audit_booking_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.resource_type = 'booking' THEN
    NEW.before_state := public.linked_audit_booking_snapshot(NEW.before_state);
    NEW.after_state  := public.linked_audit_booking_snapshot(NEW.after_state);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_redact_link_audit_booking_state ON public.account_link_audit_log;
CREATE TRIGGER trg_redact_link_audit_booking_state
  BEFORE INSERT OR UPDATE OF before_state, after_state
  ON public.account_link_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.redact_link_audit_booking_state();

-- -----------------------------------------------------------------------------
-- Backfill: existing rows already hold the unredacted payload.
--
-- The projection is applied in place. Operational history is preserved; identity
-- and free text are dropped. This is not reversible, which is the point: the
-- data should not have been retained and cannot be un-disclosed by keeping it.
-- -----------------------------------------------------------------------------
UPDATE public.account_link_audit_log
   SET before_state = public.linked_audit_booking_snapshot(before_state),
       after_state  = public.linked_audit_booking_snapshot(after_state)
 WHERE resource_type = 'booking'
   AND (
     before_state IS NOT NULL
     OR after_state IS NOT NULL
   );

COMMENT ON TABLE public.account_link_audit_log IS
  'Append-only cross-venue action record. Visible to both venues; retained after link termination. Booking snapshots are redacted to operational fields only (see linked_audit_booking_snapshot) because retention outlives the link.';
