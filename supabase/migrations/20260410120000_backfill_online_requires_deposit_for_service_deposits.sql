-- When per-service deposits are enabled, public booking must collect online; align legacy rows.
-- Column online_requires_deposit is added on booking_restrictions in 20260516120000_per_service_booking_deposits.sql.
-- Guard so fresh migrations do not 42703; backfill reruns in 20260516120100 after ALTER.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'booking_restrictions'
      AND column_name = 'online_requires_deposit'
  ) THEN
    UPDATE booking_restrictions
    SET online_requires_deposit = true
    WHERE deposit_required_from_party_size IS NOT NULL;
  END IF;
END $$;
