-- Contacts "last staff / last service" filters: treat linked rows (same group_booking_id) as one visit
-- so every segment in a multi-service appointment counts toward the latest visit match.

CREATE OR REPLACE FUNCTION public.contacts_filter_guest_ids_latest_booking_match(
  p_venue_id uuid,
  p_staff_column_id uuid DEFAULT NULL,
  p_appointment_service_id uuid DEFAULT NULL,
  p_service_item_id uuid DEFAULT NULL,
  p_booking_date_from date DEFAULT NULL,
  p_booking_date_to date DEFAULT NULL
)
RETURNS TABLE (guest_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      b.id AS booking_id,
      b.guest_id,
      b.practitioner_id,
      b.calendar_id,
      b.appointment_service_id,
      b.service_item_id,
      b.booking_date,
      b.booking_time,
      b.group_booking_id,
      ROW_NUMBER() OVER (
        PARTITION BY b.guest_id
        ORDER BY b.booking_date DESC, b.booking_time DESC NULLS LAST
      ) AS rn
    FROM public.bookings b
    WHERE b.venue_id = p_venue_id
      AND b.guest_id IS NOT NULL
      AND b.status NOT IN ('Cancelled', 'No-Show')
  ),
  latest_anchor AS (
    SELECT * FROM ranked WHERE rn = 1
  ),
  visit_rows AS (
    SELECT
      a.booking_date AS anchor_booking_date,
      b.guest_id,
      b.practitioner_id,
      b.calendar_id,
      b.appointment_service_id,
      b.service_item_id
    FROM latest_anchor a
    INNER JOIN public.bookings b
      ON b.venue_id = p_venue_id
      AND b.guest_id = a.guest_id
      AND b.status NOT IN ('Cancelled', 'No-Show')
      AND (
        (a.group_booking_id IS NOT NULL AND b.group_booking_id IS NOT NULL AND b.group_booking_id = a.group_booking_id)
        OR (a.group_booking_id IS NULL AND b.id = a.booking_id)
      )
  )
  SELECT DISTINCT vr.guest_id
  FROM visit_rows vr
  WHERE
    (p_staff_column_id IS NULL
      OR vr.practitioner_id = p_staff_column_id
      OR vr.calendar_id = p_staff_column_id)
    AND (p_appointment_service_id IS NULL OR vr.appointment_service_id = p_appointment_service_id)
    AND (p_service_item_id IS NULL OR vr.service_item_id = p_service_item_id)
    AND (p_booking_date_from IS NULL OR vr.anchor_booking_date >= p_booking_date_from)
    AND (p_booking_date_to IS NULL OR vr.anchor_booking_date <= p_booking_date_to)
    AND (
      p_staff_column_id IS NOT NULL
      OR p_appointment_service_id IS NOT NULL
      OR p_service_item_id IS NOT NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.contacts_filter_guest_ids_latest_booking_match(uuid, uuid, uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contacts_filter_guest_ids_latest_booking_match(uuid, uuid, uuid, uuid, date, date) TO service_role;
