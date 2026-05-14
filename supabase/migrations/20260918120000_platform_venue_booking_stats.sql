-- Aggregated booking counts for platform superuser subscriber dashboard (service_role only).

CREATE OR REPLACE FUNCTION public.platform_venue_booking_stats(
  p_from timestamptz,
  p_to_excl timestamptz
)
RETURNS TABLE (
  venue_id uuid,
  all_time_count bigint,
  period_count bigint,
  period_by_model jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH all_counts AS (
    SELECT b.venue_id, COUNT(*)::bigint AS c
    FROM public.bookings b
    GROUP BY b.venue_id
  ),
  period_cells AS (
    SELECT
      b.venue_id,
      b.booking_model::text AS model,
      COUNT(*)::bigint AS cnt
    FROM public.bookings b
    WHERE b.created_at >= p_from
      AND b.created_at < p_to_excl
    GROUP BY b.venue_id, b.booking_model
  ),
  period_agg AS (
    SELECT
      pc.venue_id,
      SUM(pc.cnt)::bigint AS total,
      jsonb_object_agg(pc.model, pc.cnt) AS by_model
    FROM period_cells pc
    GROUP BY pc.venue_id
  )
  SELECT
    v.id AS venue_id,
    COALESCE(ac.c, 0)::bigint AS all_time_count,
    COALESCE(pa.total, 0)::bigint AS period_count,
    COALESCE(pa.by_model, '{}'::jsonb) AS period_by_model
  FROM public.venues v
  LEFT JOIN all_counts ac ON ac.venue_id = v.id
  LEFT JOIN period_agg pa ON pa.venue_id = v.id;
$$;

REVOKE ALL ON FUNCTION public.platform_venue_booking_stats(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_venue_booking_stats(timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.platform_venue_booking_stats(timestamptz, timestamptz) IS
  'Per-venue booking totals (all-time) and counts in [p_from, p_to_excl) by booking_model; platform superuser tooling.';
