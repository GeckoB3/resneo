-- Card holds (Migration C): report_deposit_summary gains no-show fee metrics.
--
-- The function RETURNS jsonb built with jsonb_build_object and the reports
-- route passes the object through by named keys, so this is a plain
-- CREATE OR REPLACE (no return-type change, no DROP needed). Existing keys
-- are preserved unchanged; three keys are added:
--   no_show_fees_charged_pence  SUM(bch.charged_pence) where deposit_status = 'Charged'
--   no_show_fees_charged_count  count of those bookings
--   card_holds_active_count     deposit_status = 'Card Held' AND hold not released
--
-- The LEFT JOIN to booking_card_holds is aggregation-safe: the unique index
-- booking_card_holds_booking_uq guarantees at most one hold row per booking,
-- so the join cannot fan out the bookings rows the existing sums run over.
-- Charged no-show fees are deliberately NOT folded into total_collected_pence:
-- they are a distinct revenue stream and are reported separately.

CREATE OR REPLACE FUNCTION report_deposit_summary(
  p_venue_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_collected_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status IN ('Paid', 'Forfeited')), 0),
    'total_refunded_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status = 'Refunded'), 0),
    'total_forfeited_pence', COALESCE(SUM(deposit_amount_pence) FILTER (WHERE deposit_status = 'Forfeited'), 0),
    'no_show_fees_charged_pence', COALESCE(SUM(bch.charged_pence) FILTER (WHERE deposit_status = 'Charged'), 0),
    'no_show_fees_charged_count', COUNT(*) FILTER (WHERE deposit_status = 'Charged'),
    'card_holds_active_count', COUNT(*) FILTER (WHERE deposit_status = 'Card Held' AND bch.released_at IS NULL)
  )
  FROM bookings
  LEFT JOIN booking_card_holds bch ON bch.booking_id = bookings.id
  WHERE bookings.venue_id = p_venue_id
    AND bookings.created_at >= p_start AND bookings.created_at < p_end;
$$;
