-- Staff booking detail: one round-trip for guest, timeline, tables, addons, comms.

CREATE OR REPLACE FUNCTION public.staff_booking_detail_bundle(
  p_booking_id uuid,
  p_venue_id uuid,
  p_include_timeline boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN b.id IS NULL THEN NULL::jsonb
    ELSE jsonb_build_object(
      'area_name', (
        SELECT a.name
        FROM public.areas a
        WHERE a.id = b.area_id
          AND a.venue_id = p_venue_id
      ),
      'service_variant_name', (
        SELECT sv.name
        FROM public.service_variants sv
        WHERE sv.id = b.service_variant_id
          AND sv.venue_id = p_venue_id
      ),
      'service_variant_price_pence', (
        SELECT sv.price_pence
        FROM public.service_variants sv
        WHERE sv.id = b.service_variant_id
          AND sv.venue_id = p_venue_id
      ),
      'guest', (
        SELECT jsonb_build_object(
          'id', g.id,
          'first_name', g.first_name,
          'last_name', g.last_name,
          'email', g.email,
          'phone', g.phone,
          'visit_count', g.visit_count,
          'last_visit_date', g.last_visit_date,
          'tags', g.tags,
          'customer_profile_notes', g.customer_profile_notes
        )
        FROM public.guests g
        WHERE g.id = b.guest_id
      ),
      'events', CASE
        WHEN p_include_timeline THEN (
          SELECT coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', e.id,
                'event_type', e.event_type,
                'payload', e.payload,
                'created_at', e.created_at
              )
              ORDER BY e.created_at ASC
            ),
            '[]'::jsonb
          )
          FROM public.events e
          WHERE e.booking_id = b.id
        )
        ELSE '[]'::jsonb
      END,
      'communication_logs', CASE
        WHEN p_include_timeline THEN (
          SELECT coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', cl.id,
                'message_type', cl.message_type,
                'channel', cl.channel,
                'status', cl.status,
                'created_at', cl.created_at,
                'sent_at', cl.sent_at,
                'recipient', cl.recipient,
                'error_message', cl.error_message
              )
              ORDER BY cl.created_at DESC
            ),
            '[]'::jsonb
          )
          FROM public.communication_logs cl
          WHERE cl.booking_id = b.id
        )
        ELSE '[]'::jsonb
      END,
      'legacy_communications', CASE
        WHEN p_include_timeline THEN (
          SELECT coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'message_type', c.message_type,
                'channel', c.channel,
                'status', c.status,
                'created_at', c.created_at,
                'recipient_email', c.recipient_email,
                'recipient_phone', c.recipient_phone
              )
              ORDER BY c.created_at DESC
            ),
            '[]'::jsonb
          )
          FROM public.communications c
          WHERE c.booking_id = b.id
        )
        ELSE '[]'::jsonb
      END,
      'table_assignments', (
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'table_id', bta.table_id,
              'table', CASE
                WHEN vt.id IS NOT NULL THEN jsonb_build_object('id', vt.id, 'name', vt.name)
                ELSE NULL
              END
            )
          ),
          '[]'::jsonb
        )
        FROM public.booking_table_assignments bta
        LEFT JOIN public.venue_tables vt ON vt.id = bta.table_id
        WHERE bta.booking_id = b.id
      ),
      'addons', (
        SELECT coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', ba.id,
              'booking_id', ba.booking_id,
              'addon_id', ba.addon_id,
              'addon_group_id', ba.addon_group_id,
              'booking_segment_index', ba.booking_segment_index,
              'addon_name_snapshot', ba.addon_name_snapshot,
              'addon_group_name_snapshot', ba.addon_group_name_snapshot,
              'price_pence_at_booking', ba.price_pence_at_booking,
              'duration_minutes_at_booking', ba.duration_minutes_at_booking,
              'cost_to_business_pence_at_booking', ba.cost_to_business_pence_at_booking,
              'created_at', ba.created_at
            )
            ORDER BY ba.created_at ASC
          ),
          '[]'::jsonb
        )
        FROM public.booking_addons ba
        WHERE ba.booking_id = b.id
      )
    )
  END
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.venue_id = p_venue_id;
$$;

GRANT EXECUTE ON FUNCTION public.staff_booking_detail_bundle(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_booking_detail_bundle(uuid, uuid, boolean) TO service_role;
