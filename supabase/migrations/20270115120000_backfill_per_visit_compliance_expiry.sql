-- Backfill: anchor per-visit compliance expiry to the appointment, not the capture day.
--
-- Per-visit compliance types (compliance_types.validity_period_days = 0) used to write
-- expires_at as the end of the day the form was CAPTURED. A guest who completed the form
-- ahead of the appointment (inline during booking, or from the confirmation-email link)
-- therefore had an already-expired record on the day: the requirement resolved to EXPIRED,
-- and a blocking requirement could reject the very booking the form was completed for.
--
-- Capture now anchors per-visit expiry to the end of the APPOINTMENT day (see
-- computeExpiresAt / captureComplianceRecord). This repairs the records already written
-- the old way, so bookings that are already on the books stop being blocked.
--
-- Scope and safeguards:
--   * per-visit records only, attached to a booking that has not happened yet. Past visits
--     are history and are left exactly as they are.
--   * expiry only ever moves LATER, never earlier.
--   * records the nightly expiry job already flipped to 'expired' are returned to
--     'completed', otherwise they still fail the resolver on status alone.
--   * voided records are never touched, and cancelled / no-show bookings are skipped.
--   * an unrecognised venue timezone falls back to Europe/London rather than failing.
--
-- Expansive and re-runnable: no schema change, and a second run matches nothing.

UPDATE public.compliance_records AS r
SET
  expires_at = target.new_expires_at,
  status = CASE WHEN r.status = 'expired' THEN 'completed' ELSE r.status END,
  updated_at = now()
FROM (
  SELECT
    cr.id,
    (
      (b.booking_date + 1)::timestamp
      AT TIME ZONE COALESCE(
        (SELECT tzn.name FROM pg_timezone_names tzn WHERE tzn.name = btrim(v.timezone)),
        'Europe/London'
      )
    ) - interval '1 millisecond' AS new_expires_at
  FROM public.compliance_records cr
  JOIN public.compliance_types ct ON ct.id = cr.compliance_type_id
  JOIN public.bookings b ON b.id = cr.booking_id
  JOIN public.venues v ON v.id = cr.venue_id
  WHERE ct.validity_period_days = 0
    AND cr.voided_at IS NULL
    AND cr.status IN ('completed', 'expired')
    AND b.booking_date >= CURRENT_DATE
    AND b.status NOT IN ('Cancelled', 'No-Show')
) AS target
WHERE r.id = target.id
  AND r.expires_at IS NOT NULL
  AND target.new_expires_at > r.expires_at;
